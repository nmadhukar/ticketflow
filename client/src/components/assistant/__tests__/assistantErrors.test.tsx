import { fireEvent, render, screen } from "@testing-library/react";
import { describeAssistantError } from "../assistantErrors";
import { AssistantErrorBanner } from "../AssistantErrorBanner";

// What @ag-ui/client throws for a refused request: the status and the server's JSON body.
function httpError(status: number, payload: unknown) {
  return Object.assign(new Error(`HTTP ${status}: ${JSON.stringify(payload)}`), { status, payload });
}

describe("assistant errors in words", () => {
  it("an ended session asks the user to sign in again", () => {
    expect(describeAssistantError({ error: httpError(401, { error: "unauthorized" }), code: "agent_run_failed" })).toMatchObject({ action: "sign_in" });
    expect(describeAssistantError({ error: httpError(401, "nope"), code: "agent_run_failed" })).toMatchObject({ action: "sign_in" });
  });

  it("names the spending limit, a busy or unavailable service, and a failed answer", () => {
    expect(describeAssistantError({ error: httpError(429, { error: "assistant_budget_reached" }) })?.message).toMatch(/spending limit/);
    expect(describeAssistantError({ error: httpError(429, {}) })?.message).toMatch(/busy/);
    expect(describeAssistantError({ error: httpError(503, {}) })?.message).toMatch(/unavailable right now/);
    expect(describeAssistantError({ error: new Error("provider said: 500 upstream"), code: "agent_run_error_event" })?.message).toMatch(/could not finish/);
    expect(describeAssistantError({ error: new TypeError("Failed to fetch"), code: "agent_connect_failed" })?.message).toMatch(/Cannot reach/);
  });

  it("never shows the raw error text, and says nothing for a run the user stopped", () => {
    const view = describeAssistantError({ error: new Error("Traceback: secret internals"), code: "agent_run_failed" });
    expect(view?.message).not.toMatch(/Traceback|secret/);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(describeAssistantError({ error: abort, code: "agent_run_failed" })).toBeNull();
    // As CopilotKit counts aborts: any object so named, and its known abort messages.
    expect(describeAssistantError({ error: { name: "AbortError" }, code: "agent_run_failed" })).toBeNull();
    expect(describeAssistantError({ error: new Error("component unmounted"), code: "agent_run_failed" })).toBeNull();
  });

  it("stays quiet about problems that did not stop the answer", () => {
    for (const code of ["subscriber_callback_failed", "tool_not_found", "tool_handler_failed", "transcription_failed"]) {
      expect(describeAssistantError({ error: new Error("x"), code })).toBeNull();
    }
  });

  it("a dropped connection during a run, and a busy thread, are named as such", () => {
    expect(describeAssistantError({ error: new TypeError("Failed to fetch"), code: "agent_run_failed" })?.message).toMatch(/Cannot reach/);
    expect(describeAssistantError({ error: httpError(409, { error: "thread_busy" }), code: "agent_run_failed" })?.message).toMatch(/still working/);
  });

  it("the banner offers sign-in only when the session ended, and can be dismissed", () => {
    const onDismiss = jest.fn();
    const { rerender } = render(<AssistantErrorBanner problem={{ message: "Session ended.", action: "sign_in" }} onDismiss={onDismiss} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Session ended.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(<AssistantErrorBanner problem={{ message: "Busy.", action: "dismiss" }} onDismiss={onDismiss} />);
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });
});
