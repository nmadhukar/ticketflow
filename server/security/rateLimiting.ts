import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { AuthenticatedRequest } from "./jwt";

/** Every 429 follows the error contract: `{ error: "too_many_requests", message }`. */
export function tooManyRequests(message: string): { error: "too_many_requests"; message: string } {
  return { error: "too_many_requests", message };
}

/**
 * The general /api limiter (and the MCP one) run only in production, and there
 * only while RATE_LIMITING_ENABLED is not "false". The auth limiters below are
 * always on.
 */
export function rateLimitingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env.RATE_LIMITING_ENABLED !== "false";
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : fallback;
}

/** RATE_LIMIT_MAX_REQUESTS (default 100) per RATE_LIMIT_WINDOW_MS (default 15 minutes); a non-positive or non-integer value falls back to the default. */
export function generalRateLimitConfig(env: NodeJS.ProcessEnv = process.env): { windowMs: number; max: number } {
  return {
    windowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: positiveInt(env.RATE_LIMIT_MAX_REQUESTS, 100),
  };
}

// General API rate limiting, per IP.
export function createGeneralRateLimit(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const { windowMs, max } = generalRateLimitConfig(env);
  return rateLimit({
    windowMs,
    max,
    message: tooManyRequests("Too many requests from this address, please try again later."),
    standardHeaders: true,
    legacyHeaders: false,
    // Key on req.ip, never on the client-supplied X-Forwarded-For. The app sets
    // `trust proxy` = 1, so req.ip is the address the reverse proxy saw.
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  });
}
export const generalRateLimit = createGeneralRateLimit();

/**
 * POST /api/mcp: an agent's traffic, keyed by the API key (req.apiKeyId, set by
 * the bearer middleware that runs first), not by IP, so agents behind one NAT do
 * not share a budget and one key cannot spread over many addresses. Generous:
 * 600 per 15 minutes per key. A request with no key is keyed by IP (it is
 * refused 401 right after). The 429 body is the REST error contract, not a
 * JSON-RPC error: the limiter answers before the MCP transport, and the SDK's
 * HTTP client reports any non-2xx answer by its status.
 */
export const MCP_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 600 };

export function createMcpRateLimit(opts: { windowMs: number; max: number } = MCP_RATE_LIMIT): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    message: tooManyRequests("Too many MCP requests for this API key, please slow down."),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      typeof req.apiKeyId === "number" ? `api-key:${req.apiKeyId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`,
  });
}

/** Path, relative to the /api mount, of the MCP endpoint (it has its own limiter). */
export const MCP_PATH = "/mcp";

/**
 * POST /api/email/inbound. SNS delivers from AWS addresses shared by many accounts and retries
 * on failure, so the limit is generous (600 per 15 minutes per IP); it exists to bound a
 * flood of unsigned junk, whose signature check is the only real gate. The route is exempt
 * from generalRateLimit (security/index.ts).
 */
export const inboundEmailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: tooManyRequests("Too many requests."),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

/** Path, relative to the /api mount, of the SNS inbound-email endpoint. */
export const INBOUND_EMAIL_PATH = "/email/inbound";

/** Wraps a limiter mounted at /api so POST /api/email/inbound bypasses it (it has its own). */
export function exceptInboundEmail(limiter: RequestHandler): RequestHandler {
  return (req, res, next) => (req.path === INBOUND_EMAIL_PATH ? next() : limiter(req, res, next));
}

/**
 * Wraps the general limiter mounted at /api so the two endpoints with their own
 * limiter bypass it: POST /api/email/inbound (per IP, 600) and /api/mcp (per API key, 600).
 */
export function exceptOwnLimiters(limiter: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const p = req.path.toLowerCase().replace(/\/+$/, "");
    return p === INBOUND_EMAIL_PATH || p === MCP_PATH ? next() : limiter(req, res, next);
  };
}

/**
 * Auth limit settings. The overrides exist for the test suite only: they are
 * honoured when NODE_ENV=test, so a stray environment variable cannot loosen
 * the limit in production.
 */
export function authRateLimitMax(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.AUTH_RATE_LIMIT_MAX);
  return env.NODE_ENV === "test" && override > 0 ? override : 10;
}
export function authRateLimitWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.AUTH_RATE_LIMIT_WINDOW_MS);
  return env.NODE_ENV === "test" && override > 0 ? override : 60 * 1000;
}

