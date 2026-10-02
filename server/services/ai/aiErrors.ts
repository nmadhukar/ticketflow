import type { Response } from "express";

/**
 * What may be logged about a failed AI call: the error's type and the HTTP
 * status / code the SDK reports. Never the message (it can echo the prompt),
 * the request, the response body or credentials.
 */
export function describeAIError(error: unknown): string {
  if (error === null || typeof error !== "object") return "non-error value thrown";
  const e = error as {
    name?: unknown;
    code?: unknown;
    isBlocked?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    $fault?: unknown;
  };
  const parts = [typeof e.name === "string" && e.name ? e.name : "Error"];
  const status = e.$metadata?.httpStatusCode;
  if (typeof status === "number") parts.push(`status=${status}`);
  if (typeof e.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(e.code)) parts.push(`code=${e.code}`);
  if (e.isBlocked) parts.push("blocked_by_cost_limit");
  return parts.join(" ");
}

/**
 * The 429 for a call the cost monitor refused (daily/monthly limit or the
 * per-request token budget), in the API error contract:
 * `{ error, message, details: { reason, costEstimate, isBlocked } }`.
 */
export function sendQuotaExceeded(res: Response, error: unknown): void {
  const e = error as { message?: unknown; costEstimate?: unknown };
  res.status(429).json({
    error: "quota_exceeded",
    message: "AI usage limit reached",
    details: {
      reason: typeof e.message === "string" ? e.message : undefined,
      costEstimate: e.costEstimate,
      isBlocked: true,
    },
  });
}

/** True for the error the cost monitor raises when a daily/monthly/per-request limit stops a call. */
export function isQuotaBlocked(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { isBlocked?: unknown }).isBlocked === true;
}
