import { existsSync } from "fs";
import path from "path";
import {
  CHILD_BUNDLE_NAME,
  DOCX_INFLATE_BUDGET_BYTES,
  DOCX_MAX_UNCOMPRESSED_BYTES,
  EXTRACTED_TEXT_MAX_CHARS,
  EXTRACT_DEFAULT_MAX_RSS_MB,
  EXTRACT_TIMEOUT_MS,
  MAX_CONCURRENT_EXTRACTIONS,
  PDF_MAX_PAGES,
  activeExtractions,
  createSemaphore,
  decodeFileData,
  documentExtractionAvailable,
  extractChildCandidates,
  extractDocumentText,
  extractMemoryLimitMb,
  inspectZip,
  isExtractable,
} from "../../services/documents/extractText";
import {
  documentXml,
  inflatingDocx,
  inflatingPdf,
  makeDocx,
  makePdf,
  withDeclaredUncompressedSize,
} from "../utils/documentFiles";

/**
 * R90: uploaded documents become searchable text. One helper turns a stored file (base64, as
 * help_documents.file_data and company_policies.file_data hold it) into text: .docx (its
 * word/document.xml) and .pdf (unpdf) in a separate, bounded process, .txt and .md as UTF-8.
 * Anything else, or a file that does not parse, gives null and logs the error type only.
 */

const GB = 1024 * 1024 * 1024;

/** Runs `run` while sampling this process's RSS every 20 ms; returns the result and the growth over the starting RSS. */
async function measured<T>(run: () => Promise<T>): Promise<{ result: T; growthMb: number }> {
  const start = process.memoryUsage.rss();
  let peak = start;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 20);
  try {
    const result = await run();
    peak = Math.max(peak, process.memoryUsage.rss());
    return { result, growthMb: (peak - start) / 1024 / 1024 };
  } finally {
    clearInterval(timer);
  }
}

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

