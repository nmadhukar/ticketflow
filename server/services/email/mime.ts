/**
 * Minimal MIME reading for inbound mail: the headers we need and the text/plain body.
 * Handles header folding, RFC 2047 encoded words, multipart boundaries, quoted-printable
 * and base64 bodies and charset decoding. Attachments are skipped, not read. It is not a
 * general parser (no message/rfc822 recursion, no RFC 2231 parameter continuations).
 *
 * This runs on attacker-controlled input, so every scan is linear: no regex with a
 * repeated group or an unbounded lazy span that can be retried from every start, and
 * header sizes are capped before any header is decoded.
 */

export interface ParsedEmail {
  headers: Record<string, string>;
  subject: string;
  /** The single mailbox of the From header, or null when absent, ambiguous or malformed. */
  fromAddress: string | null;
  /** More than one From header was present. */
  duplicateFrom: boolean;
  text: string;
  /** Why the message must not be read at all (oversize or malformed header block), or null. */
  refusal: "header_too_large" | "header_malformed" | null;
}

const MAX_DEPTH = 6;
/** From and Subject are cut off or refused beyond this many characters. */
export const MAX_HEADER_VALUE = 2048;
/** The top-level header block may be this long; a longer one is refused, never truncated. */
export const MAX_HEADER_BLOCK = 64 * 1024;

function splitHeadBody(raw: string): { head: string; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  if (text.startsWith("\n")) return { head: "", body: text.slice(1) };
  const idx = text.indexOf("\n\n");
  if (idx === -1) return { head: text, body: "" };
  return { head: text.slice(0, idx), body: text.slice(idx + 2) };
}

/** Header names are lower-cased; the first occurrence wins; folded lines are joined. */
function readHeaders(head: string): { headers: Record<string, string>; duplicates: Set<string> } {
  // Callers that need the whole block (the top-level message) refuse an oversize one first;
  // for a nested part the cap only bounds the work. A header is never silently dropped to
  // make a message fit.
  const unfolded = head.slice(0, MAX_HEADER_BLOCK).replace(/\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  const duplicates = new Set<string>();
  for (const line of unfolded.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    if (name in headers) {
      duplicates.add(name);
      continue;
    }
    headers[name] = line.slice(colon + 1).trim();
  }
  return { headers, duplicates };
}

export function parseHeaders(head: string): Record<string, string> {
  return readHeaders(head).headers;
}

function decodeBytes(bytes: Buffer, charset: string | undefined): string {
  const label = (charset || "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

function decodeQuotedPrintable(input: string, headerMode = false): Buffer {
  let s: string;
  if (headerMode) {
    s = input.replace(/_/g, " ");
  } else {
    // Trailing whitespace on a line is transport padding. Trimmed per line: a regex such as
    // /[ \t]+\n/g is quadratic on a long run of spaces that is not followed by a newline.
    s = input
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/=\n/g, "");
  }
  const bytes: number[] = [];
  let nonAscii = ""; // a run of non-ASCII characters, encoded in one call
  const flush = () => {
    if (nonAscii === "") return;
    for (const b of Array.from(Buffer.from(nonAscii, "utf8"))) bytes.push(b);
    nonAscii = "";
  };
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0x80) {
      nonAscii += s[i]; // a non-ASCII character in the source keeps its UTF-8 bytes
      continue;
    }
    flush();
    if (code === 0x3d /* = */ && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(code);
    }
  }
  flush();
  return Buffer.from(bytes);
}

/** RFC 2047: =?charset?B|Q?text?= ; whitespace between adjacent encoded words is dropped. */
export function decodeEncodedWords(value: string): string {
  const collapsed = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return collapsed.replace(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
    const bytes =
      enc.toUpperCase() === "B" ? Buffer.from(text, "base64") : decodeQuotedPrintable(text, true);
    return decodeBytes(bytes, charset.split("*")[0]);
  });
}

interface ContentType {
  type: string;
  params: Record<string, string>;
}

function parseContentType(value: string | undefined): ContentType {
  if (!value) return { type: "text/plain", params: {} };
  const [first, ...rest] = value.split(";");
  const params: Record<string, string> = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return { type: first.trim().toLowerCase(), params };
}

function decodeBody(body: string, encoding: string | undefined, charset: string | undefined): string {
  const enc = (encoding || "7bit").trim().toLowerCase();
  // 7bit/8bit bodies are already text; a declared legacy charset only matters for encoded bytes.
  if (enc === "7bit" || enc === "8bit" || enc === "binary") return body;
  const bytes =
    enc === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : decodeQuotedPrintable(body);
  return decodeBytes(bytes, charset);
}

