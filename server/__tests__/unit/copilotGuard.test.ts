import { inspectUserMessage, lastUserMessage, messageText } from "../../copilot/guard";

/**
 * The copilot's code-level content guardrails: what a user types is checked before a run starts, so
 * an abusive message or a pasted credential never reaches the model (and never spends tokens), and
 * the blocked attempt is logged by category.
 */
describe("copilot content guard: the newest user message", () => {
  it("allows a normal question", () => {
    expect(inspectUserMessage("My VPN drops every ten minutes since the update").allowed).toBe(true);
  });

  it("blocks abuse, threats and a pasted credential", () => {
    expect(inspectUserMessage("you are a stupid idiot").allowed).toBe(false);
    expect(inspectUserMessage("I will find you and beat you").allowed).toBe(false);
    expect(inspectUserMessage("login fails with password: hunter2xyz").allowed).toBe(false);
  });

  it("reports a category for the audit, never the text", () => {
    expect(inspectUserMessage("password: hunter2xyz").auditReason).toBe("content_guard:secret");
    expect(inspectUserMessage("madarchod").auditReason).toBe("content_guard:abuse");
  });

  it("refuses with a 422 and a message the user can act on", () => {
    const blocked = inspectUserMessage("password: hunter2xyz");
    expect(blocked.status).toBe(422);
    expect(blocked.body?.error).toBe("content_blocked");
    // The refusal must not repeat the credential back into the chat.
    expect(blocked.body?.message).not.toContain("hunter2xyz");
  });

  it("lets ordinary words that merely contain an abusive substring through", () => {
    expect(inspectUserMessage("Open a class for the new staff and check the password policy.").allowed).toBe(true);
  });
});

describe("copilot content guard: reading the run payload", () => {
  it("takes the last user message, not an assistant's or an earlier one", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "the printer jams" },
    ];
    expect(lastUserMessage(messages)).toBe("the printer jams");
  });

  it("reads content parts as well as a plain string", () => {
    expect(messageText({ role: "user", parts: [{ type: "text", text: "part one" }, { type: "image" }] })).toBe("part one");
    expect(lastUserMessage([{ role: "user", content: [{ type: "text", text: "nested" }] }])).toBe("nested");
  });

  it("is empty for a tool-only step, so the guard leaves it alone", () => {
    expect(lastUserMessage([])).toBe("");
    expect(lastUserMessage([{ role: "assistant", content: "…" }])).toBe("");
    expect(lastUserMessage(undefined)).toBe("");
  });
});
