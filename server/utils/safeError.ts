/**
 * What is safe to log about a failed outbound call. The error OBJECT must never
 * be logged: SDK errors (Mailtrap, axios, AWS) carry the request body in
 * `cause.config.data`, which for email holds reset URLs and invitation tokens.
 */
export function safeErrorSummary(error: unknown): string {
  const e = error as any;
  // The error's NAME is safe and useful (AWS SDK exceptions are told apart by it:
  // MessageRejected, CredentialsProviderError); a plain "Error" adds nothing.
  const name = typeof e?.name === "string" && e.name !== "Error" ? e.name : "";
  // A thrown string, number or plain object has no message: say what kind of value it was
  // (never its content, which can be anything).
  const message =
    typeof e?.message === "string" ? e.message : `non-Error value thrown (${error === null ? "null" : typeof error})`;
  const status = e?.cause?.response?.status ?? e?.response?.status ?? e?.$metadata?.httpStatusCode;
  const head = name ? `${name}: ${message}` : message;
  return status ? `${head} (HTTP ${status})` : head;
}
