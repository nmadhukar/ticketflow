import {
  EXTRACTED_TEXT_MAX_CHARS,
  decodeFileData,
  extractDocumentText,
  isExtractable,
} from "../../services/documents/extractText";
import { makeDocx, makePdf } from "../utils/documentFiles";

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
