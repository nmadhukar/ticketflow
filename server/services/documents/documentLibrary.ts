import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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

// ---------------------------------------------------------------- search (R91)

export const SNIPPET_CHARS = 300;
const SNIPPET_LEAD = 120;

export interface SearchHit {
  type: DocumentType;
  id: number;
  title: string;
  category: string | null;
  /** About 300 characters of the document around the first match (the start when only the title matched). */
  snippet: string;
  /** Whether the document is published (policy: active) - only a caller allowed to see drafts gets false. */
  published: boolean;
}

type Row = {
  id: number;
  title: string;
  category: string | null;
  createdAt: Date | null;
  titleMatch: boolean;
  snippet: string | null;
  published: boolean | null;
};

/** `concat_ws` of the searchable text columns, and ~300 characters of it around the first match. */
function snippetOf(columns: AnyPgColumn[], needle: string): SQL<string | null> {
  const hay = sql`concat_ws(E'\n', ${sql.join(columns.map((c) => sql`${c}`), sql`, `)})`;
  return sql<string | null>`substr(${hay}, greatest(strpos(lower(${hay}), ${needle}) - ${SNIPPET_LEAD}, 1), ${SNIPPET_CHARS})`;
}

const titleMatches = (title: AnyPgColumn, pattern: string) => sql<boolean>`${title} ILIKE ${pattern}`;

function matchesAny(columns: AnyPgColumn[], pattern: string): SQL | undefined {
  return or(...columns.map((c) => ilike(c, pattern)));
}

async function searchHelp(pattern: string, needle: string, limit: number): Promise<Row[]> {
  const body = [helpDocuments.content, helpDocuments.extractedText];
  return db
    .select({
      id: helpDocuments.id,
      title: helpDocuments.title,
      category: helpDocuments.category,
      createdAt: helpDocuments.createdAt,
      titleMatch: sql<boolean>`${helpDocuments.title} ILIKE ${pattern}`,
      snippet: snippetOf(body, needle),
      published: sql<boolean>`true`,
    })
    .from(helpDocuments)
    .where(matchesAny([helpDocuments.title, ...body], pattern))
    .orderBy(desc(titleMatches(helpDocuments.title, pattern)), desc(helpDocuments.createdAt), desc(helpDocuments.id))
    .limit(limit) as Promise<Row[]>;
}

async function searchPolicies(viewer: DocumentViewer, pattern: string, needle: string, limit: number): Promise<Row[]> {
  const body = [companyPolicies.description, companyPolicies.content, companyPolicies.extractedText];
  return db
    .select({
      id: companyPolicies.id,
      title: companyPolicies.title,
      category: sql<string | null>`NULL`,
      createdAt: companyPolicies.createdAt,
      titleMatch: sql<boolean>`${companyPolicies.title} ILIKE ${pattern}`,
      snippet: snippetOf(body, needle),
      published: companyPolicies.isActive,
    })
    .from(companyPolicies)
    .where(
      and(
        mayReadInactivePolicies(viewer.role) ? undefined : eq(companyPolicies.isActive, true),
        matchesAny([companyPolicies.title, ...body], pattern)
      )
    )
    .orderBy(desc(titleMatches(companyPolicies.title, pattern)), desc(companyPolicies.createdAt), desc(companyPolicies.id))
    .limit(limit) as Promise<Row[]>;
}

async function searchGuides(viewer: DocumentViewer, pattern: string, needle: string, limit: number): Promise<Row[]> {
  const body = [userGuides.description, userGuides.content];
  return db
    .select({
      id: userGuides.id,
      title: userGuides.title,
      category: userGuides.category,
      createdAt: userGuides.createdAt,
      titleMatch: sql<boolean>`${userGuides.title} ILIKE ${pattern}`,
      snippet: snippetOf(body, needle),
      published: sql<boolean>`coalesce(${userGuides.isPublished}, false)`,
    })
    .from(userGuides)
    .where(
      and(
        mayReadDraftGuides(viewer.role) ? undefined : eq(userGuides.isPublished, true),
        matchesAny([userGuides.title, ...body], pattern)
      )
    )
    .orderBy(desc(titleMatches(userGuides.title, pattern)), desc(userGuides.createdAt), desc(userGuides.id))
    .limit(limit) as Promise<Row[]>;
}

async function searchKnowledge(viewer: DocumentViewer, pattern: string, needle: string, limit: number): Promise<Row[]> {
  const body = [knowledgeArticles.summary, knowledgeArticles.content];
  const readable = or(eq(knowledgeArticles.isPublished, true), eq(knowledgeArticles.status as AnyPgColumn, "published"));
  return db
    .select({
      id: knowledgeArticles.id,
      title: knowledgeArticles.title,
      category: knowledgeArticles.category,
      createdAt: knowledgeArticles.createdAt,
      titleMatch: sql<boolean>`${knowledgeArticles.title} ILIKE ${pattern}`,
      snippet: snippetOf(body, needle),
      published: sql<boolean>`coalesce(${knowledgeArticles.isPublished}, false) OR coalesce(${knowledgeArticles.status} = 'published', false)`,
    })
    .from(knowledgeArticles)
    .where(and(mayReadDraftKnowledge(viewer.role) ? undefined : readable, matchesAny([knowledgeArticles.title, ...body], pattern)))
    .orderBy(desc(titleMatches(knowledgeArticles.title, pattern)), desc(knowledgeArticles.createdAt), desc(knowledgeArticles.id))
    .limit(limit) as Promise<Row[]>;
}

const tidySnippet = (type: DocumentType, raw: string | null): string => {
  const text = type === "guideline" ? htmlToPlainText(raw ?? "", true) : (raw ?? "");
  return text.replace(/\s+/g, " ").trim();
};

/**
 * Searches the four sources for `query` (case-insensitive, in the title, the description or
 * summary, the content and the extracted file text), each limited to what the viewer may read.
 * Ranked: a title match first, then a content match; newest first within each.
 */
export async function searchDocuments(
  viewer: DocumentViewer,
  input: { query: string; type?: DocumentType; limit: number }
): Promise<SearchHit[]> {
  const pattern = containsPattern(input.query);
  const needle = input.query.toLowerCase();
  const want = (t: DocumentType) => !input.type || input.type === t;
  // Each source's own top `limit` under the same order: their union holds the overall top `limit`.
  const [help, policy, guideline, knowledge] = await Promise.all([
    want("help") ? searchHelp(pattern, needle, input.limit) : [],
    want("policy") ? searchPolicies(viewer, pattern, needle, input.limit) : [],
    want("guideline") ? searchGuides(viewer, pattern, needle, input.limit) : [],
    want("knowledge") ? searchKnowledge(viewer, pattern, needle, input.limit) : [],
  ]);
  const tagged = [
    ...help.map((r) => ({ type: "help" as const, r })),
    ...policy.map((r) => ({ type: "policy" as const, r })),
    ...guideline.map((r) => ({ type: "guideline" as const, r })),
    ...knowledge.map((r) => ({ type: "knowledge" as const, r })),
  ];
  const time = (d: Date | null) => (d ? new Date(d).getTime() : 0);
  tagged.sort(
    (a, b) =>
      Number(b.r.titleMatch) - Number(a.r.titleMatch) ||
      time(b.r.createdAt) - time(a.r.createdAt) ||
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
    hasFileText: d.extractedText !== null && d.extractedText !== undefined,
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
    hasFileText: p.extractedText !== null && p.extractedText !== undefined,
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
