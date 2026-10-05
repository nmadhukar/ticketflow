/**
 * `Content-Disposition: attachment` for any file name (review M5). Node refuses a header value
 * with a character above 0xFF or a line break (ERR_INVALID_CHAR, a 500), and a `"` would end the
 * quoted name early. So: `filename="..."` carries an ASCII fallback (anything outside printable
 * ASCII, `"` and `\` become `_`), and `filename*=UTF-8''...` (RFC 5987/6266) the exact name,
 * percent-encoded, which every current browser prefers.
 */
export function attachmentDisposition(fileName: string | null | undefined): string {
  const name = fileName && fileName.length > 0 ? fileName : "download";
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // encodeURIComponent leaves ' ( ) * unescaped; RFC 5987's attr-char does not allow them.
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
