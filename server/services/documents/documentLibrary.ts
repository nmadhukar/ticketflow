import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  companyPolicies,
  helpDocuments,
  knowledgeArticles,
  userGuides,
  type CompanyPolicy,
  type HelpDocument,
  type KnowledgeArticle,
  type User,
  type UserGuide,
} from "@shared/schema";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { HttpError } from "../../http/errors";
import { normalizeRole } from "../../permissions/roles";
import { isStaffRole } from "../../permissions/staff";
import { htmlToPlainText, sanitizeRichHtml } from "../../security/sanitizeHtml";
import { containsPattern } from "../../utils/like";
import { DOCUMENT_TYPES, SEARCH_MAX_LIMIT, type DocumentType } from "./types";

/**
 * The organisation's documents for MCP (task MCP4, R91): help documents, company policies, user
 * guides (shown as "Guidelines") and knowledge articles. Each source shows a caller exactly the
 * rows that source's REST read route shows them; the predicates below are the ones those routes
 * use (the REST routes call them too, so there is one rule):
 * - help (GET /api/help, /api/help/search, /api/help/:id): every signed-in user, every row;
 * - policy (GET /api/company-policies[/:id]): inactive policies only for an admin;
 * - guideline (GET /api/guides[/:id]): drafts (is_published not true) only for staff;
 * - knowledge (GET /api/knowledge/search, /api/knowledge/articles; /api/admin/knowledge for
 *   admins): published (is_published, or status "published") unless the caller is an admin.
 * file_data is never read out: a document is returned as text (its content plus extracted_text).
 */

export { DOCUMENT_TYPES, SEARCH_MAX_LIMIT, type DocumentType };

/** The caller: its id and stored role. */
export type DocumentViewer = { id: string; role?: User["role"] | null };

/** GET /api/company-policies: `includeInactive` and inactive by id are admin-only. */
export const mayReadInactivePolicies = (role: unknown): boolean => normalizeRole(role) === "admin";
/** GET /api/guides: staff may see drafts; everyone else sees published guides only. */
export const mayReadDraftGuides = (role: unknown): boolean => isStaffRole(role);
/** GET /api/admin/knowledge (admin only) lists drafts and archived articles; every other route shows published ones. */
export const mayReadDraftKnowledge = (role: unknown): boolean => role === "admin";

const isReadableArticle = (a: Pick<KnowledgeArticle, "isPublished" | "status">) =>
  a.isPublished === true || a.status === "published";

/** The admin gate every content write route uses (stored role exactly "admin"). */
export function assertContentAdmin(user: Pick<User, "role"> | null | undefined): void {
  if (!user || user.role !== "admin") throw new HttpError(403, "forbidden", "Admin access required");
}

// ---------------------------------------------------------------- search (R91, keywords per review I2)

export const SNIPPET_CHARS = 300;
const SNIPPET_LEAD = 120;
export const SEARCH_MAX_TERMS = 12;

/** Common English words that carry no meaning in a search ("How do I set the key?" searches set, key). */
const STOPWORDS = new Set(
  (
    "a about after all also am an and any are as at be been before being but by can could did do does doing " +
    "for from get had has have having he her here hers him his how i if in into is it its just let me might " +
    "more most must my no nor not of off on once only or other our ours out over please shall she should so " +
    "some such than that the their theirs them then there these they this those through to too under until " +
    "up us very was we were what when where which while who whom whose why will with would you your yours"
  ).split(" ")
);

/**
 * The keywords of a query (review I2): lower-cased words (letters and digits; punctuation, LIKE
 * wildcards included, separates words), without stopwords and one-character words, each once, at
 * most SEARCH_MAX_TERMS. "How do I set the DoseSpot clinic key?" gives set, dosespot, clinic, key.
 */
// Unicode letters and digits make words (built with the constructor: the test tsconfig targets ES5 for the `u` literal check).
const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "u");

export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  for (const word of query.toLowerCase().split(NON_WORD)) {
    if (word.length < 2 || STOPWORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length === SEARCH_MAX_TERMS) break;
  }
  return terms;
}

