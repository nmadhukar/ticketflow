import request from "supertest";
import { eq } from "drizzle-orm";
import { aiUsage, taskComments, ticketAutoResponses, users } from "@shared/schema";
import { bedrockMock } from "../mocks/aws-bedrock.mock";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { AI_SYSTEM_USER_ID, AI_SYSTEM_USERNAME, ensureAiSystemUser } from "../../utils/aiSystemUser";
import { recordUsage } from "../../services/ai/costMonitoring";

jest.mock("../../services/ai/bedrockIntegration", () =>
  jest.requireActual("../mocks/aws-bedrock.mock").createBedrockIntegrationModule()
);

describe("AI routes honour settings, access and authorship", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    await ensureAiSystemUser();
    bedrockMock.reset();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function setSettings(settings: { enabled?: boolean; threshold?: string }) {
    const admin = await createUser({ role: "admin" });
    await storage.updateBedrockSettings(
      {
        bedrockAccessKeyId: "AKIAFAKEFAKEFAKE",
        bedrockSecretAccessKey: "fake-secret-for-tests",
        bedrockRegion: "us-east-1",
        bedrockModelId: "mock-model",
        autoResponseEnabled: settings.enabled ?? true,
        confidenceThreshold: settings.threshold ?? "0.7",
      } as any,
      admin.id
    );
    return admin;
  }

  const commentsOf = (taskId: number) =>
    db.select().from(taskComments).where(eq(taskComments.taskId, taskId));

  async function customerTicket(opts: Record<string, unknown> = {}) {
    const customer = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, customer);
    const res = await createTicketAs(agent, opts);
    expect(res.status).toBe(201);
    return { customer, customerA: agent, id: res.body.id as number };
  }

  describe("auto-response at ticket creation", () => {
    it("AI disabled in settings: no Bedrock call at all, ticket still created", async () => {
      await setSettings({ enabled: false });
      const { id } = await customerTicket();
      expect(bedrockMock.totalCalls()).toBe(0);
      expect(await commentsOf(id)).toHaveLength(0);
    });

    it("the setting is read at create time: an admin toggle applies to the next ticket", async () => {
      await setSettings({ enabled: false });
      const off = await customerTicket();
      expect(await commentsOf(off.id)).toHaveLength(0);
      await setSettings({ enabled: true });
      const on = await customerTicket();
      expect(await commentsOf(on.id)).toHaveLength(1);
    });

    it("threshold 0.9 and confidence 0.8: no auto-response comment", async () => {
      await setSettings({ threshold: "0.90" });
      bedrockMock.reset({ confidence: 0.8 });
      const { id } = await customerTicket();
      expect(bedrockMock.totalCalls()).toBeGreaterThan(0);
      expect(await commentsOf(id)).toHaveLength(0);
      const rows = await db.select().from(ticketAutoResponses).where(eq(ticketAutoResponses.ticketId, id));
      expect(rows.every((r) => r.wasApplied === false)).toBe(true);
    });

    it("threshold 0.7 and confidence 0.8: one comment, authored by the AI system user, not the customer", async () => {
      await setSettings({ threshold: "0.70" });
      const { id, customer, customerA } = await customerTicket();
      const comments = await commentsOf(id);
      expect(comments).toHaveLength(1);
      expect(comments[0].userId).toBe(AI_SYSTEM_USER_ID);
      expect(comments[0].userId).not.toBe(customer.id);

      const listed = await customerA.get(`/api/tasks/${id}/comments`);
      expect(listed.status).toBe(200);
      expect(listed.body[0].user.firstName).toBe("AI");
      expect(listed.body[0].user.lastName).toBe("Assistant");
      expect(listed.body[0].user.password).toBeUndefined();
    });

    it("Bedrock throwing: the ticket is still 201 and only the error type is logged", async () => {
      await setSettings({});
      const err: any = new Error("PROMPT-TEXT-SECRET and AKIAFAKEFAKEFAKE");
      err.name = "ThrottlingException";
      err.$metadata = { httpStatusCode: 429 };
      bedrockMock.analyzeTicket.mockRejectedValue(err);
      const { id } = await customerTicket();
      expect(id).toBeGreaterThan(0);
      expect(errorSpy).toHaveBeenCalled();
      const logged = JSON.stringify(errorSpy.mock.calls.map((c) => c.map(String)));
      expect(logged).toContain("ThrottlingException");
      expect(logged).not.toContain("PROMPT-TEXT-SECRET");
      expect(logged).not.toContain("AKIAFAKEFAKEFAKEFAKE");
      expect(logged).not.toContain("fake-secret-for-tests");
    });

    it("a cost-limit block does not fail the create either", async () => {
      await setSettings({});
      const blocked: any = new Error("Request blocked: daily limit");
      blocked.isBlocked = true;
      bedrockMock.analyzeTicket.mockRejectedValue(blocked);
      await customerTicket();
    });

    it("a failure writing the auto-response comment is logged, not swallowed silently", async () => {
      await setSettings({});
      jest.spyOn(storage, "addTaskComment").mockRejectedValue(new Error("db down"));
      const { id } = await customerTicket();
      expect(id).toBeGreaterThan(0);
      expect(JSON.stringify(errorSpy.mock.calls.map((c) => c.map(String)))).toMatch(/auto-response/i);
    });
  });

  describe("POST /api/ai/analyze-ticket and /api/ai/generate-response take a ticketId", () => {
    const calls: Array<[string, (a: ReturnType<typeof request.agent>, body: unknown) => request.Test]> = [
      ["analyze-ticket", (a, b) => a.post("/api/ai/analyze-ticket").send(b as object)],
      ["generate-response", (a, b) => a.post("/api/ai/generate-response").send(b as object)],
    ];

    describe.each(calls)("%s", (_name, call) => {
      it("rejects free text without a ticketId with 400", async () => {
        await setSettings({});
        const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
        const res = await call(adminA, { title: "t", description: "d", analysis: {} });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("validation_failed");
        expect(res.body.details.fieldErrors.ticketId).toBeDefined();
        const bad = await call(adminA, { ticketId: "abc" });
        expect(bad.status).toBe(400);
        expect(bedrockMock.totalCalls()).toBe(0);
      });

      it("404 for a missing ticket, 403 for a ticket outside the agent's scope, 403 for a customer", async () => {
        await setSettings({});
        const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
        const { id, customerA } = await customerTicket();
        const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
        bedrockMock.reset(); // creating the ticket ran the auto-response; count only what the gate lets through

        const missing = await call(adminA, { ticketId: 999999 });
        expect(missing.status).toBe(404);
        expect(missing.body.error).toBe("not_found");

        const outside = await call(agentA, { ticketId: id });
        expect(outside.status).toBe(403);
        expect(outside.body.error).toBe("forbidden");

        // The customer owns the ticket but the AI tools are staff tools.
        const own = await call(customerA, { ticketId: id });
        expect(own.status).toBe(403);
        expect(own.body.error).toBe("forbidden");
        expect(bedrockMock.totalCalls()).toBe(0);
      });

      it("admin gets 200, and the model sees the stored ticket, never client-sent text", async () => {
        await setSettings({});
        const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
        const { id } = await customerTicket({ title: "Stored title Alpha", description: "Stored body Beta" });
        bedrockMock.reset();
        const res = await call(adminA, {
          ticketId: id,
          title: "CLIENT-SENT-EVIL",
          description: "CLIENT-SENT-EVIL",
          analysis: { complexity: "low" },
        });
        expect(res.status).toBe(200);
        const seen = JSON.stringify(bedrockMock.runTicketAnalysisPrompt.mock.calls) +
          JSON.stringify(bedrockMock.runAutoResponseForTicketPrompt.mock.calls) +
          JSON.stringify(bedrockMock.analyzeTicket.mock.calls) +
          JSON.stringify(bedrockMock.generateResponse.mock.calls);
        expect(seen).toContain("Stored title Alpha");
        expect(seen).not.toContain("CLIENT-SENT-EVIL");
      });

      it("a cost-limit block is 429 quota_exceeded", async () => {
        await setSettings({});
        const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
        const { id } = await customerTicket();
        bedrockMock.reset();
        const blocked: any = new Error("Request blocked: daily limit");
        blocked.isBlocked = true;
        bedrockMock.analyzeTicket.mockRejectedValue(blocked);
        bedrockMock.runTicketAnalysisPrompt.mockRejectedValue(blocked);
        const res = await call(adminA, { ticketId: id });
        expect(res.status).toBe(429);
        expect(res.body.error).toBe("quota_exceeded");
      });
    });

    it("an agent who can see the ticket may use them", async () => {
      await setSettings({});
      const agent = await createUser({ role: "agent" });
      const agentA = await loginAs(ctx.app, agent);
      const created = await createTicketAs(agentA);
      bedrockMock.reset();
      expect((await agentA.post("/api/ai/analyze-ticket").send({ ticketId: created.body.id })).status).toBe(200);
    });
  });

  describe("POST /api/tasks/:id/auto-response/generate", () => {
    it("403 on an inaccessible ticket and for the ticket's own customer; 200 for admin", async () => {
      await setSettings({});
      const { id, customerA } = await customerTicket();
      bedrockMock.reset();
      const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      expect((await agentA.post(`/api/tasks/${id}/auto-response/generate`)).status).toBe(403);
      const own = await customerA.post(`/api/tasks/${id}/auto-response/generate`);
      expect(own.status).toBe(403);
      expect(own.body.error).toBe("forbidden");
      expect(bedrockMock.totalCalls()).toBe(0);
      expect((await adminA.post(`/api/tasks/${id}/auto-response/generate`)).status).toBe(200);
    });

    it("a cost-limit block is 429 quota_exceeded", async () => {
      await setSettings({});
      const { id } = await customerTicket();
      bedrockMock.reset();
      const blocked: any = new Error("Request blocked: daily limit");
      blocked.isBlocked = true;
      bedrockMock.analyzeTicket.mockRejectedValue(blocked);
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const res = await adminA.post(`/api/tasks/${id}/auto-response/generate`);
      expect(res.status).toBe(429);
      expect(res.body.error).toBe("quota_exceeded");
    });
  });

  describe("GET /api/ai/status", () => {
    it("customer 403, staff 200", async () => {
      const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
      const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
      const denied = await customerA.get("/api/ai/status");
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("forbidden");
      expect((await agentA.get("/api/ai/status")).status).toBe(200);
    });
  });

  describe("the AI system user", () => {
    it("is created idempotently as an inactive, password-less agent", async () => {
      await ensureAiSystemUser();
      await ensureAiSystemUser();
      const rows = await db.select().from(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      expect(rows).toHaveLength(1);
      expect(AI_SYSTEM_USERNAME).toBe("ai-assistant");
      expect(rows[0].role).toBe("agent");
      expect(rows[0].password).toBeNull();
      expect(rows[0].isActive).toBe(false);
      expect(rows[0].isApproved).toBe(false);
    });

    it("the seeder repairs a tampered row (password, active flag)", async () => {
      await db.update(users).set({ password: "x.y", isActive: true, isApproved: true, role: "admin" }).where(eq(users.id, AI_SYSTEM_USER_ID));
      await ensureAiSystemUser();
      const [row] = await db.select().from(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      expect([row.password, row.isActive, row.isApproved, row.role]).toEqual([null, false, false, "agent"]);
    });

    it("is created again on demand when a comment needs it (no seeder run)", async () => {
      await db.delete(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      await setSettings({});
      const { id } = await customerTicket();
      const comments = await commentsOf(id);
      expect(comments[0]?.userId).toBe(AI_SYSTEM_USER_ID);
    });

    it("cannot sign in: login and forgot-password answer exactly as for an unknown account", async () => {
      const [row] = await db.select().from(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      const ghost = "nobody@example.test";
      const loginAi = await request(ctx.app).post("/api/auth/login").send({ email: row.email, password: "whatever-123" });
      const loginGhost = await request(ctx.app).post("/api/auth/login").send({ email: ghost, password: "whatever-123" });
      expect(loginAi.status).toBe(loginGhost.status);
      expect(loginAi.body).toEqual(loginGhost.body);

      const forgotAi = await request(ctx.app).post("/api/auth/forgot-password").send({ email: row.email });
      const forgotGhost = await request(ctx.app).post("/api/auth/forgot-password").send({ email: ghost });
      expect(forgotAi.status).toBe(forgotGhost.status);
      expect(forgotAi.body).toEqual(forgotGhost.body);
      const [after] = await db.select().from(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      expect(after.passwordResetToken).toBeNull();
    });

    it("even with a password set, it is refused (defence in depth)", async () => {
      const pw = "Passw0rd!test";
      const { hashPassword } = await import("../../services/auth");
      const [row] = await db.select().from(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      await db.update(users).set({ password: await hashPassword(pw), isActive: true, isApproved: true }).where(eq(users.id, AI_SYSTEM_USER_ID));
      const res = await request(ctx.app).post("/api/auth/login").send({ email: row.email, password: pw });
      expect(res.status).toBe(401);
      const ghost = await request(ctx.app).post("/api/auth/login").send({ email: "nobody@example.test", password: pw });
      expect(res.body).toEqual(ghost.body);
    });

    it("admin actions on it answer 404 and change nothing", async () => {
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      for (const [method, path] of [
        ["post", `/api/admin/users/${AI_SYSTEM_USER_ID}/toggle-status`],
        ["post", `/api/admin/users/${AI_SYSTEM_USER_ID}/approve`],
        ["post", `/api/admin/users/${AI_SYSTEM_USER_ID}/reset-password`],
        ["patch", `/api/admin/users/${AI_SYSTEM_USER_ID}`],
      ] as const) {
        const res = await (adminA as any)[method](path).send({ isActive: true });
        expect([path, res.status]).toEqual([path, 404]);
      }
      const [row] = await db.select().from(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      expect([row.password, row.isActive, row.isApproved]).toEqual([null, false, false]);
    });

    it("is absent from /api/users, the team-member picker, admin listing, team members and counts", async () => {
      const admin = await createUser({ role: "admin" });
      const adminA = await loginAs(ctx.app, admin);
      const ids = (body: any[]) => body.map((u) => u.id);

      expect(ids((await adminA.get("/api/users")).body)).not.toContain(AI_SYSTEM_USER_ID);
      expect(ids((await adminA.get("/api/users?forTeamMemberSelection=true")).body)).not.toContain(AI_SYSTEM_USER_ID);
      expect(ids((await adminA.get("/api/admin/users")).body)).not.toContain(AI_SYSTEM_USER_ID);

      const team = await createTeam(admin);
      await db.execute(
        (await import("drizzle-orm")).sql`INSERT INTO team_members (team_id, user_id) VALUES (${team.id}, ${AI_SYSTEM_USER_ID})`
      );
      const members = await adminA.get(`/api/teams/${team.id}/members`);
      expect(JSON.stringify(members.body)).not.toContain(AI_SYSTEM_USER_ID);

      const stats = await storage.getAdminStats();
      expect(stats.totalUsers).toBe(1);

      const agent = await createUser({ role: "agent" });
      const { id } = await (async () => {
        const r = await createTicketAs(adminA);
        return { id: r.body.id as number };
      })();
      const meta = await adminA.get(`/api/tickets/${id}/meta`);
      expect(JSON.stringify(meta.body)).not.toContain(AI_SYSTEM_USER_ID);
      expect(agent.id).toBeTruthy();
    });

    it("cannot be named as a ticket assignee", async () => {
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const res = await createTicketAs(adminA, { assigneeId: AI_SYSTEM_USER_ID });
      expect(res.status).toBe(400);
    });
  });

  describe("cost rows survive a deleted ticket", () => {
    it("recordUsage with a ticket id that no longer exists stores the row with ticket_id NULL", async () => {
      const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
      await recordUsage("mock-model", 10, 20, "analyzeTicket", undefined, "987654");
      spy.mockRestore();
      const rows = await db.select().from(aiUsage);
      expect(rows).toHaveLength(1);
      expect(rows[0].ticketId).toBeNull();
      expect(rows[0].operation).toBe("analyzeTicket");
      expect(Number(rows[0].estimatedCost)).toBeGreaterThanOrEqual(0);
    });

    it("keeps the ticket id when the ticket exists", async () => {
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const t = await createTicketAs(adminA);
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      await recordUsage("mock-model", 10, 20, "analyzeTicket", undefined, String(t.body.id));
      const rows = await db.select().from(aiUsage);
      expect(rows[0].ticketId).toBe(t.body.id);
    });
  });
});
