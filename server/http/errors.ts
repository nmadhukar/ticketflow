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

/** The stable error code a status gets when a route names none. */
export function defaultErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "validation_failed";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "payload_too_large";
    case 429:
      return "too_many_requests";
    case 503:
      return "unavailable";
    default:
      return status >= 500 ? "internal_error" : "bad_request";
  }
}

/** Writes the error contract body for an HttpError. The one place that shape is produced. */
export function sendHttpError(res: Response, err: HttpError): Response {
  return res
    .status(err.status)
    .json({ error: err.code, message: err.message, details: err.details });
}

/**
 * For handlers that answer an error themselves instead of calling next(error):
 * `return fail(res, 404, "Guide not found")`. Same body as errorMiddleware, and
 * the message is always a fixed string, never an exception's text.
 */
export function fail(
  res: Response,
  status: number,
  message: string,
  opts: { code?: string; details?: unknown } = {},
): Response {
  return sendHttpError(res, new HttpError(status, opts.code ?? defaultErrorCode(status), message, opts.details));
}

/**
 * Logs a caught error by type only (`Error`, `PostgresError 23505`), never the
 * object or its message: those can carry request bodies, emails, tokens or SQL
 * parameters. Use instead of `console.error(label, error)` in handlers.
 */
export function logRouteError(label: string, error: unknown): void {
  console.error(`${label} [${describeError(error)}]`);
}

/** An error's type and code (`Error`, `PostgresError 23505`), never its message: the text logRouteError prints. */
export function describeError(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : typeof error;
  const code = typeof e?.code === "string" || typeof e?.code === "number" ? ` ${e.code}` : "";
  return `${name}${code}`;
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
    return sendHttpError(res, err);
  }
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ error: "validation_failed", message: "Invalid input", details: err.flatten() });
  }
  // multer's per-file size limit (MAX_FILE_UPLOAD_SIZE_MB) has a code but no status: it is
  // the documented 413, not an unhandled 500 (T15).
  if ((err as { code?: unknown } | null)?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "payload_too_large", message: "File is too large" });
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
    // Another middleware's own 401/403/404 keeps its status AND its contract code; any
    // other 4xx (405, 415, ...) is a generic bad_request.
    const known: Record<number, string> = { 401: "Unauthorized", 403: "Forbidden", 404: "Not found" };
    return res
      .status(status)
      .json({ error: defaultErrorCode(status), message: known[status] ?? "Bad request" });
  }
  // Type and code only (M7): the object or its message can carry request bodies,
  // emails, tokens or SQL parameters.
  logRouteError("Unhandled error", err);
  return res.status(500).json({ error: "internal_error", message: "Internal server error" });
}

export function apiNotFound(req: Request, res: Response) {
  res.status(404).json({ error: "not_found", message: `No route ${req.method} ${req.path}` });
}