export interface SearchHit {
  type: DocumentType;
  id: number;
  title: string;
  category: string | null;
  /** About 300 characters of the document around the first keyword found (the start when only the title matched). */
  snippet: string;
  /** Whether the document is published (policy: active) - only a caller allowed to see drafts gets false. */
  published: boolean;
  /** How many of the query's keywords the document contains (title or text). */
  matchedTerms: number;
}

type Row = {
  id: number;
  title: string;
  category: string | null;
  createdAt: Date | null;
  matchedTerms: number;
  titleTerms: number;
  snippet: string | null;
  published: boolean | null;
};

/** One source: its table, the columns the result needs, the text searched besides the title, and its REST visibility. */
interface SourceSpec {
  table: PgTable;
  id: AnyPgColumn;
  title: AnyPgColumn;
  createdAt: AnyPgColumn;
  category: AnyPgColumn | SQL<string | null>;
  published: AnyPgColumn | SQL<boolean>;
  body: AnyPgColumn[];
  visible?: SQL;
}

const anyColumn = (columns: AnyPgColumn[], pattern: string): SQL => or(...columns.map((c) => ilike(c, pattern)))!;
const countOf = (conditions: SQL[]) =>
  sql<number>`(${sql.join(
    conditions.map((c) => sql`(CASE WHEN ${c} THEN 1 ELSE 0 END)`),
    sql` + `
  )})`;

/** ~300 characters of the body around the earliest keyword in it; `concat_ws` and `lower` computed once per row. */
function snippetOf(body: AnyPgColumn[], terms: string[]): SQL<string | null> {
  const hay = sql`concat_ws(E'\n', ${sql.join(body.map((c) => sql`${c}`), sql`, `)})`;
  const positions = sql.join(terms.map((t) => sql`nullif(strpos(x.l, ${t}), 0)`), sql`, `);
  return sql<string | null>`(SELECT substr(x.h, greatest(coalesce(least(${positions}), 1) - ${SNIPPET_LEAD}, 1), ${SNIPPET_CHARS}) FROM (SELECT y.h, lower(y.h) AS l FROM (SELECT ${hay} AS h) y) x)`;
}

/**
 * A row matches when it contains ANY keyword (case-insensitive ILIKE, each keyword escaped by
 * containsPattern and bound as a parameter) in its title or body, within the source's visibility.
 * Order: most keywords matched, then most keywords in the title, then newest (NULL dates last, as
 * the merge below sorts them), then id.
 */
async function searchSource(spec: SourceSpec, terms: string[], limit: number): Promise<Row[]> {
  const patterns = terms.map(containsPattern);
  const columns = [spec.title, ...spec.body];
  const matched = countOf(patterns.map((p) => anyColumn(columns, p)));
  const inTitle = countOf(patterns.map((p) => ilike(spec.title, p)));
  const rows = await db
    .select({
      id: spec.id,
      title: spec.title,
      category: spec.category,
      createdAt: spec.createdAt,
      matchedTerms: matched,
      titleTerms: inTitle,
      snippet: snippetOf(spec.body, terms),
      published: spec.published,
    })
    .from(spec.table)
    .where(and(spec.visible, or(...patterns.map((p) => anyColumn(columns, p)))))
    .orderBy(desc(matched), desc(inTitle), sql`${spec.createdAt} DESC NULLS LAST`, desc(spec.id))
    .limit(limit);
  return rows as unknown as Row[];
}

