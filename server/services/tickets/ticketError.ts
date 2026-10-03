import { ZodError } from "zod";
import { HttpError } from "../../http/errors";

export type TicketErrorCode = "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE";

/**
 * A ticket operation refused for a reason the caller can act on. Kept free of
 * database imports so the MCP layer (and its unit tests) can use it alone.
 * ticketService.ts re-exports it.
 */
export class TicketError extends Error {
  constructor(
    public code: TicketErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "TicketError";
  }
}

/** REST status and error code for each TicketError code (the error contract). */
export const TICKET_ERROR_HTTP: Record<TicketErrorCode, { status: number; error: string }> = {
  VALIDATION: { status: 400, error: "validation_failed" },
  NOT_FOUND: { status: 404, error: "not_found" },
  FORBIDDEN: { status: 403, error: "forbidden" },
  INVALID_STATE: { status: 409, error: "invalid_transition" },
};

/**
 * The rule modules (schemas, permissions, storage) fail with ZodError or
 * HttpError. The service surfaces them as TicketError; anything else is not an
 * expected refusal and is rethrown untouched.
 */
export function toTicketError(e: unknown): unknown {
  if (e instanceof TicketError) return e;
  if (e instanceof ZodError) return new TicketError("VALIDATION", "Invalid input", e.flatten());
  if (e instanceof HttpError) {
    // A retryable conflict that is not a workflow refusal (e.g. a ticket-number clash) keeps its own contract.
    if (e.status === 409 && e.code === "conflict") return e;
    if (e.status === 400) return new TicketError("VALIDATION", e.message, e.details);
    if (e.status === 403) return new TicketError("FORBIDDEN", e.message, e.details);
    if (e.status === 404) return new TicketError("NOT_FOUND", e.message, e.details);
    if (e.status === 409) return new TicketError("INVALID_STATE", e.message, e.details);
  }
  return e;
}

/** Runs `fn`, converting expected refusals into TicketError. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toTicketError(e);
  }
}

/** For REST adapters: a TicketError becomes the HttpError the error middleware renders; anything else passes through. */
export function ticketErrorToHttp(e: unknown): unknown {
  if (!(e instanceof TicketError)) return e;
  const { status, error } = TICKET_ERROR_HTTP[e.code];
  return new HttpError(status, error, e.message, e.details);
}