/** Removes <tag ...>...</tag> blocks with indexOf scans (linear), and an unclosed block to the end. */
function removeBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase();
  if (lower.length !== html.length) return html; // case folding changed lengths: leave it to the tag strip
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let out = "";
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(open, pos);
    if (start === -1) return out + html.slice(pos);
    out += html.slice(pos, start);
    const end = lower.indexOf(close, start);
    if (end === -1) return out;
    pos = end + close.length;
  }
}

function htmlToText(html: string): string {
  return removeBlocks(removeBlocks(html, "script"), "style")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^<>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n");
}

/** First text/plain body (or, failing that, the first text/html reduced to text). */
function extractText(raw: string, depth: number): { plain?: string; html?: string } {
  if (depth > MAX_DEPTH) return {};
  const { head, body } = splitHeadBody(raw);
  const { headers } = readHeaders(head);
  const ct = parseContentType(headers["content-type"]);
  const disposition = (headers["content-disposition"] || "").toLowerCase();
  if (disposition.startsWith("attachment")) return {};

  if (ct.type.startsWith("multipart/")) {
    const boundary = ct.params.boundary;
    if (!boundary) return {};
    const result: { plain?: string; html?: string } = {};
    const marker = `--${boundary}`;
    const parts: string[][] = [];
    for (const line of body.split("\n")) {
      if (line.startsWith(marker)) {
        if (line.slice(marker.length).trimEnd() === "--") break; // closing delimiter: the epilogue is not a part
        parts.push([]);
      } else if (parts.length) {
        parts[parts.length - 1].push(line);
      }
    }
    for (const lines of parts) {
      if (!lines.length) continue;
      const found = extractText(lines.join("\n"), depth + 1);
      result.plain ??= found.plain;
      result.html ??= found.html;
      if (result.plain !== undefined) break;
    }
    return result;
  }

  if (ct.type === "text/plain") {
    return { plain: decodeBody(body, headers["content-transfer-encoding"], ct.params.charset) };
  }
  if (ct.type === "text/html") {
    return { html: decodeBody(body, headers["content-transfer-encoding"], ct.params.charset) };
  }
  return {};
}

// addr-spec characters (RFC 5322 atext, dot, one @). One linear pass: no nested quantifier.
const ADDR_SPEC = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/;
// One ASCII character allowed in unquoted text outside <...>.
const DISPLAY_CHAR = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.@\s-]$/;

/**
 * The one mailbox of a From-style header, or null. The header is tokenised, not searched:
 * quoted strings and (comments) are skipped whole, the display name is never decoded and never
 * read for an address, and only the text inside <...> (or a bare addr-spec) counts. Anything
 * ambiguous returns null: more than one mailbox, group syntax, an unterminated quote, comment
 * or angle bracket, any quoted string when there is no <...> (the text is then the address),
 * a backslash or other non-atext character outside a quoted string or comment, an "@" in the
 * display name, an invalid address.
 * Also refused: a quoted string or comment containing `<`, `>` or `@`, and any backslash
 * (quoted-pair), so the answer never hinges on a parser's quote/comment nesting rules. An
 * encoded-word display name that would decode to an address changes nothing (never decoded).
 */
