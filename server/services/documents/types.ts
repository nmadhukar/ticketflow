/** Document vocabulary shared by the MCP tools and the document services (task MCP4); no database imports. */

export const DOCUMENT_TYPES = ["help", "policy", "guideline", "knowledge"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** search_documents: the most results one call returns. */
export const SEARCH_MAX_LIMIT = 50;

/** user_guides.type, as the admin guide form offers them. */
export const GUIDE_TYPES = ["html", "scribehow", "video"] as const;

const MB = 1024 * 1024;
const positiveInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && /^[1-9][0-9]*$/.test(raw.trim()) && Number.isSafeInteger(n) ? n : fallback;
};

/**
 * The largest file an MCP tool accepts, in bytes (review M6). Two limits apply: the REST upload
 * limit (MAX_FILE_UPLOAD_SIZE_MB, default 50, the multer limit) and the JSON request limit
 * (MAX_REQUEST_SIZE_MB, default 50), which has to hold the file as base64 (4/3 of its size) plus
 * the rest of the call (2 MB of headroom). The lower one is the real limit: 36 MB at the defaults.
 */
export function mcpUploadLimitBytes(env: Record<string, string | undefined> = process.env): number {
  const fileLimit = positiveInt(env.MAX_FILE_UPLOAD_SIZE_MB, 50) * MB;
  const requestLimit = positiveInt(env.MAX_REQUEST_SIZE_MB, 50) * MB;
  return Math.max(0, Math.min(fileLimit, Math.floor(((requestLimit - 2 * MB) * 3) / 4)));
}

/** mcpUploadLimitBytes in whole MB, for descriptions and messages. */
export const mcpUploadLimitMb = (env: Record<string, string | undefined> = process.env) =>
  Math.floor(mcpUploadLimitBytes(env) / MB);
