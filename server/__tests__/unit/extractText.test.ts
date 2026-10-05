import { existsSync } from "fs";
import path from "path";
import {
  DOCX_MAX_UNCOMPRESSED_BYTES,
  EXTRACTED_TEXT_MAX_CHARS,
  EXTRACT_DEFAULT_MAX_MEMORY_MB,
  EXTRACT_TIMEOUT_MS,
  PDF_MAX_PAGES,
  WORKER_BUNDLE_NAME,
  decodeFileData,
  documentExtractionAvailable,
  extractDocumentText,
  extractMemoryLimitMb,
  extractWorkerCandidates,
  inspectZip,
  isExtractable,
} from "../../services/documents/extractText";
import { documentXml, makeDocx, makePdf, withDeclaredUncompressedSize } from "../utils/documentFiles";

/**
 * R90: uploaded documents become searchable text. One helper turns a stored file (base64, as
 * help_documents.file_data and company_policies.file_data hold it) into text: .docx with
 * mammoth, .pdf with unpdf, .txt and .md as UTF-8. Anything else, or a file that does not parse,
 * gives null and logs the error type only.
 */

let errors: jest.SpyInstance;
beforeEach(() => {
  errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errors.mockRestore());

const b64 = (b: Buffer) => b.toString("base64");

describe("extractDocumentText", () => {
  it("reads the text of a .docx", async () => {
    const docx = await makeDocx(["DoseSpot setup", "Enter the DoseSpot clinic key under Settings."]);
    const text = await extractDocumentText({ filename: "Dosespot Configuration Document.docx", data: b64(docx) });
    expect(text).toContain("DoseSpot setup");
    expect(text).toContain("Enter the DoseSpot clinic key under Settings.");
  });

  it("reads the text of a .pdf", async () => {
    const text = await extractDocumentText({ filename: "policy.PDF", data: b64(makePdf("Leave policy: 20 days a year")) });
    expect(text).toContain("Leave policy: 20 days a year");
  });

  it("reads .txt and .md as UTF-8, and strips NUL characters Postgres cannot store", async () => {
    expect(await extractDocumentText({ filename: "notes.txt", data: b64(Buffer.from("Café hours\u0000 9-5", "utf8")) })).toBe(
      "Café hours 9-5"
    );
    expect(await extractDocumentText({ filename: "README.md", data: b64(Buffer.from("# Title\n\nBody", "utf8")) })).toBe(
      "# Title\n\nBody"
    );
  });

  it("uses the MIME type when the file name has no known extension", async () => {
    const docx = await makeDocx(["From the mime type"]);
    const text = await extractDocumentText({
      filename: "upload",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: b64(docx),
    });
    expect(text).toContain("From the mime type");
  });

  it("accepts a data-URL prefix on the base64", async () => {
    const data = `data:text/plain;base64,${b64(Buffer.from("prefixed", "utf8"))}`;
    expect(await extractDocumentText({ filename: "a.txt", data })).toBe("prefixed");
  });

  it("gives null for an unsupported type, without parsing it", async () => {
    expect(await extractDocumentText({ filename: "old.doc", data: b64(Buffer.from("binary")) })).toBeNull();
    expect(await extractDocumentText({ filename: "image.png", mimeType: "image/png", data: b64(Buffer.from("x")) })).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("gives null for a corrupt .docx or .pdf and logs the error type only", async () => {
    const secret = "postgres://user:hunter2@db.internal/x";
    expect(await extractDocumentText({ filename: "broken.docx", data: b64(Buffer.from(secret)) })).toBeNull();
    expect(await extractDocumentText({ filename: "broken.pdf", data: b64(Buffer.from(secret)) })).toBeNull();
    expect(errors).toHaveBeenCalledTimes(2);
    for (const call of errors.mock.calls) {
      const line = call.map(String).join(" ");
      expect(line).toMatch(/^Document text extraction failed \[[^\]]+\]$/);
      expect(line).not.toContain("hunter2");
    }
  });

  it("caps the stored text at 1,000,000 characters", async () => {
    expect(EXTRACTED_TEXT_MAX_CHARS).toBe(1_000_000);
    const big = "a".repeat(EXTRACTED_TEXT_MAX_CHARS + 500);
    const text = await extractDocumentText({ filename: "big.txt", data: b64(Buffer.from(big)) });
    expect(text).toHaveLength(EXTRACTED_TEXT_MAX_CHARS);
  });

  it("gives null for empty or absent data", async () => {
    expect(await extractDocumentText({ filename: "a.txt", data: "" })).toBeNull();
    expect(await extractDocumentText({ filename: "a.txt", data: null })).toBeNull();
  });
});

describe("isExtractable and decodeFileData", () => {
  it("knows the four supported types, case-insensitively", () => {
    for (const f of ["a.docx", "a.PDF", "a.txt", "a.Md"]) expect([f, isExtractable(f)]).toEqual([f, true]);
    for (const f of ["a.doc", "a.png", "noext", ""]) expect([f, isExtractable(f)]).toEqual([f, false]);
    expect(isExtractable("blob", "application/pdf")).toBe(true);
  });

  it("decodes plain base64 and a data URL alike", () => {
    expect(decodeFileData("aGk=").toString()).toBe("hi");
    expect(decodeFileData("data:application/pdf;base64,aGk=").toString()).toBe("hi");
  });
});

/** Varied words (a fixed pseudo-random sequence), so the text compresses like real prose, not like a bomb. */
function prose(chars: number): string {
  const words = ["clinic", "dosage", "key", "pharmacy", "settings", "prescriber", "patient", "refill", "order", "review", "alpha", "omega"];
  let seed = 7;
  const out: string[] = [];
  let length = 0;
  while (length < chars) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const w = words[seed % words.length] + String(seed % 997);
    out.push(w);
    length += w.length + 1;
  }
  return out.join(" ");
}

const logLines = () => errors.mock.calls.map((c) => c.map(String).join(" "));

describe("bounded extraction (review I1): a hostile file can never take the server down", () => {
  it("parses .docx and .pdf in a worker thread, with the stated limits", () => {
    expect(EXTRACT_TIMEOUT_MS).toBe(20_000);
    expect(EXTRACT_DEFAULT_MAX_MEMORY_MB).toBe(256);
    expect(DOCX_MAX_UNCOMPRESSED_BYTES).toBe(50 * 1024 * 1024);
    expect(PDF_MAX_PAGES).toBe(500);
    expect(documentExtractionAvailable()).toBe(true);
  });

  it("DOCUMENT_EXTRACT_MAX_MB overrides the worker heap limit; a bad value keeps the default", () => {
    expect(extractMemoryLimitMb({})).toBe(256);
    expect(extractMemoryLimitMb({ DOCUMENT_EXTRACT_MAX_MB: "512" })).toBe(512);
    for (const bad of ["", "abc", "0", "-5", "1.5", "99999"]) {
      expect([bad, extractMemoryLimitMb({ DOCUMENT_EXTRACT_MAX_MB: bad })]).toEqual([bad, 256]);
    }
  });

  it("refuses a zip-bomb .docx (12 MB of XML in a few KB) before any parser sees it", async () => {
    const bomb = await makeDocx([], { documentXml: documentXml(["ha ".repeat(4_000_000)]) });
    expect(bomb.length).toBeLessThan(200_000);
    const sizes = inspectZip(bomb)!;
    expect(sizes.uncompressed).toBeGreaterThan(12_000_000);
    const started = Date.now();
    expect(await extractDocumentText({ filename: "bomb.docx", data: b64(bomb) })).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(logLines()).toEqual(["Document text extraction failed [docx too large]"]);
  });

  it("refuses a .docx whose zip declares more than 50 MB uncompressed, and one that is not a zip", async () => {
    const liar = withDeclaredUncompressedSize(await makeDocx(["small"]), 60 * 1024 * 1024);
    expect(await extractDocumentText({ filename: "liar.docx", data: b64(liar) })).toBeNull();
    expect(inspectZip(Buffer.from("not a zip at all"))).toBeNull();
    expect(logLines()).toEqual(["Document text extraction failed [docx too large]"]);
  });

  it("inspectZip sums the central directory without inflating anything", async () => {
    const docx = await makeDocx(["hello"]);
    const sizes = inspectZip(docx)!;
    // Three files and the two folder entries jszip writes (_rels/, word/).
    expect(sizes.entries).toBe(5);
    expect(sizes.uncompressed).toBeGreaterThan(sizes.compressed);
  });

  it("a realistic text-heavy .docx (3 MB of varied prose) still extracts", async () => {
    const docx = await makeDocx([prose(3_000_000)]);
    const text = await extractDocumentText({ filename: "long.docx", data: b64(docx) });
    // 3,000,000 characters of text, capped as stored.
    expect(text).toHaveLength(EXTRACTED_TEXT_MAX_CHARS);
    expect(logLines()).toEqual([]);
  }, 60000);

  it("a parse that outlives the time limit is terminated and gives null; the next one works", async () => {
    const docx = await makeDocx(["slow"]);
    expect(await extractDocumentText({ filename: "slow.docx", data: b64(docx) }, { timeoutMs: 1 })).toBeNull();
    expect(logLines()).toEqual(["Document text extraction failed [timeout]"]);
    expect(await extractDocumentText({ filename: "ok.docx", data: b64(docx) })).toBe("slow");
  });

  it("a worker that runs out of memory gives null, and this process carries on", async () => {
    const docx = await makeDocx([prose(3_000_000)]);
    expect(await extractDocumentText({ filename: "big.docx", data: b64(docx) }, { maxMemoryMb: 8 })).toBeNull();
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toMatch(/^Document text extraction failed \[(.*ERR_WORKER_OUT_OF_MEMORY.*|worker exit)\]$/);
    expect(await extractDocumentText({ filename: "small.docx", data: b64(await makeDocx(["still alive"])) })).toBe("still alive");
  }, 60000);

  it("refuses a PDF with more pages than the cap", async () => {
    const pdf = makePdf(["one", "two", "three"]);
    expect(await extractDocumentText({ filename: "a.pdf", data: b64(pdf) })).toBe("one\ntwo\nthree");
    expect(await extractDocumentText({ filename: "a.pdf", data: b64(pdf) }, { maxPdfPages: 2 })).toBeNull();
    expect(logLines()).toEqual(["Document text extraction failed [PdfTooManyPages]"]);
  });

  it("M1: nothing PDF.js prints (a font name taken from the file) reaches this process's output", async () => {
    const printed: string[] = [];
    const spies = [
      jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => (printed.push(String(chunk)), true)),
      jest.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => (printed.push(String(chunk)), true)),
      ...(["log", "warn", "info", "debug"] as const).map((m) =>
        jest.spyOn(console, m).mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(" ")))
      ),
    ];
    try {
      const pdf = makePdf(["visible text"], { contentFont: "SECRETVALUE-in-content" });
      expect(await extractDocumentText({ filename: "a.pdf", data: b64(pdf) })).toBe("visible text");
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(printed.join("\n")).not.toContain("SECRETVALUE");
    expect(logLines().join("\n")).not.toContain("SECRETVALUE");
  });

  it("finds the worker: next to the bundle in production (dist/index.js), the source file otherwise", () => {
    const prod = extractWorkerCandidates("/app/dist/index.js");
    expect(prod[0]).toBe(path.join(path.resolve("/app/dist"), WORKER_BUNDLE_NAME));
    expect(WORKER_BUNDLE_NAME).toBe("documentExtractWorker.mjs");
    // Under Jest (CommonJS) the source worker beside extractText.ts is found.
    expect(extractWorkerCandidates(undefined).some((p) => p.endsWith(path.join("documents", "extractWorker.mjs")) && existsSync(p))).toBe(true);
  });
});
