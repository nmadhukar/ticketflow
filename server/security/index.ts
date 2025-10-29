// Centralized security configuration and middleware
import { Express } from "express";
import helmet from "helmet";
import { authenticateJWT, optionalJWT } from "./jwt";
import {
  requireRole,
  requirePermission,
  requireAdmin,
  requireAgentOrAdmin,
} from "./rbac";
import {
  generalRateLimit,
  authRateLimit,
  passwordResetRateLimit,
  ticketCreationRateLimit,
  knowledgeCreationRateLimit,
  aiApiRateLimit,
  fileUploadRateLimit,
  searchRateLimit,
  adminActionRateLimit,
} from "./rateLimiting";
import {
  sanitizeInput,
  preventXSS,
  validateSchema,
  validationSchemas,
  userValidationRules,
  ticketValidationRules,
  knowledgeValidationRules,
  searchValidationRules,
  paramValidationRules,
  checkValidationResult,
} from "./validation";
import { awsSecurityBestPractices } from "./awsIAM";

// Initialize AWS security on startup (optional for development)
const awsConfigured = awsSecurityBestPractices.validateCredentials();
if (awsConfigured) {
  awsSecurityBestPractices.validateRegion();
  console.log("AWS security configuration validated");
} else {
  console.log("AWS features disabled - credentials not configured");
}

// Security configuration object
export const securityConfig = {
  jwt: {
    secret:
      process.env.JWT_SECRET ||
      "your-super-secret-jwt-key-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },
  rateLimiting: {
    enabled:
      process.env.NODE_ENV === "production" &&
      process.env.RATE_LIMITING_ENABLED !== "false",
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
  },
  cors: {
    enabled: process.env.CORS_ENABLED !== "false",
    origin: process.env.CORS_ORIGIN || "*",
    credentials: process.env.CORS_CREDENTIALS === "true",
  },
  validation: {
    enabled: process.env.INPUT_VALIDATION_ENABLED !== "false",
    strictMode: process.env.VALIDATION_STRICT_MODE === "true",
  },
};

// Apply security middleware to Express app
export const applySecurity = (app: Express) => {
  // Helmet for basic security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "https:"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          manifestSrc: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    })
  );

  // XSS Protection
  app.use(preventXSS);

  // Input sanitization
  if (securityConfig.validation.enabled) {
    app.use(sanitizeInput);
  }

  // General rate limiting (API routes only)
  if (securityConfig.rateLimiting.enabled) {
    app.use("/api", generalRateLimit);
  }

  console.log("Security middleware applied successfully");
};

// Apply route-specific security (simplified for integration)
export const applyRouteSpecificSecurity = (app: Express) => {
  // Temporarily disable rate limiting to fix IPv6 compatibility issues
  // TODO: Re-enable with proper IPv6 support
  // app.use('/api/auth/login', authRateLimit);
  // app.use('/api/auth/register', authRateLimit);
  // app.use('/api/auth/password-reset', passwordResetRateLimit);

  console.log(
    "Route-specific security applied successfully (rate limiting temporarily disabled)"
  );
};

// Security validation middleware combinations
export const securityValidations = {
  // User management
  userRegistration: [
    ...userValidationRules(),
    checkValidationResult,
    validateSchema(validationSchemas.userRegistration),
  ],

  userLogin: [validateSchema(validationSchemas.userLogin)],

  // Ticket management
  ticketCreation: [
    ...ticketValidationRules(),
    checkValidationResult,
    validateSchema(validationSchemas.ticketCreation),
  ],

  ticketUpdate: [
    ...paramValidationRules(),
    checkValidationResult,
    validateSchema(validationSchemas.ticketUpdate),
  ],

  // Knowledge base
  knowledgeCreation: [
    ...knowledgeValidationRules(),
    checkValidationResult,
    validateSchema(validationSchemas.knowledgeArticle),
  ],

  // Search
  search: [
    ...searchValidationRules(),
    checkValidationResult,
    validateSchema(validationSchemas.search),
  ],

  // Comments
  comment: [validateSchema(validationSchemas.comment)],

  // Team management
  teamCreation: [validateSchema(validationSchemas.team)],

  // AI settings
  aiSettings: [validateSchema(validationSchemas.aiSettings)],
};

// Security audit logging
// Security audit logging functions
export const logSecurityEvent = (event: {
  userId?: string;
  action: string;
  resource: string;
  success: boolean;
  ip?: string;
  userAgent?: string;
  details?: any;
}) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: "SECURITY_EVENT",
    ...event,
  };
  console.log("SECURITY_AUDIT:", JSON.stringify(logEntry));
};

export const logAuthEvent = (event: {
  userId?: string;
  email?: string;
  action: "login" | "logout" | "register" | "password_reset";
  success: boolean;
  ip?: string;
  userAgent?: string;
  reason?: string;
}) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: "AUTH_EVENT",
    ...event,
  };
  console.log("AUTH_AUDIT:", JSON.stringify(logEntry));
};

export const logPermissionDenied = (event: {
  userId: string;
  role: string;
  action: string;
  resource: string;
  ip?: string;
}) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: "PERMISSION_DENIED",
    ...event,
  };
  console.log("PERMISSION_AUDIT:", JSON.stringify(logEntry));
};

// Health check for security components
export const securityHealthCheck = () => {
  const checks = {
    jwtSecret:
      !!process.env.JWT_SECRET &&
      process.env.JWT_SECRET !==
        "your-super-secret-jwt-key-change-in-production",
    awsCredentials:
      !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY,
    rateLimiting: securityConfig.rateLimiting.enabled,
    inputValidation: securityConfig.validation.enabled,
    httpsRedirect: process.env.NODE_ENV === "production",
  };

  const allHealthy = Object.values(checks).every((check) => check);

  return {
    healthy: allHealthy,
    checks,
    timestamp: new Date().toISOString(),
  };
};

// Security metrics for monitoring
export const securityMetrics = {
  rateLimitHits: 0,
  authFailures: 0,
  permissionDenials: 0,
  validationFailures: 0,

  incrementRateLimitHits: () => securityMetrics.rateLimitHits++,
  incrementAuthFailures: () => securityMetrics.authFailures++,
  incrementPermissionDenials: () => securityMetrics.permissionDenials++,
  incrementValidationFailures: () => securityMetrics.validationFailures++,

  getMetrics: () => ({
    rateLimitHits: securityMetrics.rateLimitHits,
    authFailures: securityMetrics.authFailures,
    permissionDenials: securityMetrics.permissionDenials,
    validationFailures: securityMetrics.validationFailures,
    timestamp: new Date().toISOString(),
  }),

  resetMetrics: () => {
    securityMetrics.rateLimitHits = 0;
    securityMetrics.authFailures = 0;
    securityMetrics.permissionDenials = 0;
    securityMetrics.validationFailures = 0;
  },
};

// Export all security components
export {
  // JWT
  authenticateJWT,
  optionalJWT,
  generateTokens,
  verifyToken,
  refreshAccessToken,

  // RBAC
  requireRole,
  requirePermission,
  requireAdmin,
  requireAgentOrAdmin,
  hasPermission,

  // Rate Limiting
  generalRateLimit,
  authRateLimit,
  aiApiRateLimit,
  ticketCreationRateLimit,
  knowledgeCreationRateLimit,

  // Validation
  validateSchema,
  validationSchemas,
  sanitizeInput,
  preventXSS,

  // AWS Security
  awsSecurityBestPractices,
};
