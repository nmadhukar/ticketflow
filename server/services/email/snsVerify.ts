import { createVerify } from "crypto";
import https from "https";

/**
 * Amazon SNS message authentication. The inbound-email endpoint is open to the internet
 * (SNS calls it without a session), so this signature check is its only authentication.
 *
 * Rules, from the SNS documentation:
 *  - SigningCertURL must be https on sns.<region>.amazonaws.com and end in .pem
 *  - SignatureVersion 1 is RSA-SHA1, 2 is RSA-SHA256; anything else is refused
 *  - the signed string is "Key\nValue\n" for a fixed key list per message type
 */

export interface SnsMessage {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  Timestamp?: string;
  Token?: string;
  SubscribeURL?: string;
  UnsubscribeURL?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
  [key: string]: unknown;
}

/** Fetches the signing certificate (PEM text) at a URL that already passed isValidSnsUrl. */
export type CertFetcher = (url: string) => Promise<string>;

export class SnsVerificationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const SNS_HOST = /^sns\.([a-z0-9-]+)\.amazonaws\.com(\.cn)?$/;

/**
 * True when `raw` is an https URL on sns.<region>.amazonaws.com with the default port and
 * no credentials. With `region`, the host must be that region's endpoint.
 */
export function isValidSnsHost(raw: unknown, region?: string): raw is string {
  if (typeof raw !== "string") return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const match = SNS_HOST.exec(url.hostname);
  if (!match) return false;
  return region === undefined || match[1] === region;
}

export function isValidCertUrl(raw: unknown, region?: string): raw is string {
  if (!isValidSnsHost(raw, region)) return false;
  const url = new URL(raw as string);
  // A certificate is a plain file: a query string or fragment has no place in its URL.
  // (url.search is "" for a bare trailing "?", so the raw string is checked too.)
  const raw0 = raw as string;
  return (
    url.search === "" &&
    url.hash === "" &&
    !raw0.includes("?") &&
    !raw0.includes("#") &&
    url.pathname.toLowerCase().endsWith(".pem")
  );
}

const NOTIFICATION_KEYS = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
const SUBSCRIBE_KEYS = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];

/** The canonical string SNS signed, or null for a message type with no signing recipe. */
export function buildStringToSign(msg: SnsMessage): string | null {
  const keys =
    msg.Type === "Notification"
      ? NOTIFICATION_KEYS
      : msg.Type === "SubscriptionConfirmation" || msg.Type === "UnsubscribeConfirmation"
        ? SUBSCRIBE_KEYS
        : null;
  if (!keys) return null;
  let out = "";
  for (const key of keys) {
    const value = msg[key];
    if (value === undefined || value === null) {
      // Subject is the only optional field; every other missing field is a malformed message.
      if (key === "Subject") continue;
      return null;
    }
    if (typeof value !== "string") return null;
    out += `${key}\n${value}\n`;
  }
  return out;
}

/** Downloads a PEM over https with a timeout and a size cap. Never follows redirects. */
export const fetchCertOverHttps: CertFetcher = (url) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`certificate fetch status ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          req.destroy(new Error("certificate too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("certificate fetch timed out")));
    req.on("error", reject);
  });

const certCache = new Map<string, string>();
const CERT_CACHE_MAX = 20;

/** Test hook: forget every cached certificate. */
export function clearCertCache(): void {
  certCache.clear();
}

export interface VerifyOptions {
  fetchCert?: CertFetcher;
  /** Require the signing certificate to come from this region's SNS endpoint. */
  region?: string;
}

/**
 * Resolves when `msg` carries a valid SNS signature; rejects with SnsVerificationError
 * (a stable code, never message content) otherwise. Certificates are cached by URL.
 */
export async function verifySnsMessage(msg: SnsMessage, options: VerifyOptions = {}): Promise<void> {
  if (!isValidCertUrl(msg.SigningCertURL, options.region)) throw new SnsVerificationError("bad_cert_url");

  const algorithm =
    msg.SignatureVersion === "1" ? "RSA-SHA1" : msg.SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algorithm) throw new SnsVerificationError("bad_signature_version");

  const stringToSign = buildStringToSign(msg);
  if (stringToSign === null) throw new SnsVerificationError("unsignable_message");
  if (typeof msg.Signature !== "string" || msg.Signature === "") throw new SnsVerificationError("no_signature");

  const certUrl = msg.SigningCertURL as string;
  let cert = certCache.get(certUrl);
  if (cert === undefined) {
    try {
      cert = await (options.fetchCert ?? fetchCertOverHttps)(certUrl);
    } catch {
      throw new SnsVerificationError("cert_unavailable");
    }
  }

  let ok: boolean;
  try {
    ok = createVerify(algorithm).update(stringToSign, "utf8").verify(cert, msg.Signature, "base64");
  } catch {
    throw new SnsVerificationError("bad_certificate");
  }
  if (!ok) throw new SnsVerificationError("signature_mismatch");

  // Cache only a certificate that just verified a message.
  if (!certCache.has(certUrl)) {
    if (certCache.size >= CERT_CACHE_MAX) certCache.delete(certCache.keys().next().value as string);
    certCache.set(certUrl, cert);
  }
}
