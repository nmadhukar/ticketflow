/**
 * generateShortId
 * - Produces a compact, URL-safe, time-prefixed id <= 20 chars (default 16)
 * - Time-sortable (timestamp in base36) + cryptographic randomness (base36)
 * - Works in browser (crypto.getRandomValues) and Node (crypto.randomFillSync)
 */
const BASE36 = 36;

function getRandomBytes(len: number): Uint8Array {
  if (typeof crypto !== "undefined" && typeof (crypto as any).getRandomValues === "function") {
    const arr = new Uint8Array(len);
    (crypto as any).getRandomValues(arr);
    return arr;
  }
  try {
    // Node.js
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require("crypto");
    const arr = new Uint8Array(len);
    nodeCrypto.randomFillSync(arr);
    return arr;
  } catch {
    // fallback (low-quality, only if no crypto available)
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  }
}

function randomBase36(len: number): string {
  const bytes = getRandomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) {
    // modulo bias is negligible for typical lengths
    s += (bytes[i] % BASE36).toString(36);
  }
  return s;
}

export function generateShortId(maxLength = 16): string {
  // enforce boundaries
  const length = Math.min(20, Math.max(8, maxLength));

  // time prefix (ms since epoch) in base36 -> keeps ids roughly sortable
  const ts = Date.now().toString(36); // typically ~8 chars

  // remaining space for randomness
  const randLen = Math.max(4, length - ts.length);

  const id = (ts + randomBase36(randLen)).slice(0, length);
  return id.toLowerCase();
}

export default generateShortId;