describe("bounded extraction (reviews I1 and N1): a hostile file can never take the server down", () => {
  it("parses .docx and .pdf in a separate process, with the stated limits", () => {
    expect(EXTRACT_TIMEOUT_MS).toBe(20_000);
    expect(EXTRACT_DEFAULT_MAX_RSS_MB).toBe(384);
    expect(DOCX_INFLATE_BUDGET_BYTES).toBe(50 * 1024 * 1024);
    expect(DOCX_MAX_UNCOMPRESSED_BYTES).toBe(50 * 1024 * 1024);
    expect(PDF_MAX_PAGES).toBe(500);
    expect(MAX_CONCURRENT_EXTRACTIONS).toBe(2);
    expect(documentExtractionAvailable()).toBe(true);
  });

  it("DOCUMENT_EXTRACT_MAX_MB sets the extractor's RSS limit; a bad value keeps the default", () => {
    expect(extractMemoryLimitMb({})).toBe(384);
    expect(extractMemoryLimitMb({ DOCUMENT_EXTRACT_MAX_MB: "512" })).toBe(512);
    for (const bad of ["", "abc", "0", "-5", "1.5", "32", "99999"]) {
      expect([bad, extractMemoryLimitMb({ DOCUMENT_EXTRACT_MAX_MB: bad })]).toEqual([bad, 384]);
    }
  });

  it("reads word/document.xml itself: paragraphs, tabs, breaks and entities, without deleted text", async () => {
    const xml =
      '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
      '<w:p><w:r><w:t>A &amp; B</w:t><w:tab/><w:t xml:space="preserve">C &lt;D&gt; &#233;&#x263A;</w:t></w:r></w:p>' +
      "<w:p><w:r><w:t>line one</w:t><w:br/><w:t>line two</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>" +
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
      "</w:body></w:document>";
    const docx = await makeDocx([], { documentXml: xml });
    expect(await extractDocumentText({ filename: "a.docx", data: b64(docx) })).toBe("A & B\tC <D> é☺\n\nline one\nline two\n\ncell");
  });

  it("refuses an honest zip bomb (12 MB of XML in a few KB) before starting any extractor", async () => {
    const bomb = await makeDocx([], { documentXml: documentXml(["ha ".repeat(4_000_000)]) });
    expect(bomb.length).toBeLessThan(200_000);
    expect(inspectZip(bomb)!.uncompressed).toBeGreaterThan(12_000_000);
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
    const sizes = inspectZip(await makeDocx(["hello"]))!;
    expect(sizes.entries).toBe(3);
    expect(sizes.uncompressed).toBeGreaterThan(sizes.compressed);
  });

  it("N1: a ~1 MB .docx whose document.xml really inflates past 1 GB, while its headers declare ~2 MB, gives null and this process does not grow", async () => {
    const liar = await inflatingDocx(GB + 1);
    expect(liar.length).toBeLessThan(1_200_000);
    expect(inspectZip(liar)!.uncompressed).toBeLessThan(3 * 1024 * 1024);
    const { result, growthMb } = await measured(() => extractDocumentText({ filename: "liar.docx", data: liar }));
    expect(result).toBeNull();
    expect(growthMb).toBeLessThan(150);
    // Real inflation is capped at the 50 MB budget, so the extractor refuses it itself.
    expect(logLines()).toEqual(["Document text extraction failed [DocxTooLarge]"]);
  }, 120000);

  it("N1: a ~1 MB .pdf whose FlateDecode stream inflates past 1 GB is killed at the RSS limit; this process does not grow", async () => {
    const bomb = await inflatingPdf(GB + 1);
    expect(bomb.length).toBeLessThan(1_200_000);
    const started = Date.now();
    const { result, growthMb } = await measured(() => extractDocumentText({ filename: "bomb.pdf", data: bomb }));
    expect(result).toBeNull();
    expect(growthMb).toBeLessThan(150);
    expect(Date.now() - started).toBeLessThan(EXTRACT_TIMEOUT_MS);
    // The parent's /proc poll (Linux) or the extractor's own watchdog thread (elsewhere) kills it.
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toMatch(/^Document text extraction failed \[(memory limit|extractor killed SIGKILL|extractor exit 1)\]$/);
    expect(await extractDocumentText({ filename: "ok.pdf", data: makePdf("still alive") })).toBe("still alive");
  }, 120000);

  it("the RSS limit is per call: a limit below what Node needs stops the extractor before it parses; the next call works", async () => {
    // The extractor checks its RSS once before parsing, so this does not race the 50 ms checks.
    const docx = await makeDocx([prose(3_000_000)]);
    expect(await extractDocumentText({ filename: "a.docx", data: docx }, { maxRssMb: 1 })).toBeNull();
    expect(logLines()[0]).toMatch(/^Document text extraction failed \[(memory limit|extractor killed SIGKILL|extractor exit 1)\]$/);
    expect(await extractDocumentText({ filename: "a.pdf", data: makePdf("normal") })).toBe("normal");
  }, 60000);

  it("a realistic text-heavy .docx (3 MB of varied prose) still extracts", async () => {
    const docx = await makeDocx([prose(3_000_000)]);
    const text = await extractDocumentText({ filename: "long.docx", data: b64(docx) });
    // 3,000,000 characters of text, capped as stored.
    expect(text).toHaveLength(EXTRACTED_TEXT_MAX_CHARS);
    expect(logLines()).toEqual([]);
  }, 60000);

  it("a parse that outlives the time limit is killed and gives null; the next one works", async () => {
    const docx = await makeDocx(["slow"]);
    expect(await extractDocumentText({ filename: "slow.docx", data: b64(docx) }, { timeoutMs: 1 })).toBeNull();
    expect(logLines()).toEqual(["Document text extraction failed [timeout]"]);
    expect(await extractDocumentText({ filename: "ok.docx", data: b64(docx) })).toBe("slow");
  });

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

  it("finds the extractor: next to the bundle in production (dist/index.js), the source file otherwise", () => {
    const prod = extractChildCandidates("/app/dist/index.js");
    expect(prod[0]).toBe(path.join(path.resolve("/app/dist"), CHILD_BUNDLE_NAME));
    expect(CHILD_BUNDLE_NAME).toBe("documentExtractChild.mjs");
    // Under Jest (CommonJS) the source file beside extractText.ts is found.
    expect(extractChildCandidates(undefined).some((p) => p.endsWith(path.join("documents", "extractChild.mjs")) && existsSync(p))).toBe(true);
  });

  it("N6: at most two extractors run at once, however many calls arrive", async () => {
    const docx = await makeDocx([prose(2_000_000)]);
    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, activeExtractions())), 5);
    try {
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => extractDocumentText({ filename: "a.docx", data: docx })));
      expect(results.every((r) => r !== null && r.length > 0)).toBe(true);
    } finally {
      clearInterval(timer);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(activeExtractions()).toBe(0);
  }, 60000);
});

describe("createSemaphore (review N6)", () => {
  it("hands a released slot straight to the next waiter: no third holder ever, even for a caller arriving in between", async () => {
    const s = createSemaphore(2, 4);
    expect(await s.acquire(1000)).toBe("granted");
    expect(await s.acquire(1000)).toBe("granted");
    const third = s.acquire(1000);
    expect(s.waiting).toBe(1);
    s.release();
    // A caller arriving before the handed-over waiter has even resumed still has to wait.
    const fourth = s.acquire(50);
    expect(s.active).toBe(2);
    expect(await third).toBe("granted");
    expect(await fourth).toBe("timeout");
    s.release();
    s.release();
    expect(s.active).toBe(0);
  });

  it("refuses at once when the queue is full, and a waiter gives up at its deadline", async () => {
    const s = createSemaphore(1, 1);
    expect(await s.acquire(10)).toBe("granted");
    const waiting = s.acquire(30);
    expect(await s.acquire(1000)).toBe("full");
    expect(await waiting).toBe("timeout");
    expect(s.waiting).toBe(0);
    expect(await s.acquire(0)).toBe("timeout");
  });
});
