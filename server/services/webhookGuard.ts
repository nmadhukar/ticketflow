import { promises as dnsPromises } from "dns";
import { isIP } from "net";
import { HttpError } from "../http/errors";

/**
 * Outbound webhook safety (SSRF). A webhook URL is only ever called when:
 *  - it is https on the default port, with no credentials, and its host is a
 *    subdomain of webhook.office.com (Microsoft Teams incoming webhooks);
 *  - every address the host resolves to is public (no private, loopback,
 *    link-local, ULA, multicast or reserved range, IPv4 or IPv6);
 *  - the request does not follow redirects (a redirect is a failure) and ends
 *    within WEBHOOK_TIMEOUT_MS.
 * Only the host is ever logged, never the URL (the path carries the secret).
 */

export const WEBHOOK_TIMEOUT_MS = 8000;
const ALLOWED_HOST_SUFFIX = ".webhook.office.com";

function refuse(message: string): never {
  throw new HttpError(400, "invalid_webhook_url", message);
}

/** Static checks on the URL itself; throws HttpError 400. Returns the parsed URL. */
export function validateWebhookUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.trim() === "") refuse("Webhook URL is required");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    refuse("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:") refuse("Webhook URL must use https");
  if (url.username || url.password) refuse("Webhook URL must not contain credentials");
  if (url.port !== "" && url.port !== "443") refuse("Webhook URL must use the default https port");
  const host = url.hostname.toLowerCase();
  if (isIP(host) !== 0 || host.startsWith("[")) refuse("Webhook URL must use a host name, not an address");
  if (!host.endsWith(ALLOWED_HOST_SUFFIX) || host.length <= ALLOWED_HOST_SUFFIX.length) {
    refuse("Webhook host is not allowed (expected *.webhook.office.com)");
  }
  return url;
}

function isPrivateV4(a: number, b: number, c: number, _d: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Parses an IPv6 literal (with optional embedded IPv4 tail) into eight 16-bit groups, or null. */
function parseV6(input: string): number[] | null {
  let s = input.split("%")[0].toLowerCase();
  const v4 = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, s.length - v4[0].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/** True when the address must never be called (or cannot be understood: fail closed). */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address.split("%")[0]);
  if (family === 4) {
    const [a, b, c, d] = address.split(".").map(Number);
    return isPrivateV4(a, b, c, d);
  }
  if (family !== 6) return true;
  const g = parseV6(address);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  const v4 = (hi: number, lo: number) => isPrivateV4(hi >> 8, hi & 255, lo >> 8, lo & 255);
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) return v4(g6, g7); // IPv4-mapped
    if (g5 === 0) return true; // ::, ::1, deprecated IPv4-compatible
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4(g6, g7); // NAT64
  if (g0 === 0x2002) return v4(g1, g2); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
  if ((g0 & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** Resolves the host and refuses unless it resolves, and every address is public. */
export async function assertPublicHost(hostname: string): Promise<void> {
  let results: { address: string }[];
  try {
    results = await dnsPromises.lookup(hostname, { all: true });
  } catch {
    refuse("Webhook host could not be resolved");
  }
  if (results.length === 0 || results.some((r) => isPrivateAddress(r.address))) {
    refuse("Webhook host resolves to a non-public address");
  }
}

/**
 * POSTs JSON to a Teams webhook. Returns true on a 2xx; false on any refusal,
 * redirect, timeout or error (the reason is logged with the host only).
 */
export async function postWebhookJson(rawUrl: string, payload: unknown): Promise<boolean> {
  let host = "unknown";
  try {
    const url = validateWebhookUrl(rawUrl);
    host = url.hostname;
    await assertPublicHost(host);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      console.warn(`Teams webhook to ${host} answered a redirect (${response.status}); not followed`);
      return false;
    }
    if (!response.ok) console.warn(`Teams webhook to ${host} answered ${response.status}`);
    return response.ok;
  } catch (error) {
    const reason = error instanceof HttpError ? error.message : error instanceof Error ? error.name : "error";
    console.warn(`Teams webhook to ${host} not sent: ${reason}`);
    return false;
  }
}
