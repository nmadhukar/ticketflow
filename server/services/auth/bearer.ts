import jwt from "jsonwebtoken";
import type { Request, RequestHandler, Response } from "express";
import { normalizeRole } from "../../permissions/roles";
import { storage } from "../../storage";
import {
  bearerRetryAfterSeconds,
  recordBearerFailure,
} from "../../security/rateLimiting";
import { JWT_AUDIENCE, JWT_ISSUER } from "../../security/jwt";

/**
 * Bearer authentication for REST: `Authorization: Bearer tfk_...` (an API key)
 * or `Authorization: Bearer <JWT>` (only when BEARER_JWT_ENABLED=true AND
 * JWT_SECRET is set; there is no development fallback). Only /api paths. Installed in setupAuth right after passport.session().
 *
 * A request with no Bearer header is untouched (cookie or anonymous). A request
 * WITH a Bearer header is authenticated by the bearer alone: an invalid one is
 * 401 even when a valid session cookie came with it, and a valid one replaces
 * the cookie's user. Nothing here creates or modifies a session.
 *
 * On success `req.user` has the same shape deserializeUser gives a session user
 * (full row, canonical role), plus `req.authMethod` and, for keys,
 * `req.apiKeyPermissions` and `req.apiKeyId`.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express type augmentation requires a namespace
  namespace Express {
    interface Request {
      authMethod?: "session" | "api_key" | "jwt";
      apiKeyPermissions?: string[];
      apiKeyId?: number;
    }
  }
}

const BEARER_HEADER = /^Bearer(?:\s+(.*))?$/i;

/** The presented bearer token ("" when the header is `Bearer` alone), or null when there is none. */
export function extractBearer(req: Pick<Request, "headers" | "path">): string | null {
  // Bearer is an API concept: pages and static files never see a JSON 401 for it.
  if (!(req.path ?? "").toLowerCase().startsWith("/api")) return null;
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = BEARER_HEADER.exec(header.trim());
  return match ? (match[1] ?? "").trim() : null;
}

/**
 * 429 once this IP has accumulated the limit of REJECTED bearers in the window.
 * Reads only: nothing is counted here, so valid traffic never consumes budget.
 * Intended: a throttled IP's valid bearer also gets 429 until the window ends.
 */
export const bearerRateLimitGate: RequestHandler = (req, res, next) => {
  if (extractBearer(req) === null) return next();
  const retryAfter = bearerRetryAfterSeconds(req);
  if (retryAfter > 0) {
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "too_many_requests",
      message: "Too many attempts, please try again later.",
    });
  }
  return next();
};

/** Marks a request as authenticated by a session cookie (bearer overrides this). */
export const markSessionAuth: RequestHandler = (req, _res, next) => {
  if (req.user) req.authMethod = "session";
  next();
};

/**
 * Ruling R28: credential-management routes are session-only. A bearer request
 * (API key or JWT) gets 403 session_required on every route below, so a leaked
 * key can neither mint further credentials nor change/reset passwords, sign the
 * owner out, or rewrite SSO/email secrets. One list: add a route here to protect it.
 */
const SESSION_ONLY: { methods: string[] | "*"; path: RegExp }[] = [
  { methods: "*", path: /^\/api\/api-keys(\/|$)/ },
  { methods: ["POST"], path: /^\/api\/auth\/change-password\/?$/ },
  { methods: ["POST"], path: /^\/api\/auth\/logout\/?$/ },
  { methods: ["GET"], path: /^\/api\/logout\/?$/ },
  // admin password reset / temporary password
  { methods: ["POST"], path: /^\/api\/admin\/users\/[^/]+\/reset-password\/?$/ },
  // SSO configuration (holds the client secret)
  { methods: ["POST"], path: /^\/api\/sso\/config\/?$/ },
  // outbound email settings and secrets (writes)
  { methods: ["POST", "PUT", "PATCH", "DELETE"], path: /^\/api\/company-settings\/email(\/|$)/ },
  // Invitation creation sets no credentials (the invitee chooses a password
  // through the public accept route), so it is not listed.
];

