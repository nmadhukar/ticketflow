import { Request, Response, NextFunction } from "express";

/**
 * Middleware to track session metadata
 *
 * Updates the session with:
 * - Last active timestamp
 * - User agent (browser/device info)
 * - IP address
 *
 * This information is used for displaying active sessions in the user settings.
 */
export function sessionTrackingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.session) {
    // Update last active time
    (req.session as any).lastActive = new Date();

    // Store user agent if not already set
    if (!(req.session as any).userAgent && req.headers["user-agent"]) {
      (req.session as any).userAgent = req.headers["user-agent"];
    }

    // Store IP address if not already set
    if (!(req.session as any).ipAddress) {
      (req.session as any).ipAddress =
        req.ip ||
        req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
        (req.connection as any)?.remoteAddress ||
        "Unknown";
    }
  }
  next();
}
