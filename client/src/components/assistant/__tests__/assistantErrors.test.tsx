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
    const view = describeAssistantError({ error: new Error("Traceback: secret internals"), code: "something_new" });
    expect(view?.message).not.toMatch(/Traceback|secret/);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(describeAssistantError({ error: abort, code: "agent_run_failed" })).toBeNull();
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
