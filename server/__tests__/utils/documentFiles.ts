import JSZip from "jszip";

/**
 * Tiny real documents for the extraction tests (task MCP4), built in memory so no binary fixture
 * is checked in. jszip is mammoth's own dependency, so it is always installed with it.
 */

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";
const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

/** document.xml with one paragraph per entry of `paragraphs`. */
export function documentXml(paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
}

/** A minimal .docx: one paragraph per entry of `paragraphs` (or a ready document.xml), deflated. */
export async function makeDocx(paragraphs: string[], opts: { documentXml?: string } = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", opts.documentXml ?? documentXml(paragraphs));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

/**
 * Rewrites the uncompressed size every central-directory entry of `zip` declares, without
 * touching the data: a zip that claims to inflate to `bytes` per entry (a "zip bomb" header).
 */
export function withDeclaredUncompressedSize(zip: Buffer, bytes: number): Buffer {
  const out = Buffer.from(zip);
  for (let i = 0; i + 46 <= out.length; i++) {
    if (out.readUInt32LE(i) === 0x02014b50) out.writeUInt32LE(bytes, i + 24);
  }
  return out;
}

/**
 * A minimal PDF, one page per entry of `pages` (ASCII; parentheses and backslashes escaped), in
 * the font `fontName` (default Helvetica, a standard font). `contentFont` is the font resource
 * name the content stream selects (default F1, the one defined): any other name is missing from
 * the page resources, and PDF.js warns about it, quoting the name from the file.
 */
export function makePdf(pages: string | string[], opts: { fontName?: string; contentFont?: string } = {}): Buffer {
  const texts = Array.isArray(pages) ? pages : [pages];
  const font = opts.fontName ?? "Helvetica";
  const resource = opts.contentFont ?? "F1";
  const objects: string[] = [];
  // 1 catalog, 2 pages, 3 font, then per page: page object, content stream.
  const pageIds = texts.map((_, i) => 4 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${texts.length} >>`);
  objects.push(
    font === "Helvetica"
      ? "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
      : `<< /Type /Font /Subtype /TrueType /BaseFont /${font} /FirstChar 32 /LastChar 126 >>`
  );
  texts.forEach((text, i) => {
    const escaped = text.replace(/[\\()]/g, (c: string) => `\\${c}`);
    const stream = `BT /${resource} 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
