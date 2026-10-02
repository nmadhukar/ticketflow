import type { Express, NextFunction, Request, Response } from "express";
import { HttpError, apiNotFound, errorMiddleware } from "./errors";
import { isSystemAccountId } from "../utils/aiSystemUserId";
import { parseIdParam } from "./params";

/** Route parameters that always hold a numeric (serial) id. userId, sessionId,
 *  token, name, adminId, type, referenceId are strings and are not listed. */
const NUMERIC_PARAMS = ["id", "taskId", "teamId", "assignmentId"] as const;

/** Validate numeric id params before any handler runs (400 invalid_id). */
export function registerIdParams(app: Express) {
  for (const name of NUMERIC_PARAMS) {
    app.param(name, (_req: Request, _res: Response, next: NextFunction, value: string) => {
      try {
        parseIdParam(value, name);
        next();
      } catch (err) {
        next(err);
      }
    });
  }
  // The AI system user is not a person an admin can manage: any route that
  // names it in :userId answers as if no such user existed.
  app.param("userId", (_req: Request, _res: Response, next: NextFunction, value: string) => {
    if (isSystemAccountId(value)) return next(new HttpError(404, "user_not_found", "User not found"));
    next();
  });
}

/**
 * The /api 404 and the JSON error handler. Call after every API route and
 * before the SPA catch-all (serveStatic / setupVite). Used by production and
 * the integration harness alike. `/api` is matched case-insensitively.
 */
export function installErrorHandling(app: Express) {
  app.use("/api", apiNotFound);
  app.use(errorMiddleware);
}
