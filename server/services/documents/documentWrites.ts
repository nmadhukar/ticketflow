import { z } from "zod";
import type { User } from "@shared/schema";
import { storage } from "../../storage";
import { HttpError } from "../../http/errors";
import { sanitizeRichHtml } from "../../security/sanitizeHtml";
import { decodeFileData, extractableType, EXTRACTED_TEXT_MAX_CHARS, type ExtractableType } from "./extractText";
import { fillHelpDocumentText, fillPolicyText } from "./documentText";
import {
  assertContentAdmin,
  presentGuide,
  presentHelpDocument,
  presentKnowledgeArticle,
  presentPolicy,
} from "./documentLibrary";
import { GUIDE_TYPES, mcpUploadLimitBytes, mcpUploadLimitMb } from "./types";

/**
 * Content writes on MCP (task MCP4, R89): create, update and publish or unpublish help documents,
 * company policies, user guides ("Guidelines") and knowledge articles. Each one mirrors its REST
 * admin route: the same admin gate (assertContentAdmin: stored role exactly "admin", 403
 * "Admin access required"), the same storage call, and the route's own rules (guide HTML
 * sanitised on the way in; a knowledge article's publish state set with setKnowledgeArticleStatus,
 * as PATCH /api/admin/knowledge/:id/publish does; a policy's isActive set as the toggle route
 * leaves it). Deleting is not here: it stays in the UI.
 *
 * A file arrives as base64 (`fileBase64`) with its `filename`: .docx, .pdf, .txt or .md, at most
 * mcpUploadLimitBytes() (the REST upload limit, or what base64 fits in the JSON request limit:
 * 36 MB at the defaults, review M6). The row is stored with extracted_text '' ("tried") first and
 * the file's text, extracted by the shared helper in its bounded process (R90, review N1/N2),
 * replaces it when it arrives; a file that gives no text keeps ''. A document
 * with no file stores its text in `content` and an empty file_data (both columns are NOT NULL);
 * the policy download route then serves the content. R94: MCP may create a policy from text alone,
 * although the REST upload route requires a file (an agent cannot easily attach one).
 */

const MIME_BY_TYPE: Record<ExtractableType, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
};

/** The MCP file limit in bytes (see mcpUploadLimitBytes). */
export const maxUploadBytes = (): number => mcpUploadLimitBytes();

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const validation = (field: string, message: string) =>
  new HttpError(400, "validation_failed", message, { formErrors: [], fieldErrors: { [field]: [message] } });

interface DecodedFile {
  filename: string;
  base64: string;
  buffer: Buffer;
  size: number;
  mimeType: string;
}

/** Validates and decodes an uploaded file. Its text is extracted after the row is stored (review N2). */
async function decodeUpload(filename: string, fileBase64: string): Promise<DecodedFile> {
  const type = extractableType(filename);
  if (!type) throw validation("filename", "filename must end in .docx, .pdf, .txt or .md");
  const raw = fileBase64.startsWith("data:") ? fileBase64.slice(fileBase64.indexOf(",") + 1) : fileBase64;
  const compact = raw.replace(/\s+/g, "");
  if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64.test(compact)) {
    throw validation("fileBase64", "fileBase64 must be the file's bytes in base64");
  }
  const buffer = decodeFileData(compact);
  if (buffer.length === 0) throw validation("fileBase64", "The file is empty");
  if (buffer.length > maxUploadBytes()) {
    throw validation("fileBase64", `The file is larger than the MCP upload limit (${mcpUploadLimitMb()} MB)`);
  }
  return {
    filename,
    base64: buffer.toString("base64"),
    buffer,
    size: buffer.length,
    mimeType: MIME_BY_TYPE[type],
  };
}

