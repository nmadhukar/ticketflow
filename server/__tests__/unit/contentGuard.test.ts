import { checkAssistantText, checkProposalPayload } from "../../assistant/contentGuard";

describe("content guard: abuse", () => {
  it("refuses a profanity or an insult in either direction", () => {
    expect(checkAssistantText("This is fucking broken")).toMatchObject({ ok: false, kind: "abuse" });
    expect(checkAssistantText("You are an idiot")).toMatchObject({ ok: false, kind: "abuse" });
    expect(checkAssistantText("madarchod, fix it now")).toMatchObject({ ok: false, kind: "abuse" });
    // Telugu romanised abuse, written as a customer would.
    expect(checkAssistantText("Lanjakodaka, why did you do that")).toMatchObject({ ok: false, kind: "abuse" });
  });

  it("refuses a threat", () => {
    expect(checkAssistantText("I will find you and beat you")).toMatchObject({ ok: false, kind: "abuse" });
  });

  it("allows a plain negative status about the product", () => {
    // "still failing" is a fact a support answer must be able to state.
    expect(checkAssistantText("The VPN is still failing after the update; here is the next step.").ok).toBe(true);
    expect(checkAssistantText("Sorry this is not working yet. Please try the steps below.").ok).toBe(true);
    // Words that merely contain an abusive substring must not fire.
    expect(checkAssistantText("Open a class for the new staff and check the password policy.").ok).toBe(true);
  });
});

describe("content guard: secrets", () => {
  it("refuses an API key, a password or a card number", () => {
    expect(checkAssistantText("use sk-proj-abcdefghijklmnop1234 to log in")).toMatchObject({ ok: false, kind: "secret" });
    expect(checkAssistantText("Your password is hunter2xyz")).toMatchObject({ ok: false, kind: "secret" });
    expect(checkAssistantText("Card 4111 1111 1111 1111 was charged")).toMatchObject({ ok: false, kind: "secret" });
  });

  it("checks every field of a proposal payload", () => {
    expect(checkProposalPayload({ title: "VPN drops", description: "It drops every ten minutes" }).ok).toBe(true);
    const verdict = checkProposalPayload({ title: "VPN drops", description: "you are a stupid idiot" });
    expect(verdict).toMatchObject({ ok: false, kind: "abuse" });
  });
});
