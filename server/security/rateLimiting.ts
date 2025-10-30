import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "./jwt";
import { getAISettings } from "../admin/aiSettings";

// Stores for tracking AI API calls per window (in production, use Redis)
const minuteTracker = new Map<string, { count: number; resetTime: number }>();
const hourTracker = new Map<string, { count: number; resetTime: number }>();
const dayTracker = new Map<string, { count: number; resetTime: number }>();

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

// AI API call rate limiting based on saved AI settings
export const aiApiRateLimit = async (
  req: AuthenticatedRequest,
  res: Response,
  next: Function
) => {
  try {
    const userId = (req.user?.userId as string) || req.ip;
    const now = Date.now();
    const settings = await getAISettings();

    const limits = {
      perMinute: Math.max(1, Number(settings.maxRequestsPerMinute || 1)),
      perHour: Math.max(0, Number(settings.maxRequestsPerHour || 0)), // 0 disables hourly cap
      perDay: Math.max(10, Number(settings.maxRequestsPerDay || 10)),
    };

    // Minute window
    const minuteWindow = 60 * 1000;
    let minEntry = minuteTracker.get(userId);
    if (!minEntry || now > minEntry.resetTime) {
      minEntry = { count: 0, resetTime: now + minuteWindow };
    }
    if (minEntry.count >= limits.perMinute) {
      const retry = Math.ceil((minEntry.resetTime - now) / 1000);
      return res.status(429).json({
        error: "AI API rate limit exceeded",
        message: `Too many AI requests. Limit: ${limits.perMinute}/minute reached.`,
        retryAfterSeconds: retry,
        limit: limits.perMinute,
        remaining: 0,
        resetTime: new Date(minEntry.resetTime).toISOString(),
      });
    }

    // Hour window (optional)
    const hourWindow = 60 * 60 * 1000;
    let hourEntry = hourTracker.get(userId);
    if (!hourEntry || now > hourEntry.resetTime) {
      hourEntry = { count: 0, resetTime: now + hourWindow };
    }
    if (limits.perHour > 0 && hourEntry.count >= limits.perHour) {
      const retry = Math.ceil((hourEntry.resetTime - now) / 1000);
      return res.status(429).json({
        error: "AI API rate limit exceeded",
        message: `Too many AI requests. Limit: ${limits.perHour}/hour reached.`,
        retryAfterSeconds: retry,
        limit: limits.perHour,
        remaining: 0,
        resetTime: new Date(hourEntry.resetTime).toISOString(),
      });
    }

    // Day window
    const dayWindow = 24 * 60 * 60 * 1000;
    let dayEntry = dayTracker.get(userId);
    if (!dayEntry || now > dayEntry.resetTime) {
      dayEntry = { count: 0, resetTime: now + dayWindow };
    }
    if (dayEntry.count >= limits.perDay) {
      const retry = Math.ceil((dayEntry.resetTime - now) / 60 / 1000);
      return res.status(429).json({
        error: "AI API rate limit exceeded",
        message: `Too many AI requests. Limit: ${limits.perDay}/day reached.`,
        retryAfterMinutes: retry,
        limit: limits.perDay,
        remaining: 0,
        resetTime: new Date(dayEntry.resetTime).toISOString(),
      });
    }

    // Increment counters and persist entries
    minEntry.count++;
    minuteTracker.set(userId, minEntry);

    if (limits.perHour > 0) {
      hourEntry.count++;
      hourTracker.set(userId, hourEntry);
    }

    dayEntry.count++;
    dayTracker.set(userId, dayEntry);

    // Add informative headers
    res.setHeader("X-RateLimit-Minute-Limit", String(limits.perMinute));
    res.setHeader(
      "X-RateLimit-Minute-Remaining",
      String(Math.max(0, limits.perMinute - minEntry.count))
    );
    res.setHeader(
      "X-RateLimit-Minute-Reset",
      new Date(minEntry.resetTime).toISOString()
    );

    if (limits.perHour > 0) {
      res.setHeader("X-RateLimit-Hour-Limit", String(limits.perHour));
      res.setHeader(
        "X-RateLimit-Hour-Remaining",
        String(Math.max(0, limits.perHour - hourEntry.count))
      );
      res.setHeader(
        "X-RateLimit-Hour-Reset",
        new Date(hourEntry.resetTime).toISOString()
      );
    }

    res.setHeader("X-RateLimit-Day-Limit", String(limits.perDay));
    res.setHeader(
      "X-RateLimit-Day-Remaining",
      String(Math.max(0, limits.perDay - dayEntry.count))
    );
    res.setHeader(
      "X-RateLimit-Day-Reset",
      new Date(dayEntry.resetTime).toISOString()
    );

    next();
  } catch (err) {
    // On error, fail open but log
    console.error("aiApiRateLimit error", err);
    next();
  }
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

// Cleanup trackers periodically to prevent unbounded growth
function cleanupTracker(
  map: Map<string, { count: number; resetTime: number }>
) {
  const now = Date.now();
  for (const [key, entry] of map.entries()) {
    if (now > entry.resetTime) {
      map.delete(key);
    }
  }
}

setInterval(() => {
  cleanupTracker(minuteTracker);
  cleanupTracker(hourTracker);
  cleanupTracker(dayTracker);
}, 60 * 60 * 1000);

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
