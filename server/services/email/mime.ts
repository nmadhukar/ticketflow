/**
 * Minimal MIME reading for inbound mail: the headers we need and the text/plain body.
 * Handles header folding, RFC 2047 encoded words, multipart boundaries, quoted-printable
 * and base64 bodies and charset decoding. Attachments are skipped, not read. It is not a
 * general parser (no message/rfc822 recursion, no RFC 2231 parameter continuations).
 */

export interface ParsedEmail {
  headers: Record<string, string>;
  subject: string;
  fromAddress: string | null;
  text: string;
}

const MAX_DEPTH = 6;

function splitHeadBody(raw: string): { head: string; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  if (text.startsWith("\n")) return { head: "", body: text.slice(1) };
  const idx = text.indexOf("\n\n");
  if (idx === -1) return { head: text, body: "" };
  return { head: text.slice(0, idx), body: text.slice(idx + 2) };
}

/** Header names are lower-cased; the first occurrence wins; folded lines are joined. */
export function parseHeaders(head: string): Record<string, string> {
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  const out: Record<string, string> = {};
  for (const line of unfolded.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name) || name in out) continue;
    out[name] = line.slice(colon + 1).trim();
  }
  return out;
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
  let s = headerMode ? input.replace(/_/g, " ") : input.replace(/=\n/g, "");
  const bytes: number[] = [];
  s = s.replace(/[ \t]+\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Array.from(Buffer.from(ch, "utf8")));
    }
  }
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
  let bytes: Buffer;
  if (enc === "base64") bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
  else if (enc === "quoted-printable") bytes = decodeQuotedPrintable(body);
  else bytes = Buffer.from(body, "utf8");
  // 7bit/8bit bodies were turned into UTF-8 bytes above; a declared legacy charset only
  // matters when the bytes are raw, so decode with it only for encoded bodies.
  return enc === "7bit" || enc === "8bit" || enc === "binary" ? body : decodeBytes(bytes, charset);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
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
  const headers = parseHeaders(head);
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

/** The bare address of the first mailbox in a From-style header, lower-cased, or null. */
export function parseAddress(value: string | undefined): string | null {
  if (!value) return null;
  const decoded = decodeEncodedWords(value);
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(decoded);
  const candidate = angle ? angle[1] : /([^\s<>",;]+@[^\s<>",;]+)/.exec(decoded)?.[1];
  if (!candidate) return null;
  const address = candidate.trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) ? address : null;
}

export function parseEmail(raw: string): ParsedEmail {
  const { head } = splitHeadBody(raw);
  const headers = parseHeaders(head);
  const { plain, html } = extractText(raw, 0);
  const text = (plain ?? (html !== undefined ? htmlToText(html) : "")).replace(/\r\n/g, "\n");
  return {
    headers,
    subject: decodeEncodedWords(headers.subject ?? "").trim(),
    fromAddress: parseAddress(headers.from),
    text: text.trim(),
  };
}
