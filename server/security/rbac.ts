import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./jwt";

export type UserRole = "customer" | "agent" | "admin" | "manager";

// Role-based middleware
export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required",
        message: "User not authenticated",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Insufficient role",
        message: `Access denied: requires one of [${allowedRoles.join(", ")}]`,
      });
    }

    next();
  };
};

// Admin-only middleware
export const requireAdmin = requireRole("admin");

// Agent or admin middleware
export const requireAgentOrAdmin = requireRole("agent", "admin");

// Any authenticated user
export const requireAuthenticated = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({
      error: "Authentication required",
      message: "User not authenticated",
    });
  }
  next();
};

// Activity logging for security audit
export const logSecurityEvent = (
  req: AuthenticatedRequest,
  action: string,
  resource: string,
  success: boolean,
  details?: any
) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    // Sessions (and bearer users) carry the row's `id`; `userId` is the JWT payload's name for it.
    userId: req.user?.userId || (req.user as { id?: string } | undefined)?.id || "anonymous",
    userRole: req.user?.role || "none",
    action,
    resource,
    success,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    details,
  };

  // In production, send to audit log service
  console.log("SECURITY_AUDIT:", JSON.stringify(logEntry));
};
