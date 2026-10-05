import { crc32, createDeflate, createDeflateRaw, deflateRawSync } from "zlib";

/**
 * Real documents for the extraction tests (task MCP4), built in memory so no binary fixture is
 * checked in: small genuine .docx and .pdf files, and hostile ones (review N1) that inflate to
 * gigabytes from about a megabyte. The zip writer is our own (zlib only), so a test can also
 * write headers that lie about sizes.
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
const DOC_HEAD =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
const DOC_TAIL = "</w:body></w:document>";

/** document.xml with one paragraph per entry of `paragraphs`. */
export function documentXml(paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`).join("");
  return DOC_HEAD + body + DOC_TAIL;
}

export interface ZipEntry {
  name: string;
  /** Raw bytes (deflated here), or already-deflated bytes with `deflated: true`. */
  data: Buffer;
  deflated?: boolean;
  /** The uncompressed size the headers declare (default: the true size). */
  declaredSize?: number;
  /** The CRC-32 the headers declare (default: the true one, or 0 for pre-deflated data). */
  crc?: number;
}

/** A zip (deflate, method 8) of `entries`: local headers, data, central directory, end record. */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = e.deflated ? e.data : deflateRawSync(e.data, { level: 9 });
    const size = e.declaredSize ?? (e.deflated ? 0 : e.data.length);
    const crc = e.crc ?? (e.deflated ? 0 : crc32(e.data));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A minimal .docx: one paragraph per entry of `paragraphs` (or a ready document.xml). */
export async function makeDocx(paragraphs: string[], opts: { documentXml?: string } = {}): Promise<Buffer> {
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES) },
    { name: "_rels/.rels", data: Buffer.from(RELS) },
    { name: "word/document.xml", data: Buffer.from(opts.documentXml ?? documentXml(paragraphs)) },
  ]);
}

/**
 * Rewrites the uncompressed size every central-directory entry of `zip` declares, without
 * touching the data: a zip that claims to inflate to `bytes` per entry (a "zip bomb" header).
 */
export function withDeclaredUncompressedSize(zipBytes: Buffer, bytes: number): Buffer {
  const out = Buffer.from(zipBytes);
  for (let i = 0; i + 46 <= out.length; i++) {
    if (out.readUInt32LE(i) === 0x02014b50) out.writeUInt32LE(bytes, i + 24);
  }
  return out;
}

/** `prefix`, then `fillerBytes` copies of `filler`, then `suffix`, compressed as a stream (zlib or raw deflate). */
async function deflateFiller(prefix: string, filler: number, fillerBytes: number, suffix: string, raw: boolean): Promise<Buffer> {
  const z = raw ? createDeflateRaw({ level: 9 }) : createDeflate({ level: 9 });
  const out: Buffer[] = [];
  z.on("data", (c: Buffer) => out.push(c));
  const done = new Promise<void>((resolve, reject) => {
    z.on("end", () => resolve());
    z.on("error", reject);
  });
  const write = (b: Buffer) => new Promise<void>((resolve) => (z.write(b) ? resolve() : z.once("drain", () => resolve())));
  const chunk = Buffer.alloc(16 * 1024 * 1024, filler);
  await write(Buffer.from(prefix, "latin1"));
  for (let left = fillerBytes; left > 0; left -= chunk.length) await write(left >= chunk.length ? chunk : chunk.subarray(0, left));
  await write(Buffer.from(suffix, "latin1"));
  z.end();
  await done;
  return Buffer.concat(out);
}

const cache = new Map<string, Promise<Buffer>>();
const cached = (key: string, build: () => Promise<Buffer>) => {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key)!;
};

/**
 * A hostile .docx (review N1): word/document.xml really inflates to more than `bytes` (spaces in
 * one text run), while its local and central headers declare twice the compressed size, so a
 * check of the declared sizes passes it. About 1 MB per GB.
 */
export function inflatingDocx(bytes: number): Promise<Buffer> {
  return cached(`docx:${bytes}`, async () => {
    const deflated = await deflateFiller(`${DOC_HEAD}<w:p><w:r><w:t>`, 0x20, bytes, `</w:t></w:r></w:p>${DOC_TAIL}`, true);
    return zip([
      { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES) },
      { name: "_rels/.rels", data: Buffer.from(RELS) },
      { name: "word/document.xml", data: deflated, deflated: true, declaredSize: deflated.length * 2 },
    ]);
  });
}

/** A hostile .pdf (review N1): one FlateDecode content stream that inflates to more than `bytes` of spaces. About 1 MB per GB. */
export function inflatingPdf(bytes: number): Promise<Buffer> {
  return cached(`pdf:${bytes}`, async () => {
    const stream = await deflateFiller("BT /F1 12 Tf 72 720 Td (inflate me) Tj ET\n", 0x20, bytes, "\n", false);
    return pdfWithStreams([stream], true);
  });
}

/** A one-font PDF whose pages have the given content streams (raw bytes, FlateDecode when `flate`). */
function pdfWithStreams(streams: Buffer[], flate: boolean, font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"): Buffer {
  const pageIds = streams.map((_, i) => 4 + i * 2);
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${streams.length} >>`, "latin1"),
    Buffer.from(font, "latin1"),
  ];
  streams.forEach((stream, i) => {
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
        "latin1"
      )
    );
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length}${flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("\nendstream", "latin1"),
      ])
    );
  });
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let length = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(obj);
    length += obj.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
      "latin1"
    )
  );
  return Buffer.concat(parts);
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
  const streams = texts.map((text) => {
    const escaped = text.replace(/[\\()]/g, (c: string) => `\\${c}`);
    return Buffer.from(`BT /${resource} 12 Tf 72 720 Td (${escaped}) Tj ET`, "latin1");
  });
  return pdfWithStreams(
    streams,
    false,
    font === "Helvetica"
      ? "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
      : `<< /Type /Font /Subtype /TrueType /BaseFont /${font} /FirstChar 32 /LastChar 126 >>`
  );
}
