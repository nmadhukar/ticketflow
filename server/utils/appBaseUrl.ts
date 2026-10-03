import type { Request } from "express";

/**
 * Ruling R34: every link the server sends out (password reset, invitation,
 * Teams card, the SSO redirect URI) is built from APP_BASE_URL, never from the
 * request's Host header or protocol. A Host header is chosen by the client: a
 * reset email whose link points at `evil.example` hands the reset token to
 * whoever controls that host.
 *
 * Production refuses to boot without APP_BASE_URL (server/startup/config.ts),
 * and even if it got this far it never falls back to the request. Development
 * and test fall back to the request's own origin, so a local run needs no setup.
 */

/** Why APP_BASE_URL is unusable, or null when it is fine (or unset outside production). */
export function appBaseUrlProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) {
    return env.NODE_ENV === "production"
      ? "APP_BASE_URL must be set in production (the public origin used in emailed and Teams links, e.g. https://tickets.example.com)"
      : null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "APP_BASE_URL is not a valid URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "APP_BASE_URL must start with https:// or http://";
  if (!url.hostname) return "APP_BASE_URL has no host";
  if (url.username || url.password) return "APP_BASE_URL must not contain credentials";
  if (url.search || url.hash) return "APP_BASE_URL must not contain a query or a fragment";
  return null;
}

/** APP_BASE_URL without trailing slashes, or null when unset or unusable. */
export function configuredBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw || appBaseUrlProblem(env)) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * The site origin for an outbound link: APP_BASE_URL; outside production only,
 * the request's own origin when APP_BASE_URL is unset. Null means "no link".
 */
export function publicBaseUrl(
  req?: Pick<Request, "protocol" | "get">,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const configured = configuredBaseUrl(env);
  if (configured) return configured;
  if (env.NODE_ENV === "production" || !req) return null;
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : null;
}
