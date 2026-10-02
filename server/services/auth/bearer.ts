import jwt from "jsonwebtoken";
import type { Request, RequestHandler, Response } from "express";
import { normalizeRole } from "../../permissions/roles";
import { storage } from "../../storage";
import { bearerFailureRateLimit } from "../../security/rateLimiting";

/**
 * Bearer authentication for REST: `Authorization: Bearer tfk_...` (an API key)
 * or `Authorization: Bearer <JWT>` (only when JWT_SECRET is set; there is no
 * development fallback). Installed in setupAuth right after passport.session().
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
export function extractBearer(req: Pick<Request, "headers">): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = BEARER_HEADER.exec(header.trim());
  return match ? (match[1] ?? "").trim() : null;
}

/** Counts bearer failures per IP (before verification, so a throttled IP cannot keep guessing). */
export const bearerRateLimitGate: RequestHandler = (req, res, next) => {
  if (extractBearer(req) === null) return next();
  return bearerFailureRateLimit(req, res, next);
};

function reject(res: Response) {
  res.locals.bearerRejected = true;
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
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string") return null;
    payload = decoded;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number") return null;
  if (payload.type === "refresh") return null;
  const subject = typeof payload.sub === "string" && payload.sub ? payload.sub : payload.userId;
  if (typeof subject !== "string" || !subject) return null;
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  return { userId: subject, issuedAtMs: iat * 1000 };
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
      if (typeof secret === "string" && secret.trim().length > 0) {
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
    if (!user || !role) return reject(res);

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
