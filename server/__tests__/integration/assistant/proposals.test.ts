import request from "supertest";
import { eq } from "drizzle-orm";
import { assistantAuditEvents, assistantWriteProposals, taskComments, tasks, users, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { storage } from "../../../storage";
import { keyOwnerBlockReason } from "../../../services/auth/apiKeys";
import { createInternalApp } from "../../../assistant/internalServer";
import { createAssistantMcpServer } from "../../../assistant/mcpServer";
import { cleanUpProposals } from "../../../assistant/proposals";
import { AssistantRuns } from "../../../assistant/runAuth";
import { setAuditSink } from "../../../assistant/securityLog";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";

/**
 * Assistant-proposed writes, end to end against the real database: the assistant proposes over
 * its MCP surface, and only the user's Confirm on the real app route writes, once, as that user.
 */
const ENV = {
  ASSISTANT_ENABLED: "true",
  ASSISTANT_SESSION_SECRET: "proposals-test-assistant-session-secret-1",
  ASSISTANT_AGENT_SECRET: "proposals-test-assistant-agent-secret-002",
  APP_BASE_URL: "http://tickets.test",
};
const ORIGIN = ENV.APP_BASE_URL;
const saved: Record<string, string | undefined> = {};

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let runs: AssistantRuns<User>;
let internal: ReturnType<typeof createInternalApp>;
let A: User; // customer with a ticket
let B: User; // another customer
let staff: User; // agent assigned to A's ticket
let ticketId: number;
let ticketNumber: string;

async function callTool(token: string, name: string, args: object) {
  const res = await request(internal)
    .post("/internal/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set("X-TicketFlow-MCP-Session", token)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  expect(res.status).toBe(200);
  const text: string = res.body.result?.content?.[0]?.text ?? JSON.stringify(res.body.error ?? {});
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  return { isError: !!res.body.result?.isError || !!res.body.error, data };
}

const comments = async () => db.select().from(taskComments).where(eq(taskComments.taskId, ticketId));
const proposal = async (id: string) => (await db.select().from(assistantWriteProposals).where(eq(assistantWriteProposals.id, id)))[0];

async function proposeAsA(content = "Still broken after restarting the printer.") {
  const run = runs.start(A.id, "support-assistant");
  const r = await callTool(run.mcpToken, "propose_comment", { id: ticketNumber, content });
  expect(r.isError).toBe(false);
  return r.data.proposalId as string;
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  ctx = await createTestApp();
  runs = new AssistantRuns<User>({
    sessionSecrets: [ENV.ASSISTANT_SESSION_SECRET],
    agentSecret: ENV.ASSISTANT_AGENT_SECRET,
    runMaxSeconds: 900,
    loadUser: (id) => storage.getUser(id),
    blockReason: (user) => keyOwnerBlockReason(user),
  });
  internal = createInternalApp({
    runs: async () => runs,
    createMcpServer: async (user, agentId, ip, runId) => createAssistantMcpServer(user, agentId, ip, runId),
  });
});
afterAll(async () => {
  await ctx.close();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  await resetDb();
  A = await createUser({ role: "customer" });
  B = await createUser({ role: "customer" });
  staff = await createUser({ role: "agent" });
  const t = await storage.createTask({
    title: "Printer shows E-42",
    description: "Since Monday",
    category: "support",
    createdBy: A.id,
    assigneeId: staff.id,
    assigneeType: "user",
  } as never);
  ticketId = t.id;
  ticketNumber = t.ticketNumber;
});

describe("assistant proposals", () => {
  it("proposing writes nothing, and a repeated proposal is the same one", async () => {
    const run = runs.start(A.id, "support-assistant");
    const first = await callTool(run.mcpToken, "propose_comment", { id: ticketNumber, content: "More detail" });
    expect(first.data).toMatchObject({ action: "add_comment", status: "pending", ticket: { ticketNumber }, draft: { content: "More detail" } });
    expect(first.data.note).toMatch(/Nothing has been posted/);
    const again = await callTool(run.mcpToken, "propose_comment", { id: ticketId, content: "More detail" });
    expect(again.data.proposalId).toBe(first.data.proposalId);
    expect(await comments()).toEqual([]);
    expect(await db.select().from(assistantWriteProposals)).toHaveLength(1);
  });

  it("refuses a proposal the user could not make: another's ticket, bad input", async () => {
    const b = runs.start(B.id, "support-assistant");
    const other = await callTool(b.mcpToken, "propose_comment", { id: ticketNumber, content: "hi" });
    expect(other.isError).toBe(true);
    expect(other.data.code).toBe("NOT_FOUND");

    const a = runs.start(A.id, "support-assistant");
    expect((await callTool(a.mcpToken, "propose_comment", { id: ticketId, content: "   " })).data.code).toBe("VALIDATION");
    const badTicket = await callTool(a.mcpToken, "propose_ticket", { title: "Help", description: "x", category: "not-a-category" });
    expect(badTicket.isError).toBe(true);
    expect(badTicket.data.code).toBe("VALIDATION");
    expect(await db.select().from(assistantWriteProposals)).toEqual([]);
  });

  it("Confirm posts the comment once, as the user; a second Confirm changes nothing", async () => {
    const id = await proposeAsA();
    const agent = await loginAs(ctx.app, A);
    const ok = await agent.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({});
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "executed", action: "add_comment" });
    const posted = await comments();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ userId: A.id, content: "Still broken after restarting the printer." });
    expect(await proposal(id)).toMatchObject({ status: "executed", resultRef: `comment:${posted[0].id}` });

    const twice = await agent.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({});
    expect(twice.status).toBe(409);
    expect(await comments()).toHaveLength(1);
  });

  it("two simultaneous Confirms execute it exactly once", async () => {
    const id = await proposeAsA();
    const agent = await loginAs(ctx.app, A);
    const results = await Promise.all([1, 2, 3].map(() => agent.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await comments()).toHaveLength(1);
  });

  it("a refused edit leaves the proposal open, and the corrected edit then goes through", async () => {
    const id = await proposeAsA();
    const agent = await loginAs(ctx.app, A);
    const bad = await agent.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({ edits: { content: "   " } });
    expect(bad.status).toBe(400);
    expect(await proposal(id)).toMatchObject({ status: "pending", decidedAt: null });
    expect(await comments()).toEqual([]);

    const ok = await agent.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({ edits: { content: "My own words" } });
    expect(ok.status).toBe(200);
    expect((await comments()).map((c) => c.content)).toEqual(["My own words"]);
    expect(await proposal(id)).toMatchObject({ status: "executed", payload: { content: "My own words" } });
  });

  it("a ticket proposal with its title cleared is refused and stays open", async () => {
    const run = runs.start(A.id, "support-assistant");
    const proposed = await callTool(run.mcpToken, "propose_ticket", { title: "Scanner offline", description: "Since 9am", category: "support" });
    const a = await loginAs(ctx.app, A);
    const res = await a.post(`/api/assistant/proposals/${proposed.data.proposalId}/confirm`).set("Origin", ORIGIN).send({ edits: { title: "" } });
    expect(res.status).toBe(400);
    expect(await proposal(proposed.data.proposalId)).toMatchObject({ status: "pending" });
  });

  it("only the proposal's owner can decide it, from this site, while it is live", async () => {
    const id = await proposeAsA();
    const b = await loginAs(ctx.app, B);
    expect((await b.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(404);
    const a = await loginAs(ctx.app, A);
    expect((await a.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", "http://evil.test").send({})).status).toBe(403);
    expect((await a.post(`/api/assistant/proposals/${id}/confirm`).send({})).status).toBe(403);
    expect((await request(ctx.app).post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(401);
    expect((await a.post(`/api/assistant/proposals/not-a-uuid/confirm`).set("Origin", ORIGIN).send({})).status).toBe(404);

    await db.update(assistantWriteProposals).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(assistantWriteProposals.id, id));
    expect((await a.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(410);
    expect(await proposal(id)).toMatchObject({ status: "expired" });
    expect(await comments()).toEqual([]);
  });

  it("Reject records the decision and nothing is written", async () => {
    const id = await proposeAsA();
    const a = await loginAs(ctx.app, A);
    expect((await a.post(`/api/assistant/proposals/${id}/reject`).set("Origin", ORIGIN).send({})).body).toEqual({ status: "rejected" });
    expect((await a.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(409);
    expect(await comments()).toEqual([]);
  });

  it("a draft left by an account that is then deactivated can never be confirmed", async () => {
    const id = await proposeAsA();
    const a = await loginAs(ctx.app, A);
    await db.update(users).set({ isActive: false }).where(eq(users.id, A.id));
    expect((await a.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(401);
    expect(await comments()).toEqual([]);
    expect(await proposal(id)).toMatchObject({ status: "pending" });
  });

  it("access is checked again at Confirm: lost access means no write", async () => {
    const run = runs.start(staff.id, "ticket-assistant");
    const proposed = await callTool(run.mcpToken, "propose_comment", { id: ticketId, content: "We are on it." });
    expect(proposed.isError).toBe(false);
    await db.update(tasks).set({ assigneeId: null, assigneeType: null }).where(eq(tasks.id, ticketId));
    const s = await loginAs(ctx.app, staff);
    const res = await s.post(`/api/assistant/proposals/${proposed.data.proposalId}/confirm`).set("Origin", ORIGIN).send({});
    expect([403, 404]).toContain(res.status);
    expect(await comments()).toEqual([]);
    expect(await proposal(proposed.data.proposalId)).toMatchObject({ status: "failed" });
  });

  it("a confirmed ticket proposal creates the ticket as the customer", async () => {
    const run = runs.start(A.id, "support-assistant");
    const proposed = await callTool(run.mcpToken, "propose_ticket", {
      title: "VPN drops every 10 minutes",
      description: "Since the update yesterday the VPN disconnects every 10 minutes.",
      category: "support",
      priority: "high",
    });
    expect(proposed.data).toMatchObject({ action: "create_ticket", status: "pending" });
    const before = (await db.select().from(tasks)).length;
    const a = await loginAs(ctx.app, A);
    const ok = await a.post(`/api/assistant/proposals/${proposed.data.proposalId}/confirm`).set("Origin", ORIGIN).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.ticketNumber).toMatch(/^TKT-\d{4}-\d+$/);
    const created = (await db.select().from(tasks).where(eq(tasks.ticketNumber, ok.body.ticketNumber)))[0];
    expect(created).toMatchObject({ createdBy: A.id, title: "VPN drops every 10 minutes", priority: "high" });
    expect((await db.select().from(tasks)).length).toBe(before + 1);
  });

  it("staff cannot propose a ticket; writes switched off refuse decisions", async () => {
    const run = runs.start(staff.id, "ticket-assistant");
    const res = await callTool(run.mcpToken, "propose_ticket", { title: "x", description: "y", category: "support" });
    expect(res.isError).toBe(true);

    const id = await proposeAsA();
    process.env.ASSISTANT_WRITES_ENABLED = "false";
    try {
      const a = await loginAs(ctx.app, A);
      expect((await a.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(503);
    } finally {
      delete process.env.ASSISTANT_WRITES_ENABLED;
    }
    expect(await comments()).toEqual([]);
  });

  it("retention: expires pending, clears text after 7 days, deletes after 90", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const [stale, decided, ancient, stuck, busy] = [
      await proposeAsA("a"),
      await proposeAsA("b"),
      await proposeAsA("c"),
      await proposeAsA("d"),
      await proposeAsA("e"),
    ];
    await db.update(assistantWriteProposals).set({ expiresAt: new Date(now - 1000) }).where(eq(assistantWriteProposals.id, stale));
    await db.update(assistantWriteProposals).set({ status: "rejected", decidedAt: new Date(now - 8 * day) }).where(eq(assistantWriteProposals.id, decided));
    await db.update(assistantWriteProposals).set({ createdAt: new Date(now - 91 * day) }).where(eq(assistantWriteProposals.id, ancient));
    // Left "executing" by a crash 11 minutes ago, and one claimed a moment ago (still running).
    await db.update(assistantWriteProposals).set({ status: "executing", decidedAt: new Date(now - 11 * 60_000) }).where(eq(assistantWriteProposals.id, stuck));
    await db.update(assistantWriteProposals).set({ status: "executing", decidedAt: new Date(now - 60_000) }).where(eq(assistantWriteProposals.id, busy));
    expect(await cleanUpProposals(new Date(now))).toEqual({ expired: 1, interrupted: 1, cleared: 1, deleted: 1 });
    expect(await proposal(stale)).toMatchObject({ status: "expired" });
    expect(await proposal(decided)).toMatchObject({ status: "rejected", payload: null });
    expect(await proposal(ancient)).toBeUndefined();
    expect(await proposal(stuck)).toMatchObject({ status: "failed", failureCode: "INTERRUPTED" });
    expect(await proposal(busy)).toMatchObject({ status: "executing" });
  });

  it("records the proposal, the confirmation and the write in the audit trail", async () => {
    const id = await proposeAsA();
    const a = await loginAs(ctx.app, A);
    expect((await a.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(200);
    // Background writes settle.
    await new Promise((r) => setTimeout(r, 200));
    const events = await db.select().from(assistantAuditEvents).where(eq(assistantAuditEvents.proposalId, id));
    expect(events.map((e) => e.eventType).sort()).toEqual(["write_confirmed", "write_executed", "write_proposed"]);
    for (const e of events) expect(e).toMatchObject({ actorUserId: A.id, ticketId, agentId: "support-assistant" });
  });

  it("writes nothing when the confirmation cannot be recorded", async () => {
    const id = await proposeAsA();
    const a = await loginAs(ctx.app, A);
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    const restore = setAuditSink(async () => {
      throw new Error("audit store down");
    });
    try {
      const res = await a.post(`/api/assistant/proposals/${id}/confirm`).set("Origin", ORIGIN).send({});
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("audit_unavailable");
    } finally {
      setAuditSink(restore);
      errors.mockRestore();
    }
    expect(await comments()).toEqual([]);
    expect(await proposal(id)).toMatchObject({ status: "pending" });
  });
});
