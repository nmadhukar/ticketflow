import type { Express, NextFunction, Request, Response } from "express";
import { apiNotFound, errorMiddleware } from "./errors";
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
