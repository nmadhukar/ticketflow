import { randomUUID } from "crypto";
import type { AssistantAgentId } from "@shared/assistant";
import type { User } from "@shared/schema";
import { AssistantRuns, RENEW_WINDOW_SECONDS, type RunUser } from "../../../assistant/runAuth";
import { ASSISTANT_TOKEN_TTL_SECONDS, mintAssistantToken, verifyAssistantToken } from "../../../assistant/sessionToken";

const SESSION_SECRET = "s".repeat(16) + "-assistant-session-secret-test";
const OLD_SESSION_SECRET = "o".repeat(16) + "-assistant-session-secret-old";
const AGENT_SECRET = "g".repeat(16) + "-assistant-agent-secret-test";
const START = Date.UTC(2026, 10, 2, 9, 0, 0);

function setup(opts: { runMaxSeconds?: number; sessionSecrets?: string[] } = {}) {
  let now = START;
  const users = new Map<string, RunUser>([
    ["cust-1", { id: "cust-1", role: "customer" }],
    ["agent-1", { id: "agent-1", role: "agent" }],
    ["mgr-1", { id: "mgr-1", role: "manager" }],
    ["admin-1", { id: "admin-1", role: "admin" }],
    ["legacy-1", { id: "legacy-1", role: "user" }],
  ]);
  const runs = new AssistantRuns<RunUser>({
    sessionSecrets: opts.sessionSecrets ?? [SESSION_SECRET],
    agentSecret: AGENT_SECRET,
    runMaxSeconds: opts.runMaxSeconds ?? 900,
    loadUser: async (id) => users.get(id),
    blockReason: (user) => (user.isActive === false ? "account_inactive" : null),
    now: () => now,
  });
  return {
    runs,
    users,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

describe("assistant runs", () => {
  it("takes the users row as it is (checked by the typecheck)", () => {
    const row = {} as User;
    const asRunUser: RunUser = row;
    expect(asRunUser).toBe(row);
  });

  it("authenticates the MCP token of an open run as the user's current row", async () => {
    const { runs } = setup();
    const { runId, mcpToken } = runs.start("cust-1", "support-assistant");
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({
      ok: true,
      runId,
      agentId: "support-assistant",
      user: { id: "cust-1", role: "customer" },
    });
  });

  it("mints an agent-hop token the sidecar can verify and the MCP hop refuses", async () => {
    const { runs } = setup();
    const { runId, agentToken } = runs.start("agent-1", "ticket-assistant");
    const verified = verifyAssistantToken("agent", agentToken, [AGENT_SECRET], START);
    expect(verified.ok && verified.claims.jti).toBe(runId);
    await expect(runs.authenticate(agentToken)).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each<[string, AssistantAgentId]>([
    ["agent-1", "ticket-assistant"],
    ["mgr-1", "ticket-assistant"],
    ["admin-1", "ticket-assistant"],
    ["legacy-1", "ticket-assistant"],
    ["cust-1", "support-assistant"],
  ])("maps %s to %s", async (userId, agentId) => {
    const { runs } = setup();
    const { mcpToken } = runs.start(userId, agentId);
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: true, agentId });
  });

  it("refuses a run opened for the agent the user's role does not map to", async () => {
    const { runs } = setup();
    const customerOnStaff = runs.start("cust-1", "ticket-assistant");
    const staffOnSupport = runs.start("agent-1", "support-assistant");
    await expect(runs.authenticate(customerOnStaff.mcpToken)).resolves.toMatchObject({ ok: false, reason: "role_not_allowed" });
    await expect(runs.authenticate(staffOnSupport.mcpToken)).resolves.toMatchObject({ ok: false, reason: "role_not_allowed" });
  });

  it("refuses at the next call once the user's role changes mid-run", async () => {
    const { runs, users } = setup();
    const { mcpToken } = runs.start("cust-1", "support-assistant");
    users.set("cust-1", { id: "cust-1", role: "agent" });
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "role_not_allowed" });
    users.set("cust-1", { id: "cust-1", role: "superuser" });
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "role_not_allowed" });
  });

  it("refuses a user who was deleted, deactivated or must change their password", async () => {
    const { runs, users } = setup();
    const { mcpToken } = runs.start("agent-1", "ticket-assistant");

    users.set("agent-1", { id: "agent-1", role: "agent", isActive: false });
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "user_blocked" });

    users.set("agent-1", { id: "agent-1", role: "agent", mustChangePassword: true });
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "password_change_required" });

    users.delete("agent-1");
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "user_not_found" });
  });

  it("refuses a token issued before the user's last password change", async () => {
    const { runs, users, advance } = setup();
    const { mcpToken } = runs.start("agent-1", "ticket-assistant");
    advance(10);
    users.set("agent-1", { id: "agent-1", role: "agent", passwordChangedAt: new Date(START + 10_000) });
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "password_changed" });
  });

  it("refuses every token of a run once it has ended, before they expire", async () => {
    const { runs } = setup();
    const { runId, mcpToken } = runs.start("cust-1", "support-assistant");
    runs.end(runId);
    expect(runs.isOpen(runId)).toBe(false);
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "run_not_open", runId });
  });

  it("refuses, rather than approves, a run that ends while the user is being reloaded", async () => {
    const users = new Map<string, RunUser>([["cust-1", { id: "cust-1", role: "customer" }]]);
    let endDuringLoad: string | null = null;
    // loadUser reads `runs` only when called, after this assignment.
    const runs: AssistantRuns<RunUser> = new AssistantRuns<RunUser>({
      sessionSecrets: [SESSION_SECRET],
      agentSecret: AGENT_SECRET,
      runMaxSeconds: 900,
      loadUser: async (id) => {
        await Promise.resolve();
        if (endDuringLoad) runs.end(endDuringLoad); // the stream finished meanwhile
        return users.get(id);
      },
      blockReason: () => null,
      now: () => START,
    });
    const a = runs.start("cust-1", "support-assistant");
    endDuringLoad = a.runId;
    await expect(runs.authenticate(a.mcpToken)).resolves.toMatchObject({ ok: false, reason: "run_not_open" });

    // renew goes through the same check, so it refuses instead of throwing on the missing run.
    const b = runs.start("cust-1", "support-assistant");
    endDuringLoad = b.runId;
    await expect(runs.renew(b.mcpToken)).resolves.toMatchObject({ ok: false, reason: "run_not_open" });
  });

  it("lets only one of two concurrent renewals of the same token succeed", async () => {
    const { runs, advance } = setup();
    const { mcpToken } = runs.start("cust-1", "support-assistant");
    advance(ASSISTANT_TOKEN_TTL_SECONDS - RENEW_WINDOW_SECONDS);
    const results = await Promise.all([runs.renew(mcpToken), runs.renew(mcpToken)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: "already_renewed" });
  });

  it("refuses a validly signed token whose run id belongs to another user's run", async () => {
    const { runs } = setup();
    const other = runs.start("cust-1", "support-assistant");
    const forged = mintAssistantToken("mcp", { userId: "agent-1", agentId: "support-assistant", runId: other.runId }, SESSION_SECRET, START);
    await expect(runs.authenticate(forged)).resolves.toMatchObject({ ok: false, reason: "run_mismatch" });
    const unknownRun = mintAssistantToken("mcp", { userId: "cust-1", agentId: "support-assistant", runId: randomUUID() }, SESSION_SECRET, START);
    await expect(runs.authenticate(unknownRun)).resolves.toMatchObject({ ok: false, reason: "run_not_open" });
  });

  it("refuses a run past its maximum length and forgets it", async () => {
    const { runs, advance } = setup({ runMaxSeconds: 120 });
    const { runId, mcpToken } = runs.start("cust-1", "support-assistant");
    advance(121);
    await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "run_too_long" });
    expect(runs.isOpen(runId)).toBe(false);
  });

  it("drops runs past their maximum length when a new one starts", () => {
    const { runs, advance } = setup({ runMaxSeconds: 60 });
    const stale = runs.start("cust-1", "support-assistant");
    advance(61);
    runs.start("agent-1", "ticket-assistant");
    expect(runs.isOpen(stale.runId)).toBe(false);
  });

  it("accepts a token signed with the previous session secret during a rotation, and mints with the new one", async () => {
    const { runs } = setup({ sessionSecrets: [SESSION_SECRET, OLD_SESSION_SECRET] });
    const { runId, mcpToken } = runs.start("cust-1", "support-assistant");
    expect(verifyAssistantToken("mcp", mcpToken, [SESSION_SECRET], START).ok).toBe(true);
    // What an app instance still on the old secret would have issued for this run.
    const fromOld = mintAssistantToken("mcp", { userId: "cust-1", agentId: "support-assistant", runId }, OLD_SESSION_SECRET, START);
    await expect(runs.authenticate(fromOld)).resolves.toMatchObject({ ok: true, runId });
  });

  describe("renewal", () => {
    const renewAt = ASSISTANT_TOKEN_TTL_SECONDS - RENEW_WINDOW_SECONDS;

    it("refuses before the token's last two minutes", async () => {
      const { runs, advance } = setup();
      const { mcpToken } = runs.start("cust-1", "support-assistant");
      advance(renewAt - 1);
      await expect(runs.renew(mcpToken)).resolves.toMatchObject({ ok: false, reason: "renew_too_early" });
    });

    it("issues a fresh token for the same run, once per token, and lets a run outlive one token", async () => {
      const { runs, advance } = setup();
      const { runId, mcpToken } = runs.start("cust-1", "support-assistant");
      advance(renewAt);
      const renewed = await runs.renew(mcpToken);
      expect(renewed).toMatchObject({ ok: true, runId });
      expect(renewed.mcpToken).toBeDefined();

      await expect(runs.renew(mcpToken)).resolves.toMatchObject({ ok: false, reason: "already_renewed" });

      advance(ASSISTANT_TOKEN_TTL_SECONDS - renewAt + 1); // the first token has now expired
      await expect(runs.authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "expired" });
      await expect(runs.authenticate(renewed.mcpToken!)).resolves.toMatchObject({ ok: true, runId });
    });

    it("applies every authentication check, so a deactivated user cannot renew", async () => {
      const { runs, users, advance } = setup();
      const { mcpToken } = runs.start("agent-1", "ticket-assistant");
      advance(renewAt);
      users.set("agent-1", { id: "agent-1", role: "agent", isActive: false });
      await expect(runs.renew(mcpToken)).resolves.toMatchObject({ ok: false, reason: "user_blocked" });
    });

    it("refuses once the run has ended or reached its maximum length", async () => {
      const ended = setup();
      const a = ended.runs.start("cust-1", "support-assistant");
      ended.advance(renewAt);
      ended.runs.end(a.runId);
      await expect(ended.runs.renew(a.mcpToken)).resolves.toMatchObject({ ok: false, reason: "run_not_open" });

      const capped = setup({ runMaxSeconds: 200 });
      const b = capped.runs.start("cust-1", "support-assistant");
      capped.advance(renewAt + 30); // 210 s: inside the renew window but past the 200 s cap
      await expect(capped.runs.renew(b.mcpToken)).resolves.toMatchObject({ ok: false, reason: "run_too_long" });
    });
  });
});
