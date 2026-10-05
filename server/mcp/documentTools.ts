import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "@shared/schema";
import { guard } from "../services/tickets/ticketError";
import { DOCUMENT_TYPES, GUIDE_TYPES, SEARCH_MAX_LIMIT, mcpUploadLimitMb } from "../services/documents/types";
import {
  assertContentAdmin,
  getDocument,
  listGuideCategories,
  searchDocuments,
  searchTerms,
} from "../services/documents/documentLibrary";
import {
  createGuideAs,
  createHelpDocumentAs,
  createKnowledgeArticleAs,
  createPolicyAs,
  updateGuideAs,
  updateHelpDocumentAs,
  updateKnowledgeArticleAs,
  updatePolicyAs,
} from "../services/documents/documentWrites";
import { runTool } from "./errors";
import { anyValue, assertToolId, given, idArg, pagingValue } from "./args";

/**
 * Documents on MCP (task MCP4). Rulings:
 * - R89: content writes are allowed: create, update and publish/unpublish help documents,
 *   policies, guidelines (user guides) and knowledge articles, admin-only exactly as the REST
 *   admin routes. Deleting stays in the UI. R87 still holds for everything else.
 * - R90: an uploaded file's text is extracted (docx, pdf, txt, md) and searched.
 * - R91: search_documents covers all four sources, each with its REST read route's visibility.
 * - R92: the server instructions tell the model to search these before answering.
 * - R94: create_policy may create a policy from text alone (REST needs a file upload).
 * Same key permission as every tool (mcp:tickets, R85). Arguments are loose strings in tools/list
 * (allowed values in the description) and parsed here, so a bad value is a coded VALIDATION.
 */

const TYPE_LIST = DOCUMENT_TYPES.join(", ");
// Review M6: the real limit (the REST upload limit, or what base64 fits in the request limit), read per server.
const fileNote = () =>
  `A file is optional: filename (ending .docx, .pdf, .txt or .md) and fileBase64 (the file's bytes in base64, at most ${mcpUploadLimitMb()} MB) go together; its text is extracted and becomes searchable.`;
const ADMIN_NOTE = "Admin only, as the REST admin route (anyone else: FORBIDDEN).";

/**
 * Review M4: every optional argument also accepts null, which counts as absent (present() drops
 * it), instead of the SDK answering an uncoded protocol error. anyValue arguments take null already.
 */
function lenient(shape: z.ZodRawShape) {
  const out: z.ZodRawShape = {};
  for (const [key, schema] of Object.entries(shape)) {
    if (schema instanceof z.ZodOptional && !(schema.unwrap() instanceof z.ZodUnion)) {
      const inner = schema.unwrap() as z.ZodTypeAny;
      const nullable = inner.nullable();
      out[key] = (inner.description ? nullable.describe(inner.description) : nullable).optional();
    } else {
      out[key] = schema;
    }
  }
  return z.object(out);
}

/** Drops absent values (undefined, null, ""), so an optional argument a client sends empty counts as not given. */
function present(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    const value = given(v);
    if (value !== undefined && k !== "id") out[k] = value;
  }
  return out;
}

const searchInput = z.object({
  // Reviews I2 and N4: the query is split into keywords; one with none ("AT&T") is searched as a
  // phrase, so only an empty or whitespace-only query is refused.
  query: z.string().trim().min(1, "Required: the key words to find, e.g. \"DoseSpot clinic key\"").max(200),
  type: z.enum(DOCUMENT_TYPES, { errorMap: () => ({ message: `Must be one of: ${TYPE_LIST}` }) }).optional(),
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).default(10),
});
const typeInput = z.object({
  type: z.enum(DOCUMENT_TYPES, { errorMap: () => ({ message: `Must be one of: ${TYPE_LIST}` }) }),
});

// Shared argument descriptions (each a fresh schema: one instance used twice becomes a $ref).
const str = (description: string) => z.string().describe(description);
const titleArg = () => str("Title, 1-255 characters");
const tagsArg = () => z.array(z.string()).describe("Tags, e.g. [\"setup\", \"dosespot\"]").optional();
const filenameArg = () => str("File name ending .docx, .pdf, .txt or .md; send with fileBase64").optional();
const fileArg = () => str(`The file's bytes in base64, at most ${mcpUploadLimitMb()} MB; send with filename`).optional();
const guideTypeArg = () => str(`Guide type, one of: ${GUIDE_TYPES.join(", ")} (default html)`).optional();