export const requireSessionForCredentials: RequestHandler = (req, res, next) => {
  if (req.authMethod !== "api_key" && req.authMethod !== "jwt") return next();
  const path = req.path.toLowerCase();
  const hit = SESSION_ONLY.some(
    (rule) =>
      rule.path.test(path) && (rule.methods === "*" || rule.methods.includes(req.method))
  );
  if (!hit) return next();
  return res.status(403).json({
    error: "session_required",
    message: "This action needs a signed-in session; API keys and bearer tokens cannot do it.",
  });
};

function reject(req: Request, res: Response) {
  recordBearerFailure(req);
  res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
  res.status(401).json({
    error: "invalid_token",
    message: "The bearer token is invalid, expired or revoked.",
  });
}

/**
 * A JWT's user id, or null. HS256 only (never `none`, never an asymmetric
 * algorithm a public key could be confused with), expiry required, refresh
 * tokens refused. Every claim except the subject and the issue time is ignored:
 * in particular the token's role.
 */
function verifyJwt(
  token: string,
  secret: string
): { userId: string; issuedAtMs: number } | null {
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof decoded === "string") return null;
    payload = decoded;
  } catch {
    return null;
  }
  // R29: a numeric iat that is not in the future (60 s skew) and a lifetime of at most 24 h.
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
  const nowSec = Date.now() / 1000;
  if (payload.iat > nowSec + 60) return null;
  if (payload.exp - payload.iat > 24 * 60 * 60) return null;
  if (payload.type === "refresh") return null;
  const subject = typeof payload.sub === "string" && payload.sub ? payload.sub : payload.userId;
  if (typeof subject !== "string" || !subject) return null;
  return { userId: subject, issuedAtMs: payload.iat * 1000 };
}

export const bearerAuth: RequestHandler = async (req, res, next) => {
  const token = extractBearer(req);
  if (token === null) return next();

  try {
    // Loaded on first bearer request, not at import: apiKeys pulls in the
    // database module, which unit tests of services/auth must not need.
    const { findActiveKey, keyOwnerBlockReason } = await import("./apiKeys");
    let user: Express.User | null = null;
    let method: "api_key" | "jwt" = "api_key";
    let keyInfo: { keyId: number; permissions: string[] } | null = null;

    if (token.startsWith("tfk_")) {
      const found = await findActiveKey(token);
      if (found) {
        user = found.user as Express.User;
        keyInfo = { keyId: found.keyId, permissions: found.permissions };
      }
    } else {
      const secret = process.env.JWT_SECRET;
      // R29: the JWT path is off unless BEARER_JWT_ENABLED=true (JWT_SECRET exists
      // for other uses, so it cannot be the switch).
      if (
        process.env.BEARER_JWT_ENABLED === "true" &&
        typeof secret === "string" &&
        secret.trim().length > 0
      ) {
        method = "jwt";
        const claims = verifyJwt(token, secret);
        if (claims) {
          const row = await storage.getUser(claims.userId);
          // Same refusals as an API key owner: inactive, unapproved, system accounts.
          if (row && !keyOwnerBlockReason(row)) {
            // A token minted before the last password change dies with it,
            // as a session does (iat has one-second resolution).
            const changedAt = row.passwordChangedAt
              ? Math.floor(new Date(row.passwordChangedAt).getTime() / 1000) * 1000
              : 0;
            if (claims.issuedAtMs >= changedAt) user = row as Express.User;
          }
        }
      }
    }

    const role = user ? normalizeRole(user.role) : null;
    if (!user || !role) return reject(req, res);

    // Refused outright, not allow-listed: a bearer client cannot change a
    // password, so a user who must change theirs signs in through the UI first.
    if (user.mustChangePassword) {
      return res.status(403).json({
        error: "password_change_required",
        message: "You must change your password before continuing.",
      });
    }

    req.user = { ...user, role };
    req.authMethod = method;
    if (keyInfo) {
      req.apiKeyPermissions = keyInfo.permissions;
      req.apiKeyId = keyInfo.keyId;
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
