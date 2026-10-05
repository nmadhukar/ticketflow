import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { describeError } from "../../http/errors";

/**
 * R90: the ONE helper that turns an uploaded document into searchable text. Every writer of
 * help_documents.extracted_text and company_policies.extracted_text calls it: the REST create and
 * update routes, the MCP write tools and the startup backfill.
 *
 * Supported: .docx (mammoth extractRawText), .pdf (unpdf, the serverless PDF.js build), .txt and
 * .md (UTF-8). The type comes from the file name's extension, else from the MIME type. Anything
 * else, or a file that does not parse, gives null; a failure is logged by error type only (a
 * document's text or a parser message never reaches the log).
 *
 * Review I1: a .docx or .pdf is parsed in a worker thread (./extractWorker.mjs), never in the
 * server's isolate. A small hostile file (a zip bomb, an inflating PDF stream) can exhaust memory
 * or CPU, and an out-of-memory abort cannot be caught: in a worker it only ends the worker.
 * - heap limit: EXTRACT_DEFAULT_MAX_MEMORY_MB (256), DOCUMENT_EXTRACT_MAX_MB overrides;
 * - time limit: EXTRACT_TIMEOUT_MS (20 s), then worker.terminate();
 * - a .docx is refused before any parsing when its zip central directory says it inflates past
 *   DOCX_MAX_UNCOMPRESSED_BYTES, or past DOCX_RATIO_FLOOR_BYTES at an absurd compression ratio;
 * - a .pdf with more than PDF_MAX_PAGES pages is refused;
 * - at most MAX_CONCURRENT_EXTRACTIONS workers at once (the others wait their turn).
 */

export const EXTRACTED_TEXT_MAX_CHARS = 1_000_000;
export const EXTRACT_TIMEOUT_MS = 20_000;
export const EXTRACT_DEFAULT_MAX_MEMORY_MB = 256;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const DOCX_RATIO_FLOOR_BYTES = 10 * 1024 * 1024;
export const DOCX_MAX_RATIO = 100;
export const PDF_MAX_PAGES = 500;
export const MAX_CONCURRENT_EXTRACTIONS = 2;
/** The worker's file name in dist/, next to index.js (package.json `build`). */
export const WORKER_BUNDLE_NAME = "documentExtractWorker.mjs";
const WORKER_SOURCE_NAME = "extractWorker.mjs";

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

// ---------------------------------------------------------------- zip pre-check (.docx)

/**
 * The totals a zip's central directory declares, without inflating anything; null when the bytes
 * are not a zip this code reads (no end-of-central-directory record, a truncated directory, or a
 * Zip64 archive, which no real .docx needs). The declared sizes can lie: the worker's heap limit
 * is the backstop for that.
 */
export function inspectZip(buf: Buffer): { entries: number; compressed: number; uncompressed: number } | null {
  if (buf.length < 22) return null;
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let eocd = buf.length - 22; eocd >= lowest; eocd--) {
    if (buf.readUInt32LE(eocd) !== 0x06054b50) continue;
    const entries = buf.readUInt16LE(eocd + 10);
    const size = buf.readUInt32LE(eocd + 12);
    const offset = buf.readUInt32LE(eocd + 16);
    if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff || offset + size > eocd) return null;
    let p = offset;
    let compressed = 0;
    let uncompressed = 0;
    for (let n = 0; n < entries; n++) {
      if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) return null;
      const c = buf.readUInt32LE(p + 20);
      const u = buf.readUInt32LE(p + 24);
      if (c === 0xffffffff || u === 0xffffffff) return null;
      compressed += c;
      uncompressed += u;
      p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
    return { entries, compressed, uncompressed };
  }
  return null;
}

/** Why a .docx is refused before parsing, as a log type; null when it may be parsed. */
function docxRefusal(buf: Buffer): string | null {
  const zip = inspectZip(buf);
  if (!zip) return "InvalidZip";
  if (zip.uncompressed > DOCX_MAX_UNCOMPRESSED_BYTES) return "docx too large";
  if (zip.uncompressed > DOCX_RATIO_FLOOR_BYTES && zip.uncompressed > DOCX_MAX_RATIO * Math.max(zip.compressed, 1)) {
    return "docx too large";
  }
  return null;
}

// ---------------------------------------------------------------- the worker

/** The worker heap limit in MB: DOCUMENT_EXTRACT_MAX_MB (16-4096) or the default. */
export function extractMemoryLimitMb(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DOCUMENT_EXTRACT_MAX_MB?.trim() ?? "";
  const n = Number(raw);
  return /^[0-9]+$/.test(raw) && n >= 16 && n <= 4096 ? n : EXTRACT_DEFAULT_MAX_MEMORY_MB;
}