export function registerDocumentTools(server: McpServer, user: User): void {
  const viewer = { id: user.id, role: user.role };

  /** An update tool's handler: the admin gate first (as REST: 403 before anything is read), then the id, then the fields. */
  const byIdAsAdmin =
    (update: (id: number, input: never) => Promise<unknown>) =>
    (args: Record<string, unknown>) =>
      runTool(() =>
        guard(async () => {
          assertContentAdmin(user);
          return update(assertToolId(args.id), present(args) as never);
        })
      );

  server.registerTool(
    "search_documents",
    {
      description: `Search the organisation's documents: help documents (type help), company policies (policy), guidelines (guideline, the user guides) and knowledge articles (knowledge). Use it BEFORE answering a how-to, setup or policy question, then read the best hit with get_document. Search with the key words of the question, e.g. "DoseSpot clinic key": each word is matched separately (case-insensitive, also inside longer words) in the title, description or summary, content and the text of an uploaded file, and a document matching ANY of them is returned. Common words (how, do, I, the...) are ignored; a query with no other word (e.g. "AT&T") is searched as one phrase. Documents matching more of the words come first, then those with the words in the title, then the newest. If nothing fits, try other words or synonyms. Only documents the key's owner can read in the app are searched (drafts and inactive policies only for those REST shows them to). Returns {results: [{type, id, title, category, snippet, published, matchedTerms}], returned, terms}.`,
      inputSchema: lenient({
        query: str("The key words to find, e.g. \"DoseSpot clinic key\" (1-200 characters; common words are ignored, at most 12 key words; with no other word the query is one phrase)"),
        type: str(`Only this kind of document, one of: ${TYPE_LIST}`).optional(),
        limit: anyValue().describe(`Results, 1-${SEARCH_MAX_LIMIT} (default 10); a number or a numeric string`).optional(),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const raw = present(args);
          if (raw.limit !== undefined) raw.limit = pagingValue(raw.limit);
          const input = searchInput.parse(raw);
          const results = await searchDocuments(viewer, input);
          return { results, returned: results.length, terms: searchTerms(input.query) };
        })
      )
  );

  server.registerTool(
    "get_document",
    {
      description: `Read one document found by search_documents: type (${TYPE_LIST}) and id. Returns its metadata and its full readable text in \`text\` (help and policy: the content plus the uploaded file's text; guideline: description and content, with the HTML in \`content\` and scribehowUrl/videoUrl; knowledge: summary and content), capped at 200,000 characters with \`truncated\`. Never returns the file itself. Unknown, or not readable by the key's owner (a draft, an inactive policy): NOT_FOUND.`,
      inputSchema: lenient({
        type: str(`Kind of document, one of: ${TYPE_LIST}`),
        id: idArg("Document"),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const { type } = typeInput.parse(present(args));
          return getDocument(viewer, type, assertToolId(args.id));
        })
      )
  );

  server.registerTool(
    "list_guideline_categories",
    {
      description:
        "The guideline (user guide) categories, as GET /api/guide-categories: {categories: [{id, name, description, icon, displayOrder}]}. A guideline's category is one of these names.",
      inputSchema: z.object({}),
    },
    () => runTool(() => guard(async () => ({ categories: await listGuideCategories() })))
  );

  // ------------------------------------------------------------ help documents

  server.registerTool(
    "create_help_document",
    {
      description: `Create a help document, as POST /api/admin/help. Requires title, category and content (the document's text or a summary of it). ${fileNote()} Help documents are visible to every signed-in user. ${ADMIN_NOTE} Returns the document as get_document does.`,
      inputSchema: lenient({
        title: titleArg(),
        category: str("Category, e.g. Technical or General (1-100 characters)"),
        content: str("The document's text (or a summary when a file carries the full text)"),
        tags: tagsArg(),
        filename: filenameArg(),
        fileBase64: fileArg(),
      }),
    },
    (args) => runTool(() => guard(() => createHelpDocumentAs(user, present(args) as never)))
  );

  server.registerTool(
    "update_help_document",
    {
      description: `Update a help document, as PUT /api/admin/help/:id. id is required; every other field is optional and only the ones given change. A new file (filename and fileBase64) replaces the old one and its text. ${ADMIN_NOTE}`,
      inputSchema: lenient({
        id: idArg("Help document"),
        title: titleArg().optional(),
        category: str("Category (1-100 characters)").optional(),
        content: str("The document's text").optional(),
        tags: tagsArg(),
        filename: filenameArg(),
        fileBase64: fileArg(),
      }),
    },
    byIdAsAdmin((id, input) => updateHelpDocumentAs(user, id, input))
  );

  // ------------------------------------------------------------ company policies

  server.registerTool(
    "create_policy",
    {
      description: `Create a company policy, as POST /api/admin/company-policies. Requires title, and either content (the policy text) or a file. A text-only policy is allowed here (R94), although the app's upload form needs a file: it is stored as "<title>.txt" and downloads as its content. ${fileNote()} isActive publishes it (default true); an inactive policy is seen only by admins. ${ADMIN_NOTE}`,
      inputSchema: lenient({
        title: titleArg(),
        description: str("Short description").optional(),
        content: str("The policy text (required when no file is sent)").optional(),
        isActive: z.boolean().describe("true publishes the policy (default), false keeps it hidden from non-admins").optional(),
        filename: filenameArg(),
        fileBase64: fileArg(),
      }),
    },
    (args) => runTool(() => guard(() => createPolicyAs(user, present(args) as never)))
  );

  server.registerTool(
    "update_policy",
    {
      description: `Update a company policy, as PUT /api/admin/company-policies/:id; isActive publishes (true) or unpublishes (false) it, as the toggle route. id is required; only the fields given change. A new file replaces the old one and its text. ${ADMIN_NOTE}`,
      inputSchema: lenient({
        id: idArg("Policy"),
        title: titleArg().optional(),
        description: str("Short description").optional(),
        content: str("The policy text").optional(),
        isActive: z.boolean().describe("true publishes, false unpublishes").optional(),
        filename: filenameArg(),
        fileBase64: fileArg(),
      }),
    },
    byIdAsAdmin((id, input) => updatePolicyAs(user, id, input))
  );

  // ------------------------------------------------------------ guidelines (user guides)

  server.registerTool(
    "create_guideline",
    {
      description: `Create a guideline (a user guide), as POST /api/admin/guides. Requires title, category (a category NAME from list_guideline_categories) and content (HTML or plain text; HTML is sanitised as in the app). Optional type (${GUIDE_TYPES.join(", ")}; default html), description, scribehowUrl, videoUrl, tags, isPublished (default true; a draft is seen only by staff). ${ADMIN_NOTE}`,
      inputSchema: lenient({
        title: titleArg(),
        category: str("Category name, as list_guideline_categories returns it"),
        content: str("The guide's content: HTML or plain text"),
        type: guideTypeArg(),
        description: str("Short description").optional(),
        scribehowUrl: str("Scribehow link (type scribehow)").optional(),
        videoUrl: str("Video link (type video)").optional(),
        tags: tagsArg(),
        isPublished: z.boolean().describe("true publishes (default), false keeps it a draft").optional(),
      }),
    },
    (args) => runTool(() => guard(() => createGuideAs(user, present(args) as never)))
  );

  server.registerTool(
    "update_guideline",
    {
      description: `Update a guideline (a user guide), as PUT /api/admin/guides/:id; isPublished publishes (true) or unpublishes (false) it. id is required; only the fields given change. ${ADMIN_NOTE}`,
      inputSchema: lenient({
        id: idArg("Guideline"),
        title: titleArg().optional(),
        category: str("Category name, as list_guideline_categories returns it").optional(),
        content: str("The guide's content: HTML or plain text").optional(),
        type: guideTypeArg(),
        description: str("Short description").optional(),
        scribehowUrl: str("Scribehow link").optional(),
        videoUrl: str("Video link").optional(),
        tags: tagsArg(),
        isPublished: z.boolean().describe("true publishes, false unpublishes").optional(),
      }),
    },
    byIdAsAdmin((id, input) => updateGuideAs(user, id, input))
  );

  // ------------------------------------------------------------ knowledge articles

  server.registerTool(
    "create_knowledge_article",
    {
      description: `Create a knowledge article, as POST /api/admin/knowledge. Requires title and content. Optional summary, category (default general), tags, isPublished (default false: a draft, seen only by admins). ${ADMIN_NOTE}`,
      inputSchema: lenient({
        title: titleArg(),
        content: str("The article's text"),
        summary: str("Short summary").optional(),
        category: str("Category, e.g. general").optional(),
        tags: tagsArg(),
        isPublished: z.boolean().describe("true publishes it; default false (draft)").optional(),
      }),
    },
    (args) => runTool(() => guard(() => createKnowledgeArticleAs(user, present(args) as never)))
  );

  server.registerTool(
    "update_knowledge_article",
    {
      description: `Update a knowledge article, as PUT /api/admin/knowledge/:id; isPublished publishes (true) or unpublishes (false) it, as PATCH /api/admin/knowledge/:id/publish. id is required; only the fields given change. ${ADMIN_NOTE}`,
      inputSchema: lenient({
        id: idArg("Article"),
        title: titleArg().optional(),
        content: str("The article's text").optional(),
        summary: str("Short summary").optional(),
        category: str("Category").optional(),
        tags: tagsArg(),
        isPublished: z.boolean().describe("true publishes, false unpublishes").optional(),
      }),
    },
    byIdAsAdmin((id, input) => updateKnowledgeArticleAs(user, id, input))
  );
}
