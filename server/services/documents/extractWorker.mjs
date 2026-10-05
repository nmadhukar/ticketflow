// The document text worker (review I1). server/services/documents/extractText.ts starts one per
// .docx or .pdf, in a worker thread with a heap limit and a time limit, so a hostile or heavy file
// can only kill this thread: an out-of-memory abort, a runaway parse or PDF.js's global polyfills
// never reach the server's own isolate. Plain JavaScript (no build step needed in development or
// under Jest); `npm run build` bundles it to dist/documentExtractWorker.mjs next to dist/index.js.
//
// In:  workerData = { type: "docx" | "pdf", bytes: Uint8Array, maxChars, maxPdfPages }
// Out: one message, { ok: true, text } or { ok: false, error: "<error type>" }.
import { parentPort, workerData } from "node:worker_threads";

// Nothing a parser prints reaches the server log (review M1): PDF.js warnings quote strings
// taken from the file. The parent also discards this thread's stdout and stderr.
for (const method of ["log", "info", "warn", "error", "debug", "trace"]) console[method] = () => {};

/** As extractText.ts: NUL characters dropped (Postgres text cannot hold them), line ends normalised, capped. */
function tidy(text, maxChars) {
  const clean = String(text).split("\u0000").join("").replace(/\r\n?/g, "\n").trim();
  return clean.length > maxChars ? clean.slice(0, maxChars) : clean;
}

function named(name) {
  const error = new Error(name);
  error.name = name;
  return error;
}

async function docxText(bytes) {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
  return value;
}

async function pdfText(bytes, maxPdfPages) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // verbosity 0: errors only (no warnings quoting the file); no eval of font programs.
  const pdf = await getDocumentProxy(bytes, { verbosity: 0, isEvalSupported: false });
  try {
    if (pdf.numPages > maxPdfPages) throw named("PdfTooManyPages");
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    await pdf.loadingTask?.destroy?.();
  }
}

const describe = (error) => {
  const name = error && typeof error.name === "string" ? error.name : typeof error;
  const code = error && (typeof error.code === "string" || typeof error.code === "number") ? ` ${error.code}` : "";
  return `${name}${code}`;
};

try {
  const { type, bytes, maxChars, maxPdfPages } = workerData;
  const raw = type === "docx" ? await docxText(bytes) : await pdfText(bytes, maxPdfPages);
  parentPort.postMessage({ ok: true, text: tidy(raw, maxChars) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: describe(error) });
}
