import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

/**
 * Error contract: every API failure is JSON
 * `{ error: <code>, message: <text>, details?: <field errors> }` and never
 * carries a stack trace.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Express 4 does not forward rejected promises; wrap async handlers with this. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    return res
      .status(err.status)
      .json({ error: err.code, message: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ error: "validation_failed", message: "Invalid input", details: err.flatten() });
  }
  // body-parser / http-errors failures carry a 4xx status and a type.
  const e = err as { status?: number; statusCode?: number; type?: string } | null;
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    if (e?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "invalid_json", message: "Request body is not valid JSON" });
    }
    if (e?.type === "entity.too.large") {
      return res.status(413).json({ error: "payload_too_large", message: "Request body is too large" });
    }
    return res.status(status).json({ error: "bad_request", message: "Bad request" });
  }
  console.error(err);
  return res.status(500).json({ error: "internal_error", message: "Internal server error" });
}

export function apiNotFound(req: Request, res: Response) {
  res.status(404).json({ error: "not_found", message: `No route ${req.method} ${req.path}` });
}