function sources(viewer: DocumentViewer): Record<DocumentType, SourceSpec> {
  return {
    help: {
      table: helpDocuments,
      id: helpDocuments.id,
      title: helpDocuments.title,
      createdAt: helpDocuments.createdAt,
      category: helpDocuments.category,
      published: sql<boolean>`true`,
      body: [helpDocuments.content, helpDocuments.extractedText],
    },
    policy: {
      table: companyPolicies,
      id: companyPolicies.id,
      title: companyPolicies.title,
      createdAt: companyPolicies.createdAt,
      category: sql<string | null>`NULL`,
      published: companyPolicies.isActive,
      body: [companyPolicies.description, companyPolicies.content, companyPolicies.extractedText],
      visible: mayReadInactivePolicies(viewer.role) ? undefined : eq(companyPolicies.isActive, true),
    },
    guideline: {
      table: userGuides,
      id: userGuides.id,
      title: userGuides.title,
      createdAt: userGuides.createdAt,
      category: userGuides.category,
      published: sql<boolean>`coalesce(${userGuides.isPublished}, false)`,
      body: [userGuides.description, userGuides.content],
      visible: mayReadDraftGuides(viewer.role) ? undefined : eq(userGuides.isPublished, true),
    },
    knowledge: {
      table: knowledgeArticles,
      id: knowledgeArticles.id,
      title: knowledgeArticles.title,
      createdAt: knowledgeArticles.createdAt,
      category: knowledgeArticles.category,
      published: sql<boolean>`coalesce(${knowledgeArticles.isPublished}, false) OR coalesce(${knowledgeArticles.status} = 'published', false)`,
      body: [knowledgeArticles.summary, knowledgeArticles.content],
      visible: mayReadDraftKnowledge(viewer.role)
        ? undefined
        : or(eq(knowledgeArticles.isPublished, true), eq(knowledgeArticles.status as AnyPgColumn, "published")),
    },
  };
}

const tidySnippet = (type: DocumentType, raw: string | null): string => {
  const text = type === "guideline" ? htmlToPlainText(raw ?? "", true) : (raw ?? "");
  return text.replace(/\s+/g, " ").trim();
};

/**
 * Searches the four sources for the query's keywords (searchTerms; case-insensitive, in the
 * title, the description or summary, the content and the extracted file text), each limited to
 * what the viewer may read. Ranked: most keywords matched, then keywords in the title, then
 * newest. A query with no keyword finds nothing (the MCP tool refuses it first).
 */
export async function searchDocuments(
  viewer: DocumentViewer,
  input: { query: string; type?: DocumentType; limit: number }
): Promise<SearchHit[]> {
  const terms = searchTerms(input.query);
  if (terms.length === 0) return [];
  const specs = sources(viewer);
  const types = DOCUMENT_TYPES.filter((t) => !input.type || input.type === t);
  // Each source's own top `limit` under the same order: their union holds the overall top `limit`.
  const perSource = await Promise.all(types.map((t) => searchSource(specs[t], terms, input.limit)));
  const tagged = types.flatMap((type, i) => perSource[i].map((r) => ({ type, r })));
  const time = (d: Date | null) => (d ? new Date(d).getTime() : Number.NEGATIVE_INFINITY);
  tagged.sort(
    (a, b) =>
      Number(b.r.matchedTerms) - Number(a.r.matchedTerms) ||
      Number(b.r.titleTerms) - Number(a.r.titleTerms) ||
      (time(b.r.createdAt) > time(a.r.createdAt) ? 1 : time(b.r.createdAt) < time(a.r.createdAt) ? -1 : 0) ||
      DOCUMENT_TYPES.indexOf(a.type) - DOCUMENT_TYPES.indexOf(b.type) ||
      b.r.id - a.r.id
  );
  return tagged.slice(0, input.limit).map(({ type, r }) => ({
    type,
    id: r.id,
    title: r.title,
    category: r.category ?? null,
    snippet: tidySnippet(type, r.snippet),
    published: r.published === true,
    matchedTerms: Number(r.matchedTerms),
  }));
}

// ---------------------------------------------------------------- read one (get_document)

export const DOCUMENT_TEXT_MAX_CHARS = 200_000;

/** Joins the readable parts (blank ones and exact repeats dropped) and caps the result. */
function readableText(parts: Array<string | null | undefined>): { text: string; truncated: boolean; textLength: number } {
  const kept: string[] = [];
  for (const p of parts) {
    const t = (p ?? "").trim();
    if (t && !kept.includes(t)) kept.push(t);
  }
  const full = kept.join("\n\n");
  return full.length > DOCUMENT_TEXT_MAX_CHARS
    ? { text: full.slice(0, DOCUMENT_TEXT_MAX_CHARS), truncated: true, textLength: full.length }
    : { text: full, truncated: false, textLength: full.length };
}