// Auth endpoints (login, forgot-password, reset-password): per IP, always on
// (every environment). Window and limit are read per request so tests can
// raise them via AUTH_RATE_LIMIT_MAX; the limiter cannot be switched off.
function authLimiter(skipSuccessfulRequests: boolean) {
  return rateLimit({
    windowMs: authRateLimitWindowMs(),
    max: () => authRateLimitMax(),
    message: {
      error: "too_many_requests",
      message: "Too many attempts, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  });
}

/** Login: wrong passwords count, successful logins do not. */
export const authRateLimit = authLimiter(true);
/** forgot-password / reset-password answer 200 even for unknown emails, so every request counts. */
export const authRequestRateLimit = authLimiter(false);

/**
 * Bearer credential failures (API keys, JWTs): per IP, same limit and window as
 * login. The gate only READS the count; the count is incremented ONLY when a
 * bearer is rejected, so valid traffic, sequential or concurrent, never
 * consumes the budget. Once an IP is at the limit every bearer from it,
 * valid ones included, gets 429 until the window ends (intended).
 */
const bearerFailures = new Map<string, { count: number; resetAt: number }>();

function bearerKey(req: Pick<Request, "ip">): string {
  return ipKeyGenerator(req.ip ?? "");
}

/** Seconds until the IP may try again, or 0 when it is under the limit. */
export function bearerRetryAfterSeconds(req: Pick<Request, "ip">): number {
  const entry = bearerFailures.get(bearerKey(req));
  const now = Date.now();
  if (!entry || entry.resetAt <= now) return 0;
  return entry.count >= authRateLimitMax() ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

export function recordBearerFailure(req: Pick<Request, "ip">): void {
  const now = Date.now();
  bearerFailures.forEach((entry, k) => {
    if (entry.resetAt <= now) bearerFailures.delete(k);
  });
  const key = bearerKey(req);
  const entry = bearerFailures.get(key);
  if (entry && entry.resetAt > now) entry.count += 1;
  else bearerFailures.set(key, { count: 1, resetAt: now + authRateLimitWindowMs() });
}

// Password reset rate limiting
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Maximum 3 password reset attempts per hour
  message: tooManyRequests("Too many password reset requests, please try again later."),
  // Use default IP-based rate limiting for IPv6 compatibility
});

// API rate limiting for different user roles
export const createRoleBasedRateLimit = (
  windowMs: number,
  limits: { customer: number; agent: number; admin: number; manager: number }
) => {
  return rateLimit({
    windowMs,
    max: (req: Request) => {
      const authReq = req as AuthenticatedRequest;
      const role = (authReq.user?.role || "customer") as keyof typeof limits;
      return limits[role] || limits.customer;
    },
    message: tooManyRequests("You have exceeded the rate limit for your user role."),
    // Use default IP-based key generation
  });
};

// File upload rate limiting
export const fileUploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    const role = authReq.user?.role || "customer";

    switch (role) {
      case "admin":
        return 100;
      case "agent":
        return 50;
      case "customer":
        return 10;
      default:
        return 5;
    }
  },
  message: tooManyRequests("Too many file uploads, please try again later."),
});

// Search rate limiting to prevent abuse
export const searchRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    const role = authReq.user?.role || "customer";

    switch (role) {
      case "admin":
        return 200;
      case "agent":
        return 100;
      case "customer":
        return 50;
      default:
        return 20;
    }
  },
  message: tooManyRequests("Too many search requests, please slow down."),
});

// Bulk operation rate limiting
export const bulkOperationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    const role = authReq.user?.role || "customer";

    switch (role) {
      case "admin":
        return 50;
      case "agent":
        return 20;
      case "customer":
        return 5;
      default:
        return 1;
    }
  },
  message: tooManyRequests("Too many bulk operations, please try again later."),
});

// Admin action rate limiting
export const adminActionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // High limit for admin actions
  message: tooManyRequests("Too many admin actions performed."),
  skip: (req: Request) => {
    // Only apply to admin users
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.role !== "admin";
  },
});

// Custom rate limiter for specific endpoints
export const createCustomRateLimit = (options: {
  windowMs: number;
  max: number | ((req: Request) => number);
  message?: string;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: tooManyRequests(options.message || "Too many requests, please try again later."),
    keyGenerator:
      options.keyGenerator ||
      ((req: Request) => {
        const authReq = req as AuthenticatedRequest;
        return String((authReq.user?.userId as string) || req.ip);
      }),
    skip: options.skip,
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Rate limiting configuration based on environment
export const getRateLimitConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    general: {
      windowMs: 15 * 60 * 1000,
      max: isProduction ? 100 : 1000,
    },
    auth: {
      windowMs: 15 * 60 * 1000,
      max: isProduction ? 5 : 20,
    },
    ai: {
      windowMs: 60 * 60 * 1000,
      max: {
        customer: isProduction ? 20 : 100,
        agent: isProduction ? 100 : 500,
        admin: isProduction ? 200 : 1000,
      },
    },
  };
};
