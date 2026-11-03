import request from "supertest";
import { aiUsage, assistantAuditEvents, assistantUsageEvents, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { cleanUpAssistantRecords } from "../../../assistant/retention";
import { getBudgetSpend, getDailyUsage, getMonthlyUsage } from "../../../services/ai/costMonitoring";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";

/**
 * The admin views of assistant usage and audit, and their retention, against the real database.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: User;
let agent: User;
const RUN_A = "3f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01";
const RUN_B = "4f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c02";
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  admin = await createUser({ role: "admin" });
  agent = await createUser({ role: "agent" });
  const now = Date.now();
  await db.insert(assistantUsageEvents).values([
    { runId: RUN_A, agentId: "ticket-assistant", userId: agent.id, provider: "openrouter", model: "openai/gpt-5-mini", startedAt: new Date(now - 60_000), durationMs: 4000, status: "completed", toolCallCount: 1, toolNames: ["get_ticket"], proposalCount: 1 },
    { runId: RUN_B, agentId: "support-assistant", userId: agent.id, startedAt: new Date(now - 30_000), durationMs: 0, status: "refused", errorCategory: "daily_budget", toolNames: [] },
  ]);
  await db.insert(aiUsage).values([
    { modelId: "openai/gpt-5-mini", inputTokens: 1000, outputTokens: 200, estimatedCost: "0.000650", operation: "assistant.staff", userId: agent.id, assistantRunId: RUN_A },
    // Not an assistant run: must not count.
    { modelId: "openai/gpt-5-mini", inputTokens: 5, outputTokens: 5, estimatedCost: "9.000000", operation: "auto_response" },
  ]);
  await db.insert(assistantAuditEvents).values([
    { eventType: "write_proposed", reason: "add_comment", actorUserId: agent.id, runId: RUN_A },
    { eventType: "write_executed", reason: "add_comment", actorUserId: agent.id, runId: RUN_A },
    { eventType: "run_refused", reason: "daily_budget", actorUserId: admin.id },
  ]);
});

describe("assistant admin views", () => {
  it("are for administrators only", async () => {
    expect((await request(ctx.app).get("/api/admin/assistant/usage")).status).toBe(401);
    const a = await loginAs(ctx.app, agent);
    expect((await a.get("/api/admin/assistant/usage")).status).toBe(403);
    expect((await a.get("/api/admin/assistant/audit")).status).toBe(403);
  });

  it("usage: runs by outcome, and the assistant's own cost and tokens from ai_usage", async () => {
    const s = await loginAs(ctx.app, admin);
    const res = await s.get("/api/admin/assistant/usage?days=7");
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      runs: 2,
      byStatus: { completed: 1, failed: 0, stopped: 0, refused: 1 },
      proposals: 1,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.00065,
    });
    expect(res.body.cost).toEqual([expect.objectContaining({ operation: "assistant.staff", model: "openai/gpt-5-mini", costUsd: 0.00065 })]);
    expect(JSON.stringify(res.body)).not.toContain("auto_response");
    expect((await s.get("/api/admin/assistant/usage?days=0")).status).toBe(400);
    expect((await s.get("/api/admin/assistant/usage?days=91")).status).toBe(400);
  });

  it("audit: newest first, filtered by event and user, paged by id", async () => {
    const s = await loginAs(ctx.app, admin);
    const all = await s.get("/api/admin/assistant/audit");
    expect(all.body.events.map((e: { eventType: string }) => e.eventType)).toEqual(["run_refused", "write_executed", "write_proposed"]);
    const filtered = await s.get(`/api/admin/assistant/audit?event=write_executed&user=${agent.id}`);
    expect(filtered.body.events).toHaveLength(1);
    const page1 = await s.get("/api/admin/assistant/audit?limit=2");
    expect(page1.body.events).toHaveLength(2);
    const page2 = await s.get(`/api/admin/assistant/audit?limit=2&before=${page1.body.nextBefore}`);
    expect(page2.body.events.map((e: { eventType: string }) => e.eventType)).toEqual(["write_proposed"]);
    expect(page2.body.nextBefore).toBeNull();
    expect((await s.get("/api/admin/assistant/audit?event=drop_table")).status).toBe(400);
    expect((await s.get("/api/admin/assistant/audit?limit=500")).status).toBe(400);
  });

  it("the budget check counts spend exactly as the daily and monthly usage summaries do", async () => {
    await db.delete(aiUsage);
    const row = (at: string, estimatedCost: string, verified?: string) => ({
      modelId: "openai/gpt-5-mini", inputTokens: 1, outputTokens: 1, operation: "assistant.staff", timestamp: new Date(at), estimatedCost,
      ...(verified ? { billingStatus: "verified", verifiedCostUsd: verified } : {}),
    });
    await db.insert(aiUsage).values([
      row("2026-06-15T10:00:00Z", "1.000000"),
      row("2026-06-15T11:00:00Z", "3.000000", "0.500000"), // verified wins over the estimate
      row("2026-06-03T09:00:00Z", "2.000000"), // this month, not today
      row("2026-06-30T23:59:59Z", "8.000000"), // this month, not today
      row("2026-05-31T23:59:59Z", "4.000000"), // last month
      row("2026-07-01T00:00:00Z", "16.000000"), // next month
    ]);
    const spend = await getBudgetSpend(new Date("2026-06-15T12:00:00Z"));
    expect(spend).toEqual({ dailyUsd: 1.5, monthlyUsd: 11.5 });
    expect(spend.dailyUsd).toBeCloseTo((await getDailyUsage("2026-06-15")).totalCost, 6);
    expect(spend.monthlyUsd).toBeCloseTo((await getMonthlyUsage(2026, 6)).totalCost, 6);
  });

  it("retention: usage after 90 days, audit after 365, each on its own clock", async () => {
    const now = new Date();
    await db.insert(assistantUsageEvents).values({ runId: "5f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c03", agentId: "ticket-assistant", startedAt: new Date(now.getTime() - 91 * DAY), durationMs: 1, status: "completed", toolNames: [] });
    await db.insert(assistantAuditEvents).values([
      { eventType: "write_proposed", reason: "old but kept", occurredAt: new Date(now.getTime() - 200 * DAY) },
      { eventType: "write_proposed", reason: "too old", occurredAt: new Date(now.getTime() - 366 * DAY) },
    ]);
    expect(await cleanUpAssistantRecords(now)).toEqual({ usage: 1, audit: 1 });
    expect(await db.select().from(assistantUsageEvents)).toHaveLength(2);
    expect((await db.select().from(assistantAuditEvents)).map((e) => e.reason)).toContain("old but kept");
    // Configurable: a shorter audit window takes the 200-day one too.
    expect(await cleanUpAssistantRecords(now, { ASSISTANT_AUDIT_RETENTION_DAYS: "180" })).toEqual({ usage: 0, audit: 1 });
  });
});
