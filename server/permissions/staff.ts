import type { RequestHandler } from "express";
import { HttpError } from "../http/errors";
import { normalizeRole } from "./roles";

/** True for admin, manager and agent (legacy "user" reads as agent). Customers and unknown roles are not staff. */
export function isStaffRole(role: unknown): boolean {
  const r = normalizeRole(role);
  return r === "admin" || r === "manager" || r === "agent";
}

/** After isAuthenticated: 403 `forbidden` unless the caller is staff. */
export const requireStaff: RequestHandler = (req, _res, next) => {
  if (!isStaffRole((req.user as { role?: unknown } | undefined)?.role)) {
    return next(new HttpError(403, "forbidden", "This is a staff-only feature"));
  }
  next();
};