/**
 * Where the worker file may be, in order: next to the bundle (production runs `node
 * dist/index.js`, and dist/ holds WORKER_BUNDLE_NAME; the entry's path, not the cwd, as
 * server/bootGuard.ts does); beside this file when it runs as CommonJS (Jest); in the source tree
 * under the entry (`tsx server/index.ts`) or the working directory.
 */
export function extractWorkerCandidates(entry: string | undefined = process.argv[1]): string[] {
  const out: string[] = [];
  const entryDir = entry ? path.dirname(path.resolve(entry)) : null;
  if (entryDir) out.push(path.join(entryDir, WORKER_BUNDLE_NAME));
  if (typeof __dirname !== "undefined") out.push(path.join(__dirname, WORKER_SOURCE_NAME));
  if (entryDir) out.push(path.join(entryDir, "services", "documents", WORKER_SOURCE_NAME));
  out.push(path.resolve("server", "services", "documents", WORKER_SOURCE_NAME));
  return out;
}

let workerFile: string | null | undefined;

/** The worker file in use, or null when none of the candidates exists. */
export function extractWorkerFile(): string | null {
  if (workerFile === undefined) workerFile = extractWorkerCandidates().find((p) => existsSync(p)) ?? null;
  return workerFile;
}

/** False when .docx and .pdf cannot be parsed here (the worker file is missing): the backfill then waits. */
export function documentExtractionAvailable(): boolean {
  return extractWorkerFile() !== null;
}

let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_EXTRACTIONS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await run();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export interface ExtractOptions {
  /** Wall-clock limit for one parse (default EXTRACT_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Worker heap limit (default extractMemoryLimitMb()). */
  maxMemoryMb?: number;
  /** PDF page cap (default PDF_MAX_PAGES). */
  maxPdfPages?: number;
}

const failed = (type: string): null => {
  console.error(`Document text extraction failed [${type}]`);
  return null;
};

function parseInWorker(type: "docx" | "pdf", buffer: Buffer, opts: ExtractOptions): Promise<string | null> {
  const file = extractWorkerFile();
  if (!file) return Promise.resolve(failed("worker missing"));
  return withSlot(
    () =>
      new Promise<string | null>((resolve) => {
        // The worker gets its own copy of the bytes (transferred, not shared).
        const bytes = new Uint8Array(buffer.length);
        bytes.set(buffer);
        let settled = false;
        const worker = new Worker(file, {
          workerData: { type, bytes, maxChars: EXTRACTED_TEXT_MAX_CHARS, maxPdfPages: opts.maxPdfPages ?? PDF_MAX_PAGES },
          transferList: [bytes.buffer],
          resourceLimits: { maxOldGenerationSizeMb: opts.maxMemoryMb ?? extractMemoryLimitMb() },
          // Its output is discarded (review M1); it inherits no runtime flags from this process.
          stdout: true,
          stderr: true,
          execArgv: [],
        });
        worker.stdout.resume();
        worker.stderr.resume();
        const finish = (text: string | null, failure?: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          resolve(failure ? failed(failure) : text);
        };
        const timer = setTimeout(() => finish(null, "timeout"), opts.timeoutMs ?? EXTRACT_TIMEOUT_MS);
        worker.on("message", (m: { ok?: boolean; text?: unknown; error?: unknown }) => {
          if (m?.ok === true && typeof m.text === "string") finish(m.text);
          else finish(null, typeof m?.error === "string" ? m.error : "worker error");
        });
        worker.on("error", (error) => finish(null, describeError(error)));
        worker.on("exit", (code) => finish(null, `worker exit ${code}`));
      })
  );
}

export interface DocumentFile {
  filename?: string | null;
  mimeType?: string | null;
  /** The stored file: base64 (or a Buffer). */
  data: string | Buffer | null | undefined;
}

/** The document's text (at most EXTRACTED_TEXT_MAX_CHARS), or null when unsupported, empty or unreadable. */
export async function extractDocumentText(file: DocumentFile, opts: ExtractOptions = {}): Promise<string | null> {
  const type = extractableType(file.filename, file.mimeType);
  if (!type || !file.data || file.data.length === 0) return null;
  try {
    const buffer = typeof file.data === "string" ? decodeFileData(file.data) : file.data;
    if (buffer.length === 0) return null;
    if (type === "txt" || type === "md") {
      // A UTF-8 byte order mark is not text.
      const utf8 = buffer.toString("utf8");
      return tidy(utf8.charCodeAt(0) === 0xfeff ? utf8.slice(1) : utf8);
    }
    if (type === "docx") {
      const refusal = docxRefusal(buffer);
      if (refusal) return failed(refusal);
    }
    return await parseInWorker(type, buffer, opts);
  } catch (error) {
    return failed(describeError(error));
  }
}
