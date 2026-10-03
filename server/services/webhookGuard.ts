import dns from "dns";
import https from "https";
import { isIP, type LookupFunction } from "net";
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
 *
 * DNS rebinding (R44): the check and the connection use ONE resolution. The request goes
 * through https.request with a custom `lookup` that resolves the name, refuses when ANY
 * address is private, and answers the connection with a validated address, so the socket
 * can only be opened to an address that passed the check; there is no second lookup to
 * rebind. `servername` is the original host, so TLS still verifies the certificate against
 * the name, not the address. No dependency is needed.
 */

/**
 * R84: Teams webhooks are OFF unless TEAMS_WEBHOOKS_ENABLED is exactly "true". Off, no ticket event
 * sends anything, the test route answers 503 and saving settings answers 409, all with the code
 * `teams_webhooks_disabled`. The code stays in place so an admin can turn it on.
 */
export function teamsWebhooksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TEAMS_WEBHOOKS_ENABLED === "true";
}
export const TEAMS_WEBHOOKS_DISABLED_MESSAGE =
  "Teams webhooks are turned off on this server. Set TEAMS_WEBHOOKS_ENABLED=true and restart to enable them.";

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

/**
 * Resolves the host and refuses unless it resolves, and every address is public. A courtesy
 * pre-check for the admin "send a test" route (a 400 instead of a quiet false); the send itself
 * is pinned by createPinnedLookup, so this check is not what protects the connection.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  let results: { address: string }[];
  try {
    results = await new Promise<{ address: string }[]>((resolve, reject) =>
      dns.lookup(hostname, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)))
    );
  } catch {
    refuse("Webhook host could not be resolved");
  }
  if (results.length === 0 || results.some((r) => isPrivateAddress(r.address))) {
    refuse("Webhook host resolves to a non-public address");
  }
}

type LookupResult = { address: string; family: number };
type Resolve = (hostname: string, options: { all: true }, cb: (err: NodeJS.ErrnoException | null, addresses: LookupResult[]) => void) => void;

/**
 * A `lookup` for net.connect / https.request that resolves ONCE, refuses when ANY address is
 * private, and answers with the validated address(es). It honours `options.all` (the array
 * form Node's autoSelectFamily uses) and the single-address form.
 */
export function createPinnedLookup(resolve: Resolve = dns.lookup as unknown as Resolve) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number | string } | undefined,
    callback: (err: NodeJS.ErrnoException | null, address?: string | LookupResult[], family?: number) => void
  ): void => {
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!Array.isArray(addresses) || addresses.length === 0) {
        return callback(Object.assign(new Error("Webhook host could not be resolved"), { code: "ENOTFOUND" }) as NodeJS.ErrnoException);
      }
      if (addresses.some((a) => isPrivateAddress(a.address))) {
        return callback(
          Object.assign(new Error("Webhook host resolves to a non-public address"), { code: "EWEBHOOKPRIVATE" }) as NodeJS.ErrnoException
        );
      }
      const wanted = Number(options?.family) || 0;
      const usable = wanted === 4 || wanted === 6 ? addresses.filter((a) => a.family === wanted) : addresses;
      if (usable.length === 0) {
        return callback(Object.assign(new Error("Webhook host has no address of the requested family"), { code: "ENOTFOUND" }) as NodeJS.ErrnoException);
      }
      if (options?.all) return callback(null, usable.map((a) => ({ address: a.address, family: a.family })));
      callback(null, usable[0].address, usable[0].family);
    });
  };
}

/** Response bytes read before the connection is dropped (only the status matters). */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * The one HTTPS POST: connects to the address the pinned `lookup` validated, with TLS
 * SNI and certificate verification on the original host name, no redirects followed,
 * a timeout, and a bounded response read. Resolves with the status code.
 * `extra` is for tests only (a local CA, port and lookup); production passes nothing.
 */
export function sendPinnedJson(
  url: URL,
  body: string,
  extra: { lookup?: ReturnType<typeof createPinnedLookup>; ca?: string | Buffer; port?: number } = {}
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: extra.port ?? 443,
        path: `${url.pathname}${url.search}`,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        servername: url.hostname,
        // On an error the callback carries no address; net's type does not model that.
        lookup: (extra.lookup ?? createPinnedLookup()) as unknown as LookupFunction,
        ...(extra.ca ? { ca: extra.ca } : {}),
        agent: false,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      },
      (res) => {
        // No redirect is followed: a 3xx is just a status here.
        const status = res.statusCode ?? 0;
        let read = 0;
        res.on("data", (chunk: Buffer) => {
          read += chunk.length;
          if (read > MAX_RESPONSE_BYTES) res.destroy();
        });
        res.on("error", () => {});
        res.on("end", () => resolve(status));
        res.on("close", () => resolve(status));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
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
    const status = await sendPinnedJson(url, JSON.stringify(payload));
    if (status >= 300 && status < 400) {
      console.warn(`Teams webhook to ${host} answered a redirect (${status}); not followed`);
      return false;
    }
    const ok = status >= 200 && status < 300;
    if (!ok) console.warn(`Teams webhook to ${host} answered ${status}`);
    return ok;
  } catch (error) {
    const reason =
      error instanceof HttpError
        ? error.message
        : (error as NodeJS.ErrnoException)?.code === "EWEBHOOKPRIVATE"
          ? "Webhook host resolves to a non-public address"
          : error instanceof Error
            ? error.name
            : "error";
    console.warn(`Teams webhook to ${host} not sent: ${reason}`);
    return false;
  }
}
