/**
 * What is safe to log about a failed outbound call. The error OBJECT must never
 * be logged: SDK errors (Mailtrap, axios, AWS) carry the request body in
 * `cause.config.data`, which for email holds reset URLs and invitation tokens.
 */
export function safeErrorSummary(error: unknown): string {
  const e = error as any;
  const message = typeof e?.message === "string" ? e.message : "unknown error";
  const status = e?.cause?.response?.status ?? e?.response?.status ?? e?.$metadata?.httpStatusCode;
  return status ? `${message} (HTTP ${status})` : message;
}
