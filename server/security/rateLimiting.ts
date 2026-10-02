import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { AuthenticatedRequest } from "./jwt";

// General API rate limiting
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "development" ? 10000 : 100, // High limit for development
  message: {
    error: "Too many requests",
    message: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Key on req.ip, never on the client-supplied X-Forwarded-For. The app sets
  // `trust proxy` = 1, so req.ip is the address the reverse proxy saw.
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

/**
 * POST /api/email/inbound. SNS delivers from AWS addresses shared by many accounts and retries
 * on failure, so the limit is generous (600 per 15 minutes per IP); it exists to bound a
 * flood of unsigned junk, whose signature check is the only real gate. The route is exempt
 * from generalRateLimit (security/index.ts).
 */
export const inboundEmailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { error: "too_many_requests", message: "Too many requests." },
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

// Password reset rate limiting
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Maximum 3 password reset attempts per hour
  message: {
    error: "Too many password reset attempts",
    message: "Too many password reset requests, please try again later.",
    retryAfter: "1 hour",
  },
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
    message: {
      error: "Rate limit exceeded",
      message: "You have exceeded the rate limit for your user role.",
    },
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
  message: {
    error: "File upload rate limit exceeded",
    message: "Too many file uploads, please try again later.",
  },
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
  message: {
    error: "Search rate limit exceeded",
    message: "Too many search requests, please slow down.",
  },
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
  message: {
    error: "Bulk operation rate limit exceeded",
    message: "Too many bulk operations, please try again later.",
  },
});

// Admin action rate limiting
export const adminActionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // High limit for admin actions
  message: {
    error: "Admin action rate limit exceeded",
    message: "Too many admin actions performed.",
  },
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
    message: {
      error: "Rate limit exceeded",
      message: options.message || "Too many requests, please try again later.",
    },
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
