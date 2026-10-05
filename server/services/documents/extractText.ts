import { describeError } from "../../http/errors";

/**
 * R90: the ONE helper that turns an uploaded document into searchable text. Every writer of
 * help_documents.extracted_text and company_policies.extracted_text calls it: the REST create and
 * update routes, the MCP write tools and the startup backfill.
 *
 * Supported: .docx (mammoth extractRawText), .pdf (unpdf, the serverless PDF.js build: pure JS,
 * no native code), .txt and .md (UTF-8). The type comes from the file name's extension, else
 * from the MIME type. Anything else, or a file that does not parse, gives null; a parse failure
 * is logged by error type only (a document's text or a parser message never reaches the log).
 */

export const EXTRACTED_TEXT_MAX_CHARS = 1_000_000;

export type ExtractableType = "docx" | "pdf" | "txt" | "md";
export const EXTRACTABLE_EXTENSIONS: readonly ExtractableType[] = ["docx", "pdf", "txt", "md"];

const MIME_TYPES: Record<string, ExtractableType> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
};

/** The supported type of a file, from its extension, else its MIME type; null when unsupported. */
export function extractableType(filename?: string | null, mimeType?: string | null): ExtractableType | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename ?? "");
  const ext = match ? match[1].toLowerCase() : "";
  if ((EXTRACTABLE_EXTENSIONS as readonly string[]).includes(ext)) return ext as ExtractableType;
  const mime = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  return MIME_TYPES[mime] ?? null;
}

export function isExtractable(filename?: string | null, mimeType?: string | null): boolean {
  return extractableType(filename, mimeType) !== null;
}

/** Stored file data is base64; a `data:...;base64,` prefix and whitespace are tolerated. */
export function decodeFileData(fileData: string): Buffer {
  const comma = fileData.startsWith("data:") ? fileData.indexOf(",") : -1;
  return Buffer.from((comma >= 0 ? fileData.slice(comma + 1) : fileData).replace(/\s+/g, ""), "base64");
}

/** NUL characters cannot be stored in a Postgres text column; line ends are normalised; capped. */
function tidy(text: string): string {
  const clean = text.split("\u0000").join("").replace(/\r\n?/g, "\n").trim();
  return clean.length > EXTRACTED_TEXT_MAX_CHARS ? clean.slice(0, EXTRACTED_TEXT_MAX_CHARS) : clean;
}

async function pdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  // Given the bytes (not a proxy), unpdf opens the document and destroys it when done.
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return text;
}

async function docxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await (mammoth.default ?? mammoth).extractRawText({ buffer });
  return value;
}

export interface DocumentFile {
  filename?: string | null;
  mimeType?: string | null;
  /** The stored file: base64 (or a Buffer). */
  data: string | Buffer | null | undefined;
}

/** The document's text (at most EXTRACTED_TEXT_MAX_CHARS), or null when unsupported, empty or unreadable. */
export async function extractDocumentText(file: DocumentFile): Promise<string | null> {
  const type = extractableType(file.filename, file.mimeType);
  if (!type || !file.data || file.data.length === 0) return null;
  try {
    const buffer = typeof file.data === "string" ? decodeFileData(file.data) : file.data;
    if (buffer.length === 0) return null;
    if (type === "docx") return tidy(await docxText(buffer));
    if (type === "pdf") return tidy(await pdfText(buffer));
    // A UTF-8 byte order mark is not text.
    const utf8 = buffer.toString("utf8");
    return tidy(utf8.charCodeAt(0) === 0xfeff ? utf8.slice(1) : utf8);
  } catch (error) {
    console.error(`Document text extraction failed [${describeError(error)}]`);
    return null;
  }
}