export function parseSingleMailbox(value: string | undefined): string | null {
  if (!value || value.length > MAX_HEADER_VALUE) return null;
  // No quoted-pair (backslash escape) anywhere: how it nests with quotes and comments is exactly
  // where parsers disagree, and no legitimate sender needs one.
  if (value.includes("\\")) return null;
  const addresses: string[] = [];
  let display = ""; // unquoted, uncommented text outside <...> in the current mailbox
  let angle = ""; // text inside the current <...>
  let inAngle = false;
  let hasAngle = false;
  let quoted = false; // a quoted string appeared in the current mailbox

  const finish = (): boolean => {
    let address: string;
    if (hasAngle) {
      if (display.includes("@")) return false; // "x@y <a@b>": which one is the sender?
      address = angle.trim();
    } else {
      // No <...>: the text IS the address, so a quoted string anywhere in it (a quoted local
      // part, or one spliced in to hide characters) leaves the address undecidable.
      if (quoted) return false;
      address = display.trim();
    }
    quoted = false;
    if (address === "" || address.length > 254 || !ADDR_SPEC.test(address)) return false;
    if (address.indexOf("@") !== address.lastIndexOf("@")) return false;
    addresses.push(address);
    display = "";
    angle = "";
    hasAngle = false;
    return true;
  };

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      if (inAngle || hasAngle) return null; // nothing quoted inside or after the address
      quoted = true;
      i++;
      while (i < value.length && value[i] !== '"') {
        // A quoted display name has no business holding an address or a bracket; refusing them
        // means the result never depends on how another parser reads quotes.
        if (value[i] === "<" || value[i] === ">" || value[i] === "@") return null;
        i++;
      }
      if (i >= value.length) return null; // unterminated quote
    } else if (ch === "(") {
      if (inAngle) return null;
      let depth = 1;
      i++;
      while (i < value.length && depth > 0) {
        const c = value[i];
        if (c === "<" || c === ">" || c === "@") return null; // same rule as for quoted strings
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      }
      if (depth > 0) return null; // unterminated comment
      i--;
    } else if (ch === "<") {
      if (inAngle || hasAngle) return null;
      inAngle = true;
      hasAngle = true;
    } else if (ch === ">") {
      if (!inAngle) return null;
      inAngle = false;
    } else if (inAngle) {
      if (ch === " " || ch === "\t") return null;
      angle += ch;
    } else if (ch === ",") {
      if (!finish()) return null;
    } else if (ch === ":" || ch === ";") {
      return null; // group syntax
    } else if (hasAngle) {
      if (ch !== " " && ch !== "\t") return null; // only whitespace and comments may follow <...>
    } else {
      // Unquoted display-name (or bare address) characters: atext, "@", ".", whitespace and
      // non-ASCII. A backslash outside a quoted string or comment is never legitimate here.
      if (ch.charCodeAt(0) < 0x80 && !DISPLAY_CHAR.test(ch)) return null;
      display += ch;
    }
  }
  if (inAngle) return null; // unterminated <
  if (display.trim() !== "" || hasAngle) {
    if (!finish()) return null;
  }
  return addresses.length === 1 ? addresses[0] : null;
}

/**
 * True when the raw header block, up to and including its blank-line separator, mixes CRLF and
 * bare-LF line endings. Checked before CRLF is normalised to LF (which would hide the mix):
 * readers disagree about where such a block ends, so a header could be seen by one and not
 * the other. A linear scan, bounded to the size a legitimate block can have.
 */
function mixedLineEndings(raw: string): boolean {
  let crlf = false;
  let bareLf = false;
  let pos = 0;
  const limit = MAX_HEADER_BLOCK + 1024; // a longer block is refused as too large anyway
  while (pos <= limit && pos < raw.length) {
    const lf = raw.indexOf("\n", pos);
    if (lf === -1) break;
    const endsCr = lf > pos && raw[lf - 1] === "\r";
    if (endsCr) crlf = true;
    else bareLf = true;
    if (crlf && bareLf) return true;
    const contentLength = lf - pos - (endsCr ? 1 : 0);
    if (contentLength === 0) break; // the blank line that ends the headers
    pos = lf + 1;
  }
  return false;
}

export function parseEmail(raw: string): ParsedEmail {
  const { head } = splitHeadBody(raw);

  // The top-level header block must be read whole or not at all: a From header hidden past a
  // cut-off, or behind a lone CR or a mixed line ending that another reader treats as a line
  // break, would let the sender seen here differ from the one SES evaluated.
  const refusal =
    head.length > MAX_HEADER_BLOCK
      ? "header_too_large"
      : head.includes("\r") || head.includes("\u0000") || mixedLineEndings(raw)
        ? "header_malformed" // (a CR left after CRLF -> LF is a bare CR)
        : null;
  if (refusal) {
    return { headers: {}, subject: "", fromAddress: null, duplicateFrom: false, text: "", refusal };
  }

  // Duplicates are counted over the whole block by a linear scan of the (unfolded) lines.
  const { headers, duplicates } = readHeaders(head);
  const { plain, html } = extractText(raw, 0);
  const text = (plain ?? (html !== undefined ? htmlToText(html) : "")).replace(/\r\n/g, "\n");
  return {
    headers,
    subject: decodeEncodedWords((headers.subject ?? "").slice(0, MAX_HEADER_VALUE)).trim(),
    fromAddress: parseSingleMailbox(headers.from),
    duplicateFrom: duplicates.has("from"),
    text: text.trim(),
    refusal: null,
  };
}
