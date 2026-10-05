import { fork } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describeError } from "../../http/errors";

/**
 * R90: the ONE helper that turns an uploaded document into searchable text. Every writer of
 * help_documents.extracted_text and company_policies.extracted_text calls it: the REST create and
 * update routes, the MCP write tools and the startup backfill.
 *
 * Supported: .docx (word/document.xml read by ./extractChild.mjs), .pdf (unpdf, the serverless
 * PDF.js build), .txt and .md (UTF-8). The type comes from the file name's extension, else from
 * the MIME type. Anything else, or a file that does not parse, gives null; a failure is logged by
 * error type only (a document's text or a parser message never reaches the log).
 *
 * Reviews I1 and N1: a .docx or .pdf is parsed in a separate PROCESS (./extractChild.mjs), never
 * in the server. A small hostile file (a zip bomb, an inflating PDF stream) can grow memory
 * outside any V8 heap limit (ArrayBuffers), so the bounds are on the child process as a whole:
 * - RSS: the parent polls /proc/<pid>/status (Linux) every 50 ms and SIGKILLs the child above
 *   DOCUMENT_EXTRACT_MAX_MB (default EXTRACT_DEFAULT_MAX_RSS_MB, 384); a watchdog thread in the
 *   child enforces the same limit from inside (the fallback where /proc is absent);
 * - the kernel: on Linux the child sets its oom_score_adj to 1000, so an OOM kill takes it, not the server;
 * - heap: --max-old-space-size (EXTRACT_CHILD_HEAP_MB, at most 256);
 * - time: EXTRACT_TIMEOUT_MS (20 s) from the call, queue wait included, then SIGKILL;
 * - inflation: a .docx's word/document.xml is inflated with zlib's maxOutputLength against
 *   DOCX_INFLATE_BUDGET_BYTES, whatever its zip headers declare (and a .docx whose directory
 *   already declares too much is refused here without starting a child); a .pdf over
 *   PDF_MAX_PAGES pages is refused;
 * - concurrency: at most MAX_CONCURRENT_EXTRACTIONS children, MAX_QUEUED_EXTRACTIONS waiting.
 * A crash, an OOM kill, a watchdog kill or a timeout all give null; the server carries on.
 */

export const EXTRACTED_TEXT_MAX_CHARS = 1_000_000;
export const EXTRACT_TIMEOUT_MS = 20_000;
export const EXTRACT_DEFAULT_MAX_RSS_MB = 384;
export const EXTRACT_CHILD_HEAP_MB = 256;
export const DOCX_INFLATE_BUDGET_BYTES = 50 * 1024 * 1024;
export const DOCX_MAX_UNCOMPRESSED_BYTES = DOCX_INFLATE_BUDGET_BYTES;
export const DOCX_RATIO_FLOOR_BYTES = 10 * 1024 * 1024;
export const DOCX_MAX_RATIO = 100;
export const PDF_MAX_PAGES = 500;
export const MAX_CONCURRENT_EXTRACTIONS = 2;
export const MAX_QUEUED_EXTRACTIONS = 16;
const RSS_POLL_MS = 50;
/** The extractor's file name in dist/, next to index.js (package.json `build`). */
export const CHILD_BUNDLE_NAME = "documentExtractChild.mjs";
const CHILD_SOURCE_NAME = "extractChild.mjs";

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
 * Zip64 archive, which no real .docx needs). The declared sizes can lie, so this only refuses
 * the honest bombs early; the child's inflation budget is the real bound.
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

// ---------------------------------------------------------------- the extractor process

/** The extractor's RSS limit in MB: DOCUMENT_EXTRACT_MAX_MB (64-4096) or the default. */
export function extractMemoryLimitMb(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DOCUMENT_EXTRACT_MAX_MB?.trim() ?? "";
  const n = Number(raw);
  return /^[0-9]+$/.test(raw) && n >= 64 && n <= 4096 ? n : EXTRACT_DEFAULT_MAX_RSS_MB;
}

/**
 * Where the extractor may be, in order: next to the bundle (production runs `node
 * dist/index.js`, and dist/ holds CHILD_BUNDLE_NAME; the entry's path, not the cwd, as
 * server/bootGuard.ts does); beside this file when it runs as CommonJS (Jest); in the source tree
 * under the entry (`tsx server/index.ts`) or the working directory.
 */
export function extractChildCandidates(entry: string | undefined = process.argv[1]): string[] {
  const out: string[] = [];
  const entryDir = entry ? path.dirname(path.resolve(entry)) : null;
  if (entryDir) out.push(path.join(entryDir, CHILD_BUNDLE_NAME));
  if (typeof __dirname !== "undefined") out.push(path.join(__dirname, CHILD_SOURCE_NAME));
  if (entryDir) out.push(path.join(entryDir, "services", "documents", CHILD_SOURCE_NAME));
  out.push(path.resolve("server", "services", "documents", CHILD_SOURCE_NAME));
  return out;
}

let childFile: string | null | undefined;

