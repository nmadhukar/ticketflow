/**
 * Turns what CopilotKit reports (its error code, and for a refused request the HTTP status and the
 * server's { error, message } body) into one sentence a user can act on. Raw errors never reach
 * the screen: they can carry stack traces or provider text.
 */
export type AssistantErrorAction = "sign_in" | "dismiss";

export interface AssistantErrorView {
  message: string;
  action: AssistantErrorAction;
}

interface ReportedError {
  error?: unknown;
  code?: unknown;
}

const BY_SERVER_CODE: Record<string, AssistantErrorView> = {
  unauthorized: { message: "Your session has ended. Sign in again to keep using the assistant.", action: "sign_in" },
  assistant_budget_reached: { message: "The assistant has reached its spending limit for now. Please try again later.", action: "dismiss" },
  assistant_unavailable: { message: "The assistant is not available for your account.", action: "dismiss" },
  assistant_disabled: { message: "The assistant is switched off at the moment.", action: "dismiss" },
  forbidden: { message: "That request was refused. Reload the page and try again.", action: "dismiss" },
};

function httpDetails(error: unknown): { status: number | null; code: string | null } {
  if (!error || typeof error !== "object") return { status: null, code: null };
  const e = error as { status?: unknown; payload?: unknown };
  const status = typeof e.status === "number" ? e.status : null;
  const payload = e.payload && typeof e.payload === "object" ? (e.payload as { error?: unknown }) : null;
  return { status, code: typeof payload?.error === "string" ? payload.error : null };
}

/** Null for what is not an error to the user: a run they stopped themselves. */
export function describeAssistantError(reported: ReportedError): AssistantErrorView | null {
  if (reported.error instanceof Error && reported.error.name === "AbortError") return null;
  const { status, code } = httpDetails(reported.error);
  if (code && BY_SERVER_CODE[code]) return BY_SERVER_CODE[code];
  if (status === 401) return BY_SERVER_CODE.unauthorized;
  if (status === 429) return { message: "The assistant is busy. Wait a moment, then try again.", action: "dismiss" };
  if (status !== null && status >= 500) return { message: "The assistant is unavailable right now. Try again in a minute.", action: "dismiss" };

  switch (reported.code) {
    case "agent_thread_locked":
      return { message: "The assistant is still working on your previous message.", action: "dismiss" };
    case "agent_run_error_event":
    case "agent_run_failed_event":
      return { message: "The assistant could not finish that answer. Try asking again.", action: "dismiss" };
    case "runtime_info_fetch_failed":
    case "agent_connect_failed":
      return { message: "Cannot reach the assistant. Check your connection and try again.", action: "dismiss" };
    default:
      return { message: "Something went wrong with the assistant. Try again.", action: "dismiss" };
  }
}