/** A file name for a document that has no file: its title, made safe for a Content-Disposition header. */
export function textFileName(title: string): string {
  const base = title.replace(/[^A-Za-z0-9 ._-]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
  return `${base || "document"}.txt`;
}

// ---------------------------------------------------------------- argument schemas

const title = z.string().trim().min(1, "Required").max(255);
const text = z.string().trim().min(1, "Required").max(EXTRACTED_TEXT_MAX_CHARS);
const optionalText = z.string().max(EXTRACTED_TEXT_MAX_CHARS);
const tags = z.array(z.string().trim().min(1).max(100)).max(50);
const filename = z.string().trim().min(1).max(255);
const fileBase64 = z.string().min(1);

const bothOrNeither = (v: { filename?: string; fileBase64?: string }) => (v.filename === undefined) === (v.fileBase64 === undefined);
const fileRule = { message: "Pass filename and fileBase64 together, or neither", path: ["fileBase64"] };
const someField = (v: Record<string, unknown>) => Object.keys(v).length > 0;
const nothingToUpdate = { message: "Nothing to update: pass at least one field besides id" };

export const helpCreateInput = z
  .object({ title, category: z.string().trim().min(1, "Required").max(100), content: text, tags: tags.optional(), filename: filename.optional(), fileBase64: fileBase64.optional() })
  .strict()
  .refine(bothOrNeither, fileRule);

export const helpUpdateInput = z
  .object({ title, category: z.string().trim().min(1).max(100), content: text, tags, filename, fileBase64 })
  .partial()
  .strict()
  .refine(bothOrNeither, fileRule)
  .refine(someField, nothingToUpdate);

export const policyCreateInput = z
  .object({
    title,
    description: optionalText.optional(),
    content: optionalText.optional(),
    isActive: z.boolean().optional(),
    filename: filename.optional(),
    fileBase64: fileBase64.optional(),
  })
  .strict()
  .refine(bothOrNeither, fileRule)
  .refine((v) => v.fileBase64 !== undefined || (v.content ?? "").trim().length > 0, {
    message: "Pass the policy text as content, or a file (filename and fileBase64)",
    path: ["content"],
  });

export const policyUpdateInput = z
  .object({ title, description: optionalText, content: optionalText, isActive: z.boolean(), filename, fileBase64 })
  .partial()
  .strict()
  .refine(bothOrNeither, fileRule)
  .refine(someField, nothingToUpdate);

const url = z.string().trim().url().max(500);

export const guideCreateInput = z
  .object({
    title,
    category: z.string().trim().min(1, "Required").max(100),
    content: text,
    type: z.enum(GUIDE_TYPES).optional(),
    description: optionalText.optional(),
    scribehowUrl: url.optional(),
    videoUrl: url.optional(),
    tags: tags.optional(),
    isPublished: z.boolean().optional(),
  })
  .strict();

export const guideUpdateInput = z
  .object({
    title,
    category: z.string().trim().min(1).max(100),
    content: text,
    type: z.enum(GUIDE_TYPES),
    description: optionalText,
    scribehowUrl: url,
    videoUrl: url,
    tags,
    isPublished: z.boolean(),
  })
  .partial()
  .strict()
  .refine(someField, nothingToUpdate);

export const knowledgeCreateInput = z
  .object({
    title,
    content: text,
    summary: optionalText.optional(),
    category: z.string().trim().min(1).max(100).optional(),
    tags: tags.optional(),
    isPublished: z.boolean().optional(),
  })
  .strict();

export const knowledgeUpdateInput = z
  .object({
    title,
    content: text,
    summary: optionalText,
    category: z.string().trim().min(1).max(100),
    tags,
    isPublished: z.boolean(),
  })
  .partial()
  .strict()
  .refine(someField, nothingToUpdate);

// ---------------------------------------------------------------- help documents (POST/PUT /api/admin/help)

export async function createHelpDocumentAs(user: User, input: z.input<typeof helpCreateInput>) {
  assertContentAdmin(user);
  const v = helpCreateInput.parse(input);
  const file = v.fileBase64 !== undefined ? await decodeUpload(v.filename!, v.fileBase64) : null;
  const doc = await storage.createHelpDocument({
    title: v.title,
    filename: file?.filename ?? textFileName(v.title),
    content: v.content,
    fileData: file?.base64 ?? "",
    // '' = tried (review N2); NULL with no file, which the backfill skips (file_data is '').
    extractedText: file ? "" : null,
    category: v.category,
    tags: v.tags,
    uploadedBy: user.id,
  });
  if (file) doc.extractedText = await fillHelpDocumentText(doc.id, { filename: file.filename, data: file.buffer });
  return presentHelpDocument(doc);
}

export async function updateHelpDocumentAs(user: User, id: number, input: z.input<typeof helpUpdateInput>) {
  assertContentAdmin(user);
  const v = helpUpdateInput.parse(input);
  if (!(await storage.getHelpDocument(id))) throw new HttpError(404, "not_found", "Help document not found");
  const file = v.fileBase64 !== undefined ? await decodeUpload(v.filename!, v.fileBase64) : null;
  const doc = await storage.updateHelpDocument(id, {
    title: v.title,
    category: v.category,
    content: v.content,
    tags: v.tags,
    ...(file ? { filename: file.filename, fileData: file.base64, extractedText: "" } : {}),
  });
  if (file) doc.extractedText = await fillHelpDocumentText(id, { filename: file.filename, data: file.buffer });
  return presentHelpDocument(doc);
}

// ---------------------------------------------------------------- policies (POST/PUT /api/admin/company-policies, /toggle)

export async function createPolicyAs(user: User, input: z.input<typeof policyCreateInput>) {
  assertContentAdmin(user);
  const v = policyCreateInput.parse(input);
  const file = v.fileBase64 !== undefined ? await decodeUpload(v.filename!, v.fileBase64) : null;
  const content = v.content?.trim() ? v.content : null;
  const policy = await storage.createCompanyPolicy({
    title: v.title,
    description: v.description,
    content,
    fileData: file?.base64 ?? "",
    extractedText: file ? "" : null,
    fileName: file?.filename ?? textFileName(v.title),
    fileSize: file?.size ?? Buffer.byteLength(content ?? "", "utf8"),
    mimeType: file?.mimeType ?? "text/plain",
    uploadedBy: user.id,
    isActive: v.isActive ?? true,
  });
  if (file) policy.extractedText = await fillPolicyText(policy.id, { filename: file.filename, data: file.buffer });
  return presentPolicy(policy);
}

export async function updatePolicyAs(user: User, id: number, input: z.input<typeof policyUpdateInput>) {
  assertContentAdmin(user);
  const v = policyUpdateInput.parse(input);
  const existing = await storage.getCompanyPolicyById(id);
  if (!existing) throw new HttpError(404, "not_found", "Company policy not found");
  const file = v.fileBase64 !== undefined ? await decodeUpload(v.filename!, v.fileBase64) : null;
  const update: Parameters<typeof storage.updateCompanyPolicy>[1] = {
    title: v.title,
    description: v.description,
    content: v.content,
    isActive: v.isActive,
  };
  if (file) {
    // As PUT /api/admin/company-policies/:id with a file: the file replaces the old one and the
    // old content (kept only when new content comes with it).
    Object.assign(update, {
      fileData: file.base64,
      extractedText: "",
      fileName: file.filename,
      fileSize: file.size,
      mimeType: file.mimeType,
      content: v.content ?? null,
    });
  } else if (v.content !== undefined && !existing.fileData) {
    // A policy with no file is downloaded as its content: keep the size in step.
    update.fileSize = Buffer.byteLength(v.content, "utf8");
  }
  const policy = await storage.updateCompanyPolicy(id, update);
  if (file) policy.extractedText = await fillPolicyText(id, { filename: file.filename, data: file.buffer });
  return presentPolicy(policy);
}

// ---------------------------------------------------------------- guides (POST/PUT /api/admin/guides)

export async function createGuideAs(user: User, input: z.input<typeof guideCreateInput>) {
  assertContentAdmin(user);
  const v = guideCreateInput.parse(input);
  const guide = await storage.createUserGuide({
    ...v,
    type: v.type ?? "html",
    isPublished: v.isPublished ?? true,
    content: sanitizeRichHtml(v.content),
    createdBy: user.id,
  });
  return presentGuide(guide);
}

export async function updateGuideAs(user: User, id: number, input: z.input<typeof guideUpdateInput>) {
  assertContentAdmin(user);
  const v = guideUpdateInput.parse(input);
  if (!(await storage.getUserGuideById(id))) throw new HttpError(404, "not_found", "Guide not found");
  const update = { ...v };
  if (update.content !== undefined) update.content = sanitizeRichHtml(update.content);
  return presentGuide(await storage.updateUserGuide(id, update));
}

// ---------------------------------------------------------------- knowledge (POST/PUT /api/admin/knowledge, PATCH .../publish)

export async function createKnowledgeArticleAs(user: User, input: z.input<typeof knowledgeCreateInput>) {
  assertContentAdmin(user);
  const v = knowledgeCreateInput.parse(input);
  const article = await storage.createKnowledgeArticle({
    title: v.title,
    summary: v.summary || null,
    content: v.content,
    category: v.category || "general",
    tags: v.tags || [],
    isPublished: v.isPublished || false,
    createdBy: user.id,
    source: "manual",
  } as Parameters<typeof storage.createKnowledgeArticle>[0]);
  return presentKnowledgeArticle(article);
}

export async function updateKnowledgeArticleAs(user: User, id: number, input: z.input<typeof knowledgeUpdateInput>) {
  assertContentAdmin(user);
  const v = knowledgeUpdateInput.parse(input);
  if (!(await storage.getKnowledgeArticle(id))) throw new HttpError(404, "not_found", "Article not found");
  const { isPublished, ...fields } = v;
  let article = Object.keys(fields).length > 0 ? await storage.updateKnowledgeArticle(id, fields) : undefined;
  if (isPublished !== undefined) {
    // PATCH /api/admin/knowledge/:id/publish: status and is_published move together.
    article = await storage.setKnowledgeArticleStatus(id, isPublished ? "published" : "draft");
  }
  return presentKnowledgeArticle(article!);
}
