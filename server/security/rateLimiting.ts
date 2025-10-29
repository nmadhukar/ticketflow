import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "./jwt";

// Store for tracking AI API calls (in production, use Redis)
const aiApiCallTracker = new Map<
  string,
  { count: number; resetTime: number }
>();

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
  keyGenerator: (req) => {
    const xf = String(req.headers["x-forwarded-for"] || "");
    const forwarded = (xf.split(",")[0] || "").trim();
    // Use validated helper for IPv6-safe fallback
    return forwarded.length > 0 ? forwarded : ipKeyGenerator(req as any);
  },
  // Use default IP-based rate limiting for IPv6 compatibility
});

// Strict rate limiting for authentication endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per 15 minutes
  message: {
    error: "Too many authentication attempts",
    message: "Too many login attempts, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  // Use default IP-based rate limiting
});

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
  limits: { customer: number; agent: number; admin: number }
) => {
  return rateLimit({
    windowMs,
    max: (req: Request) => {
      const authReq = req as AuthenticatedRequest;
      const role = authReq.user?.role || "customer";
      return limits[role] || limits.customer;
    },
    message: {
      error: "Rate limit exceeded",
      message: "You have exceeded the rate limit for your user role.",
    },
    // Use default IP-based key generation
  });
};

// Ticket creation rate limiting (role-based)
export const ticketCreationRateLimit = createRoleBasedRateLimit(
  60 * 60 * 1000, // 1 hour
  {
    customer: 10, // Customers can create 10 tickets per hour
    agent: 50, // Agents can create 50 tickets per hour
    admin: 100, // Admins can create 100 tickets per hour
  }
);

// Knowledge base creation rate limiting
export const knowledgeCreationRateLimit = createRoleBasedRateLimit(
  60 * 60 * 1000, // 1 hour
  {
    customer: 0, // Customers cannot create knowledge articles
    agent: 20, // Agents can create 20 articles per hour
    admin: 50, // Admins can create 50 articles per hour
  }
);

// AI API call rate limiting
export const aiApiRateLimit = (
  req: AuthenticatedRequest,
  res: Response,
  next: Function
) => {
  const userId = (req.user?.userId as string) || req.ip;
  const userRole = req.user?.role || "customer";
  const now = Date.now();

  // Define limits based on user role (per hour)
  const roleLimits = {
    customer: 20, // 20 AI requests per hour for customers
    agent: 100, // 100 AI requests per hour for agents
    admin: 200, // 200 AI requests per hour for admins
  };

  const maxRequests = roleLimits[userRole];
  const windowMs = 60 * 60 * 1000; // 1 hour

  // Get or create tracking entry
  let tracker = aiApiCallTracker.get(String(userId));

  if (!tracker || now > tracker.resetTime) {
    // Reset counter
    tracker = {
      count: 0,
      resetTime: now + windowMs,
    };
  }

  // Check if limit exceeded
  if (tracker.count >= maxRequests) {
    const remainingTime = Math.ceil((tracker.resetTime - now) / 1000 / 60); // minutes
    return res.status(429).json({
      error: "AI API rate limit exceeded",
      message: `Too many AI requests. Limit: ${maxRequests} per hour for ${userRole} role.`,
      retryAfter: `${remainingTime} minutes`,
      limit: maxRequests,
      remaining: 0,
      resetTime: new Date(tracker.resetTime).toISOString(),
    });
  }

  // Increment counter
  tracker.count++;
  aiApiCallTracker.set(userId as string, tracker);

  // Add rate limit headers
  res.setHeader("X-RateLimit-Limit", maxRequests);
  res.setHeader("X-RateLimit-Remaining", maxRequests - tracker.count);
  res.setHeader("X-RateLimit-Reset", new Date(tracker.resetTime).toISOString());

  next();
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

// Cleanup function for AI API call tracker (should be called periodically)
export const cleanupAiApiTracker = () => {
  const now = Date.now();
  for (const [userId, tracker] of Array.from(aiApiCallTracker.entries())) {
    if (now > tracker.resetTime) {
      aiApiCallTracker.delete(userId);
    }
  }
};

// Set up periodic cleanup (every hour)
setInterval(cleanupAiApiTracker, 60 * 60 * 1000);

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