/** The extractor file in use, or null when none of the candidates exists. */
export function extractChildFile(): string | null {
  if (childFile === undefined) childFile = extractChildCandidates().find((p) => existsSync(p)) ?? null;
  return childFile;
}

/** False when .docx and .pdf cannot be parsed here (the extractor file is missing): the backfill then waits. */
export function documentExtractionAvailable(): boolean {
  return extractChildFile() !== null;
}

/**
 * A counting semaphore (review N6). A released slot passes straight to the next waiter, so the
 * count never drops in between and no third caller can slip in; a waiter gives up after `waitMs`
 * ("timeout"), and when `maxQueue` callers already wait a new one is refused at once ("full").
 */
export function createSemaphore(max: number, maxQueue: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
    acquire(waitMs: number): Promise<"granted" | "timeout" | "full"> {
      if (active < max) {
        active++;
        return Promise.resolve("granted");
      }
      if (queue.length >= maxQueue) return Promise.resolve("full");
      if (waitMs <= 0) return Promise.resolve("timeout");
      return new Promise((resolve) => {
        const grant = () => {
          clearTimeout(timer);
          resolve("granted");
        };
        const timer = setTimeout(() => {
          const i = queue.indexOf(grant);
          if (i >= 0) queue.splice(i, 1);
          resolve("timeout");
        }, waitMs);
        queue.push(grant);
      });
    },
    release(): void {
      const next = queue.shift();
      if (next) next();
      else active--;
    },
  };
}

const slots = createSemaphore(MAX_CONCURRENT_EXTRACTIONS, MAX_QUEUED_EXTRACTIONS);

/** How many extractor processes run now (for tests and diagnostics). */
export const activeExtractions = (): number => slots.active;

export interface ExtractOptions {
  /** Wall-clock limit for one extraction, queue wait included (default EXTRACT_TIMEOUT_MS). */
  timeoutMs?: number;
  /** The extractor's RSS limit in MB (default extractMemoryLimitMb()). */
  maxRssMb?: number;
  /** PDF page cap (default PDF_MAX_PAGES). */
  maxPdfPages?: number;
}

const failed = (type: string): null => {
  console.error(`Document text extraction failed [${type}]`);
  return null;
};

/** VmRSS of a process in bytes, from /proc (Linux); null where it cannot be read. */
function procRss(pid: number): number | null {
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/** The environment the extractor gets: what Node needs to start, none of the server's settings or secrets. */
function childEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

function runChild(file: string, type: "docx" | "pdf", buffer: Buffer, opts: ExtractOptions, timeLeftMs: number) {
  return new Promise<string | null>((resolve) => {
    const rssLimitMb = opts.maxRssMb ?? extractMemoryLimitMb();
    const heapMb = Math.max(32, Math.min(EXTRACT_CHILD_HEAP_MB, rssLimitMb - 64));
    let settled = false;
    const child = fork(file, [], {
      execArgv: [`--max-old-space-size=${heapMb}`],
      // Its output is ignored (review M1); messages go over IPC.
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
      env: childEnv(),
    });
    const finish = (text: string | null, failure?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve(failure ? failed(failure) : text);
    };
    const timer = setTimeout(() => finish(null, "timeout"), Math.max(1, timeLeftMs));
    const limitBytes = rssLimitMb * 1024 * 1024;
    let pollable = process.platform === "linux";
    const poll = setInterval(() => {
      if (!pollable || child.pid === undefined) return;
      const rss = procRss(child.pid);
      if (rss === null) pollable = false;
      else if (rss > limitBytes) finish(null, "memory limit");
    }, RSS_POLL_MS);
    child.on("message", (m: { ok?: boolean; text?: unknown; error?: unknown }) => {
      if (m?.ok === true && typeof m.text === "string") finish(m.text);
      else finish(null, typeof m?.error === "string" ? m.error : "extractor error");
    });
    child.on("error", (error) => finish(null, describeError(error)));
    child.on("exit", (code, signal) => finish(null, signal ? `extractor killed ${signal}` : `extractor exit ${code}`));
    child.send({
      type,
      bytes: buffer,
      maxChars: EXTRACTED_TEXT_MAX_CHARS,
      maxPdfPages: opts.maxPdfPages ?? PDF_MAX_PAGES,
      docxBudget: DOCX_INFLATE_BUDGET_BYTES,
      rssLimitMb,
    });
  });
}

async function parseInChild(type: "docx" | "pdf", buffer: Buffer, opts: ExtractOptions): Promise<string | null> {
  const file = extractChildFile();
  if (!file) return failed("extractor missing");
  const deadline = Date.now() + (opts.timeoutMs ?? EXTRACT_TIMEOUT_MS);
  const slot = await slots.acquire(deadline - Date.now());
  if (slot === "full") return failed("busy");
  if (slot === "timeout") return failed("timeout");
  try {
    return await runChild(file, type, buffer, opts, deadline - Date.now());
  } finally {
    slots.release();
  }
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
    return await parseInChild(type, buffer, opts);
  } catch (error) {
    return failed(describeError(error));
  }
}
