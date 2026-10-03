/**
 * Admin Route Middleware
 *
 * Provides utilities for admin route handlers including
 * authentication checks and user ID extraction.
 */

import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { USER_ROLES } from "@shared/constants";
import { fail, logRouteError } from "../http/errors";

const ADMIN_ROLE = USER_ROLES.ADMIN;

export const getUserId = (req: any): string => {
  return req.user?.id || req.user?.claims?.sub || "";
};

export const isAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      fail(res, 401, "Authentication required");
      return;
    }

    const user = await storage.getUser(userId);
    if (!user || user.role !== ADMIN_ROLE) {
      fail(res, 403, "Admin access required");
      return;
    }

    // Attach user to request for use in route handlers
    (req as any).adminUser = user;
    next();
  } catch (error) {
    logRouteError("Error in isAdmin middleware", error);
    fail(res, 500, "Failed to verify admin access");
  }
};

export const requireAdmin = async (
  req: any,
  res: Response
): Promise<boolean> => {
  const userId = getUserId(req);
  if (!userId) {
    fail(res, 401, "Authentication required");
    return false;
  }

  const user = await storage.getUser(userId);
  if (!user || user.role !== ADMIN_ROLE) {
    fail(res, 403, "Admin access required");
    return false;
  }

  return true;
};
