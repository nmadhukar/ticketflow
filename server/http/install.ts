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

/** Route parameters that are strings (or non-numeric by design): never checked as numbers. */
const STRING_PARAMS = new Set(["userId", "sessionId", "adminId", "referenceId", "token", "name", "type"]);

/** The `:param` names a path pattern declares. */
function paramNames(path: unknown): string[] {
  const paths = Array.isArray(path) ? path : [path];
  return paths.flatMap((p) => (typeof p === "string" ? Array.from(p.matchAll(/:([A-Za-z0-9_]+)/g)).map((m) => m[1]) : []));
}

type ParamOwner = { param(name: string, fn: (req: Request, res: Response, next: NextFunction, value: string) => void): unknown };
type Layer = { route?: { path?: unknown }; handle?: { stack?: Layer[]; param?: unknown } };

/** Every `:param` a route declares, grouped by the app or router it is mounted on (param callbacks are per router). */
function declaredParams(stack: Layer[], owner: ParamOwner, out = new Map<ParamOwner, Set<string>>()) {
  for (const layer of stack) {
    if (layer.route) {
      const names = out.get(owner) ?? new Set<string>();
      paramNames(layer.route.path).forEach((n) => names.add(n));
      out.set(owner, names);
    } else if (layer.handle?.stack && typeof layer.handle.param === "function") {
      declaredParams(layer.handle.stack, layer.handle as unknown as ParamOwner, out);
    }
  }
  return out;
}

/**
 * Generic id validation: after every route is registered, any declared param named `id` or
 * ending in `Id` that is not a known string param gets the numeric check too, on the app and on
 * every nested router. A future `:articleId` is validated without anyone remembering to list it.
 * Call once, after the routes.
 */
export function registerDeclaredIdParams(app: Express) {
  const router = (app as unknown as { _router?: { stack: Layer[] } })._router;
  if (!router) return;
  const already = new Set<string>(NUMERIC_PARAMS);
  for (const [owner, names] of Array.from(declaredParams(router.stack, app as unknown as ParamOwner))) {
    for (const name of Array.from(names)) {
      // The app already checks its static list; a nested router has no such check.
      if (owner === (app as unknown as ParamOwner) && already.has(name)) continue;
      if (STRING_PARAMS.has(name)) continue;
      if (name !== "id" && !/Id$/.test(name)) continue;
      owner.param(name, (_req, _res, next, value) => {
        try {
          parseIdParam(value, name);
          next();
        } catch (err) {
          next(err);
        }
      });
    }
  }
}

/**
 * The /api 404 and the JSON error handler. Call after every API route and
 * before the SPA catch-all (serveStatic / setupVite). Used by production and
 * the integration harness alike. `/api` is matched case-insensitively.
 */
export function installErrorHandling(app: Express) {
  registerDeclaredIdParams(app);
  app.use("/api", apiNotFound);
  app.use(errorMiddleware);
}
