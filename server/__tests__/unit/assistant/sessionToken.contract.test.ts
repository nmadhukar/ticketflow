import { randomUUID } from "crypto";
import { ASSISTANT_AGENT_IDS } from "@shared/assistant";
import {
  ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS,
  ASSISTANT_TOKEN_ISSUER,
  ASSISTANT_TOKEN_TTL_SECONDS,
  ASSISTANT_TOKEN_VERSION,
  mintAssistantToken,
  verifyAssistantToken,
} from "../../../assistant/sessionToken";
// The sidecar's own copy (agents/ is a separate package and cannot import the app).
import * as sidecar from "../../../../agents/src/mastra/session-token";

/**
 * The app mints agent-hop tokens and the sidecar verifies them with its own code. If either side
 * changes the format alone, these fail.
 */
const SECRET = "c".repeat(16) + "-assistant-agent-contract-secret";
const NOW = Date.UTC(2026, 10, 2, 15, 30, 0);

describe("assistant token contract: app <-> sidecar", () => {
  it("shares the constants and the agent ids", () => {
    expect(sidecar.TOKEN_VERSION).toBe(ASSISTANT_TOKEN_VERSION);
    expect(sidecar.TOKEN_ISSUER).toBe(ASSISTANT_TOKEN_ISSUER);
    expect(sidecar.TOKEN_TTL_SECONDS).toBe(ASSISTANT_TOKEN_TTL_SECONDS);
    expect(sidecar.CLOCK_SKEW_SECONDS).toBe(ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS);
    expect([...sidecar.AGENT_IDS]).toEqual([...ASSISTANT_AGENT_IDS]);
  });

  it.each(ASSISTANT_AGENT_IDS)("the sidecar verifies an app-minted agent-hop token for %s", (agentId) => {
    const subject = { userId: "u-42", agentId, runId: randomUUID() };
    const token = mintAssistantToken("agent", subject, SECRET, NOW);
    const app = verifyAssistantToken("agent", token, [SECRET], NOW);
    const side = sidecar.verifyAgentToken(token, [SECRET], NOW);
    expect(side).toEqual(app);
    expect(side.ok && side.agentId).toBe(agentId);
  });

  it("the sidecar cannot verify an MCP-hop token, even holding the same secret", () => {
    const token = mintAssistantToken("mcp", { userId: "u-42", agentId: "ticket-assistant", runId: randomUUID() }, SECRET, NOW);
    expect(sidecar.verifyAgentToken(token, [SECRET], NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("both sides refuse the same inputs for the same reasons", () => {
    const good = mintAssistantToken("agent", { userId: "u-42", agentId: "support-assistant", runId: randomUUID() }, SECRET, NOW);
    const cases: Array<[string, string[], number]> = [
      [good, [SECRET], NOW + (ASSISTANT_TOKEN_TTL_SECONDS + 1) * 1000], // expired
      [good, [SECRET], NOW - (ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS + 1) * 1000], // not yet valid
      [good, ["d".repeat(40)], NOW], // wrong secret
      [`${good}.extra`, [SECRET], NOW], // malformed
      ["", [SECRET], NOW],
    ];
    for (const [token, secrets, now] of cases) {
      expect(sidecar.verifyAgentToken(token, secrets, now)).toEqual(verifyAssistantToken("agent", token, secrets, now));
    }
  });
});
