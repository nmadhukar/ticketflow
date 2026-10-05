// The document text extractor process (review I1, fix round 2). server/services/documents/
// extractText.ts forks one per .docx or .pdf, so a hostile file can only ever kill THIS process:
// - its V8 heap is capped by --max-old-space-size (set by the parent);
// - on Linux it raises its own oom_score_adj to 1000, so a kernel or cgroup OOM kill picks it,
//   never the server;
// - the parent kills it above an RSS limit (polling /proc on Linux) and after a timeout, and a
//   watchdog thread in here does the same from inside (the fallback where /proc is absent).
// ArrayBuffers (inflated data) are outside the V8 heap limit, which is why the RSS checks exist.
// A .docx is not handed to a zip library at all: word/document.xml is located and inflated here
// with zlib's maxOutputLength against a fixed budget, so real inflation is bounded whatever the
// zip headers declare, and its text is read with a linear scan. A .pdf goes to unpdf (PDF.js)
// with a page cap; the RSS limit is its bound.
//
// Plain JavaScript, no build step in development or under Jest; `npm run build` bundles it to
// dist/documentExtractChild.mjs next to dist/index.js.
//
// In (IPC message): { type: "docx" | "pdf", bytes, maxChars, maxPdfPages, docxBudget, rssLimitMb }
// Out (IPC message): { ok: true, text } or { ok: false, error: "<error type>" }, then exit.
import { writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { Worker } from "node:worker_threads";

// Nothing a parser prints reaches any log (review M1): PDF.js warnings quote strings from the
// file. The parent also ignores this process's stdout and stderr.
for (const method of ["log", "info", "warn", "error", "debug", "trace"]) console[method] = () => {};

// Linux: be the OOM killer's first choice. Raising the score needs no privilege; elsewhere this fails quietly.
try {
  writeFileSync("/proc/self/oom_score_adj", "1000");
} catch {
  /* not Linux, or /proc not mounted */
}

function named(name) {
  const error = new Error(name);
  error.name = name;
  return error;
}

const describe = (error) => {
  const name = error && typeof error.name === "string" ? error.name : typeof error;
  const code = error && (typeof error.code === "string" || typeof error.code === "number") ? ` ${error.code}` : "";
  return `${name}${code}`;
};

/** As extractText.ts: NUL characters dropped, line ends normalised, capped. */
function tidy(text, maxChars) {
  const clean = String(text).split("\u0000").join("").replace(/\r\n?/g, "\n").trim();
  return clean.length > maxChars ? clean.slice(0, maxChars) : clean;
}

// ------------------------------------------------------------------ .docx

/** The bytes of one zip entry, inflated against `budget` bytes at most; throws DocxTooLarge beyond it. */
function zipEntry(buf, wanted, budget) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw named("InvalidZip");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw named("InvalidZip");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name !== wanted) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw named("InvalidZip");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) throw named("InvalidZip");
    const data = buf.subarray(start, start + compressed);
    if (method === 0) {
      if (data.length > budget) throw named("DocxTooLarge");
      return data;
    }
    if (method !== 8) throw named("UnsupportedZipMethod");
    try {
      // The real inflation is bounded here, whatever the headers claim.
      return inflateRawSync(data, { maxOutputLength: budget });
    } catch (error) {
      if (error && (error.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError)) throw named("DocxTooLarge");
      throw error;
    }
  }
  throw named("NoDocumentXml");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e];
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });

/**
 * The text of word/document.xml: every <w:t> run in order (deleted text, <w:delText>, and field
 * codes, <w:instrText>, are not <w:t> and are left out), <w:tab/> as a tab, <w:br/> and <w:cr/>
 * as a line break, and a blank line after each paragraph (the layout of mammoth's raw text). One
 * linear pass, stopping once `maxChars` characters are collected.
 */
function documentXmlText(xml, maxChars) {
  const out = [];
  let length = 0;
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g;
  let m;
  while ((m = token.exec(xml)) !== null && length < maxChars) {
    const piece =
      m[1] !== undefined ? decodeXml(m[1]) : m[0].startsWith("<w:tab") ? "\t" : m[0] === "</w:p>" ? "\n\n" : "\n";
    out.push(piece);
    length += piece.length;
  }
  return out.join("");
}

function docxText(bytes, budget, maxChars) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return documentXmlText(zipEntry(buf, "word/document.xml", budget).toString("utf8"), maxChars);
}

// ------------------------------------------------------------------ .pdf

async function pdfText(bytes, maxPdfPages) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // verbosity 0: errors only (no warnings quoting the file); no eval of font programs.
  // PDF.js refuses a Buffer (the IPC may deliver one): hand it a plain Uint8Array view.
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pdf = await getDocumentProxy(data, { verbosity: 0, isEvalSupported: false });
  if (pdf.numPages > maxPdfPages) throw named("PdfTooManyPages");
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

// ------------------------------------------------------------------ watchdog and protocol

/** Kills this process from a second thread once its RSS passes the limit, even while the main thread is busy in zlib. */
function startWatchdog(limitMb) {
  const code = `
    const { workerData } = require("node:worker_threads");
    const limit = workerData * 1024 * 1024;
    const check = () => { if (process.memoryUsage.rss() > limit) process.kill(process.pid, "SIGKILL"); };
    check();
    setInterval(check, 50);
  `;
  const watchdog = new Worker(code, { eval: true, workerData: limitMb });
  watchdog.unref();
}

process.once("message", async (job) => {
  let reply;
  try {
    if (job.rssLimitMb > 0) {
      // Already over the limit (a limit set below what Node itself needs): stop before parsing anything.
      if (process.memoryUsage.rss() > job.rssLimitMb * 1024 * 1024) process.kill(process.pid, "SIGKILL");
      startWatchdog(job.rssLimitMb);
    }
    const raw = job.type === "docx" ? docxText(job.bytes, job.docxBudget, job.maxChars) : await pdfText(job.bytes, job.maxPdfPages);
    reply = { ok: true, text: tidy(raw, job.maxChars) };
  } catch (error) {
    reply = { ok: false, error: describe(error) };
  }
  process.send(reply, () => process.exit(0));
});
