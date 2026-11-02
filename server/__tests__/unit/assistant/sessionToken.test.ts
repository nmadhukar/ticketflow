import { createHmac, hkdfSync, randomUUID } from "crypto";
import {
  ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS,
  ASSISTANT_TOKEN_ISSUER,
  ASSISTANT_TOKEN_TTL_SECONDS,
  mintAssistantToken,
  tokenAudience,
  verifyAssistantToken,
  type TokenHop,
} from "../../../assistant/sessionToken";

const SECRET = "a".repeat(20) + "-assistant-test-secret-0001";
const OTHER_SECRET = "b".repeat(20) + "-assistant-test-secret-0002";
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const NOW_S = Math.floor(NOW / 1000);

const subject = (agentId: "support-assistant" | "ticket-assistant" = "support-assistant") => ({
  userId: "3f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01",
  agentId,
  runId: randomUUID(),
});

/** Signs arbitrary claims the way sessionToken.ts does: the format, written out as a spec. */
function signRaw(hop: TokenHop, claims: Record<string, unknown>, secret = SECRET): string {
  const info = hop === "agent" ? "ticketflow-assistant-agent-v1" : "ticketflow-assistant-mcp-v1";
  const key = Buffer.from(hkdfSync("sha256", secret, "", info, 32));
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

function validClaims(hop: TokenHop, overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    sub: "user-1",
    aud: tokenAudience(hop, "ticket-assistant"),
    iss: ASSISTANT_TOKEN_ISSUER,
    iat: NOW_S,
    exp: NOW_S + ASSISTANT_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
    ...overrides,
  };
}

describe("assistant session tokens", () => {
  it.each<TokenHop>(["agent", "mcp"])("round-trips on the %s hop and names the agent", (hop) => {
    const s = subject("ticket-assistant");
    const token = mintAssistantToken(hop, s, SECRET, NOW);
    const result = verifyAssistantToken(hop, token, [SECRET], NOW);
    expect(result).toEqual({
      ok: true,
      agentId: "ticket-assistant",
      claims: {
        v: 1,
        sub: s.userId,
        aud: `ticketflow-${hop}:ticket-assistant`,
        iss: "ticketflow-assistant",
        iat: NOW_S,
        exp: NOW_S + 300,
        jti: s.runId,
      },
    });
  });

  it("keeps the two hops apart even when given the same secret", () => {
    const agentToken = mintAssistantToken("agent", subject(), SECRET, NOW);
    const mcpToken = mintAssistantToken("mcp", subject(), SECRET, NOW);
    expect(verifyAssistantToken("mcp", agentToken, [SECRET], NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyAssistantToken("agent", mcpToken, [SECRET], NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses an audience for the other hop even when correctly signed for this one", () => {
    const token = signRaw("mcp", validClaims("mcp", { aud: tokenAudience("agent", "ticket-assistant") }));
    expect(verifyAssistantToken("mcp", token, [SECRET], NOW)).toEqual({ ok: false, reason: "wrong_audience" });
  });

  it("refuses an audience that names no known agent", () => {
    const token = signRaw("mcp", validClaims("mcp", { aud: "ticketflow-mcp:admin-assistant" }));
    expect(verifyAssistantToken("mcp", token, [SECRET], NOW)).toEqual({ ok: false, reason: "wrong_audience" });
  });

  it("returns the agent from the audience, so a customer token cannot pass as the staff agent", () => {
    const token = mintAssistantToken("mcp", subject("support-assistant"), SECRET, NOW);
    const result = verifyAssistantToken("mcp", token, [SECRET], NOW);
    expect(result.ok && result.agentId).toBe("support-assistant");
  });

  it("refuses a tampered payload", () => {
    const token = mintAssistantToken("mcp", subject(), SECRET, NOW);
    const [payload, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    claims.sub = "someone-else";
    const forged = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`;
    expect(verifyAssistantToken("mcp", forged, [SECRET], NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each(["", "abc", "a.b.c", ".sig", "payload.", 42 as unknown as string])("refuses malformed input %p", (token) => {
    expect(verifyAssistantToken("mcp", token, [SECRET], NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a signed payload that is not JSON", () => {
    const key = Buffer.from(hkdfSync("sha256", SECRET, "", "ticketflow-assistant-mcp-v1", 32));
    const payload = Buffer.from("not json").toString("base64url");
    const token = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
    expect(verifyAssistantToken("mcp", token, [SECRET], NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it.each([
    ["version", { v: 2 }],
    ["issuer", { iss: "ticketflow-helpdesk" }],
    ["subject", { sub: "has space" }],
    ["missing subject", { sub: undefined }],
    ["run id", { jti: "not-a-uuid" }],
    ["fractional iat", { iat: NOW_S + 0.5 }],
    ["stretched lifetime", { exp: NOW_S + ASSISTANT_TOKEN_TTL_SECONDS + 3600 }],
    ["shortened lifetime", { exp: NOW_S + 10 }],
  ])("refuses bad claims: %s", (_label, overrides) => {
    const token = signRaw("mcp", validClaims("mcp", overrides));
    expect(verifyAssistantToken("mcp", token, [SECRET], NOW)).toEqual({ ok: false, reason: "bad_claims" });
  });

  it("expires at exp, not after it", () => {
    const token = mintAssistantToken("mcp", subject(), SECRET, NOW);
    const lastValid = (NOW_S + ASSISTANT_TOKEN_TTL_SECONDS - 1) * 1000;
    expect(verifyAssistantToken("mcp", token, [SECRET], lastValid).ok).toBe(true);
    expect(verifyAssistantToken("mcp", token, [SECRET], lastValid + 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("allows clock skew up to the limit for iat in the future", () => {
    const within = mintAssistantToken("mcp", subject(), SECRET, NOW + ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS * 1000);
    const beyond = mintAssistantToken("mcp", subject(), SECRET, NOW + (ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS + 1) * 1000);
    expect(verifyAssistantToken("mcp", within, [SECRET], NOW).ok).toBe(true);
    expect(verifyAssistantToken("mcp", beyond, [SECRET], NOW)).toEqual({ ok: false, reason: "not_yet_valid" });
  });

  it("accepts the previous secret during a rotation and refuses it once cleared", () => {
    const token = mintAssistantToken("mcp", subject(), OTHER_SECRET, NOW);
    expect(verifyAssistantToken("mcp", token, [SECRET, OTHER_SECRET], NOW).ok).toBe(true);
    expect(verifyAssistantToken("mcp", token, [SECRET], NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("ignores empty secrets rather than verifying against them", () => {
    const token = mintAssistantToken("mcp", subject(), SECRET, NOW);
    expect(verifyAssistantToken("mcp", token, ["", ""], NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses to mint for an unsupported user id or a non-UUID run id", () => {
    expect(() => mintAssistantToken("mcp", { ...subject(), userId: "a b" }, SECRET, NOW)).toThrow(/user id/);
    expect(() => mintAssistantToken("mcp", { ...subject(), runId: "run-1" }, SECRET, NOW)).toThrow(/run id/);
  });
});