const capped = (s: string) => (s.length > DOCUMENT_TEXT_MAX_CHARS ? s.slice(0, DOCUMENT_TEXT_MAX_CHARS) : s);

export function presentHelpDocument(d: HelpDocument) {
  return {
    type: "help" as const,
    id: d.id,
    title: d.title,
    category: d.category ?? null,
    tags: d.tags ?? [],
    published: true,
    filename: d.filename,
    hasFile: !!d.fileData,
    // '' is "tried, nothing extractable", null "never tried": neither is text.
    hasFileText: !!d.extractedText,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...readableText([d.content, d.extractedText]),
  };
}

export function presentPolicy(p: CompanyPolicy) {
  return {
    type: "policy" as const,
    id: p.id,
    title: p.title,
    category: null,
    description: p.description ?? null,
    published: p.isActive,
    isActive: p.isActive,
    fileName: p.fileName,
    mimeType: p.mimeType,
    fileSize: p.fileSize,
    hasFile: !!p.fileData,
    hasFileText: !!p.extractedText,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...readableText([p.description, p.content, p.extractedText]),
  };
}

export function presentGuide(g: UserGuide) {
  const content = sanitizeRichHtml(g.content);
  const read = readableText([g.description, htmlToPlainText(content)]);
  return {
    type: "guideline" as const,
    id: g.id,
    title: g.title,
    category: g.category,
    description: g.description ?? null,
    guideType: g.type,
    scribehowUrl: g.scribehowUrl ?? null,
    videoUrl: g.videoUrl ?? null,
    tags: g.tags ?? [],
    published: g.isPublished === true,
    isPublished: g.isPublished === true,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    /** The guide's HTML, sanitised as GET /api/guides/:id returns it (capped like the text). */
    content: capped(content),
    ...read,
    truncated: read.truncated || content.length > DOCUMENT_TEXT_MAX_CHARS,
  };
}

export function presentKnowledgeArticle(a: KnowledgeArticle) {
  return {
    type: "knowledge" as const,
    id: a.id,
    title: a.title,
    category: a.category ?? null,
    summary: a.summary ?? null,
    tags: a.tags ?? [],
    published: isReadableArticle(a),
    isPublished: a.isPublished === true,
    status: a.status ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    ...readableText([a.summary, a.content]),
  };
}

/**
 * One document, as its REST read route shows it to the viewer, as text: NOT_FOUND when unknown or
 * hidden from this viewer (the routes answer 404 for a hidden row too, so its existence is not told).
 */
export async function getDocument(viewer: DocumentViewer, type: DocumentType, id: number) {
  if (type === "help") {
    const d = await storage.getHelpDocument(id);
    if (!d) throw new HttpError(404, "not_found", "Help document not found");
    return presentHelpDocument(d);
  }
  if (type === "policy") {
    const p = await storage.getCompanyPolicyById(id);
    if (!p || (!p.isActive && !mayReadInactivePolicies(viewer.role))) {
      throw new HttpError(404, "not_found", "Company policy not found");
    }
    return presentPolicy(p);
  }
  if (type === "guideline") {
    const g = await storage.getUserGuideById(id);
    if (!g || (g.isPublished !== true && !mayReadDraftGuides(viewer.role))) {
      throw new HttpError(404, "not_found", "Guide not found");
    }
    return presentGuide(g);
  }
  const a = await storage.getKnowledgeArticle(id);
  if (!a || (!isReadableArticle(a) && !mayReadDraftKnowledge(viewer.role))) {
    throw new HttpError(404, "not_found", "Article not found");
  }
  return presentKnowledgeArticle(a);
}

/** GET /api/guide-categories: every signed-in user. The guide `category` holds a category's name. */
export async function listGuideCategories() {
  const rows = await storage.getUserGuideCategories();
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    icon: c.icon ?? null,
    displayOrder: c.displayOrder ?? 0,
  }));
}
