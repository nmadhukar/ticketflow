import request from "supertest";
import { eq } from "drizzle-orm";
import {
  aiChatMessages,
  aiSettings,
  bedrockSettings,
  faqCache,
  helpDocuments,
  knowledgeArticles,
  learningQueue,
  tasks,
} from "@shared/schema";
import { aiModelMock, MOCK_MODEL_ID } from "../mocks/openRouter.mock";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";

type Agent = ReturnType<typeof request.agent>;

/**
 * The admin and chat side of the AI features, with OpenRouter faked at the HTTP boundary:
 * I5 chat, I6 admin AI settings and the connection test, I8 (superseded: the manual
 * retrieval path that replaces Knowledge Base sync), I9 learning from resolved tickets,
 * S5 the FAQ cache.
 */
describe("AI chat, admin settings, learning and the FAQ cache", () => {
  const priorOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
    if (priorOpenRouterApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorOpenRouterApiKey;
  });
  beforeEach(async () => {
    await resetDb();
    await ensureAiSystemUser();
    aiModelMock.reset();
    // Routes log failures by type; keep the run output readable.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function configureBedrock(extra: Record<string, unknown> = {}) {
    const admin = await createUser({ role: "admin" });
    await storage.updateBedrockSettings(
      {
        bedrockAccessKeyId: "AKIAFAKEFAKEFAKE",
        bedrockSecretAccessKey: "fake-secret-for-tests",
        bedrockRegion: "us-east-1",
        bedrockModelId: MOCK_MODEL_ID,
        autoResponseEnabled: true,
        confidenceThreshold: "0.7",
        maxResponseLength: 1000,
        maxTokensPerRequest: 3000,
        ...extra,
      } as any,
      admin.id
    );
    await storage.updateAISettings({ modelId: MOCK_MODEL_ID, isActive: true, autoResponseEnabled: true,
      confidenceThreshold: "0.7", maxResponseLength: 1000, maxTokensPerRequest: 3000, ...extra } as any, admin.id);
    return admin;
  }
  const adminAgent = async () => loginAs(ctx.app, await createUser({ role: "admin" }));
  const asRole = async (role: "agent" | "manager" | "customer") => loginAs(ctx.app, await createUser({ role }));

  const CHAT_ANSWER =
    "To reset your password open the sign-in page, choose Forgot password and follow the link in the email.";
  function answerChatWith(text: string) {
    const base = aiModelMock.handler;
    aiModelMock.handler = (p) => (p.includes("helpful assistant for TicketFlow") ? text : base(p));
  }

  // ---------------------------------------------------------------- I5
  describe("I5: chat assistant", () => {
    it("without Bedrock it answers from the help documents; the exchange is saved and listed", async () => {
      await db.insert(helpDocuments).values({
        title: "Password reset guide",
        filename: "reset.txt",
        content: "Open the sign-in page and choose Forgot password.",
        fileData: "",
      });
      const customer = await createUser({ role: "customer" });
      const agent = await loginAs(ctx.app, customer);

      const res = await agent.post("/api/chat").send({ sessionId: "sess-1", message: "password reset" });
      expect(res.status).toBe(200);
      expect(res.body.message.role).toBe("assistant");
      expect(res.body.message.sessionId).toBe("sess-1");
      expect(res.body.message.content).toContain("Password reset guide");
      expect(aiModelMock.totalCalls()).toBe(0);

      const history = await agent.get("/api/chat/sess-1");
      expect(history.status).toBe(200);
      expect(history.body.map((m: any) => [m.role, m.sessionId])).toEqual([
        ["user", "sess-1"],
        ["assistant", "sess-1"],
      ]);
      expect(history.body[0].content).toBe("password reset");
      expect(history.body[1].content).toContain("Password reset guide");

      const sessions = await agent.get("/api/chat-sessions");
      expect(sessions.status).toBe(200);
      expect(sessions.body).toHaveLength(1);
      expect(sessions.body[0].sessionId).toBe("sess-1");
      expect(sessions.body[0].lastMessage.length).toBeGreaterThan(0);
    });

    it("with Bedrock the model's answer is returned and saved, and usage is recorded", async () => {
      await configureBedrock();
      answerChatWith(CHAT_ANSWER);
      const agent = await asRole("agent");

      const res = await agent.post("/api/chat").send({ sessionId: "sess-2", message: "How do I reset my password?" });
      expect(res.status).toBe(200);
      expect(res.body.message.content).toBe(CHAT_ANSWER);
      expect(res.body.usageData.totalTokens).toBe(30); // the mock reports 10 in + 20 out
      expect(aiModelMock.seen()).toContain("How do I reset my password?");

      const saved = await agent.get("/api/chat/sess-2");
      expect(saved.body.map((m: any) => m.role)).toEqual(["user", "assistant"]);
      expect(saved.body[1].content).toBe(CHAT_ANSWER);
    });

    it("a Bedrock failure falls back to the knowledge base instead of failing the chat", async () => {
      await configureBedrock();
      await db.insert(knowledgeArticles).values({
        title: "Printer jam fix",
        content: "Open the rear tray and remove the jammed paper.",
        isPublished: true,
        status: "published",
      });
      aiModelMock.handler = () => new Error("throttled");
      const agent = await asRole("agent");

      const res = await agent.post("/api/chat").send({ sessionId: "sess-3", message: "printer jam" });
      expect(res.status).toBe(200);
      expect(res.body.message.content).toContain("Printer jam fix");
    });

    it("history and the session list belong to the caller only", async () => {
      const a = await asRole("agent");
      const b = await asRole("agent");
      await a.post("/api/chat").send({ sessionId: "shared-id", message: "hello there" }).expect(200);

      expect((await b.get("/api/chat/shared-id")).body).toEqual([]);
      expect((await b.get("/api/chat-sessions")).body).toEqual([]);
      expect((await a.get("/api/chat-sessions")).body.map((s: any) => s.sessionId)).toEqual(["shared-id"]);
    });

    it("validates the body: a session id and 1-2000 characters; anonymous is 401", async () => {
      const agent = await asRole("agent");
      expect((await agent.post("/api/chat").send({ message: "hi" })).status).toBe(400);
      expect((await agent.post("/api/chat").send({ sessionId: "s" })).status).toBe(400);
      expect((await agent.post("/api/chat").send({ sessionId: "s", message: "   " })).status).toBe(400);
      expect((await agent.post("/api/chat").send({ sessionId: "s", message: "x".repeat(2001) })).status).toBe(400);
      expect(await db.select().from(aiChatMessages)).toHaveLength(0);
      expect((await request(ctx.app).post("/api/chat").send({ sessionId: "s", message: "hi" })).status).toBe(401);
      expect((await request(ctx.app).get("/api/chat/s")).status).toBe(401);
      expect((await request(ctx.app).get("/api/chat-sessions")).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------- S5
  describe("S5: FAQ cache", () => {
    it("a repeated question is answered from the cache; an admin lists it, then clears it", async () => {
      await configureBedrock();
      answerChatWith(CHAT_ANSWER);
      const agent = await asRole("agent");
      const question = "How do I reset my password?";

      const first = await agent.post("/api/chat").send({ sessionId: "c1", message: question });
      expect(first.body.fromCache).toBeUndefined();
      expect(aiModelMock.totalCalls()).toBe(1);

      const second = await agent.post("/api/chat").send({ sessionId: "c2", message: question });
      expect(second.status).toBe(200);
      expect(second.body.fromCache).toBe(true);
      expect(second.body.message.content).toBe(CHAT_ANSWER);
      expect(aiModelMock.totalCalls()).toBe(1); // the model was not asked again

      const admin = await adminAgent();
      const listed = await admin.get("/api/faq-cache");
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].answer).toBe(CHAT_ANSWER);
      expect(listed.body[0].hitCount).toBe(2);

      const cleared = await admin.delete("/api/faq-cache");
      expect(cleared.status).toBe(200);
      expect(await db.select().from(faqCache)).toHaveLength(0);
      expect((await admin.get("/api/faq-cache")).body).toEqual([]);

      // After clearing, the same question goes to the model again.
      await agent.post("/api/chat").send({ sessionId: "c3", message: question }).expect(200);
      expect(aiModelMock.totalCalls()).toBe(2);
    });

    it("the list honours ?limit and orders by hits", async () => {
      await db.insert(faqCache).values([
        { questionHash: "h1", originalQuestion: "q1", normalizedQuestion: "q1", answer: "a1", hitCount: 1 },
        { questionHash: "h2", originalQuestion: "q2", normalizedQuestion: "q2", answer: "a2", hitCount: 9 },
        { questionHash: "h3", originalQuestion: "q3", normalizedQuestion: "q3", answer: "a3", hitCount: 5 },
      ]);
      const admin = await adminAgent();
      const top = await admin.get("/api/faq-cache?limit=2");
      expect(top.body.map((r: any) => r.questionHash)).toEqual(["h2", "h3"]);
    });

    it("?limit is an integer clamped to 1..100; anything else falls back to 10", async () => {
      await db.insert(faqCache).values(
        Array.from({ length: 12 }, (_, i) => ({ questionHash: `h${i}`, originalQuestion: `q${i}`, normalizedQuestion: `q${i}`, answer: "a", hitCount: i + 1 }))
      );
      const admin = await adminAgent();
      const len = async (qs: string) => {
        const res = await admin.get(`/api/faq-cache${qs}`);
        expect([qs, res.status]).toEqual([qs, 200]);
        return res.body.length;
      };
      expect(await len("")).toBe(10);
      expect(await len("?limit=abc")).toBe(10);
      expect(await len("?limit=")).toBe(10);
      expect(await len("?limit=1.5x")).toBe(1);
      expect(await len("?limit=0")).toBe(1);
      expect(await len("?limit=-5")).toBe(1);
      expect(await len("?limit=3")).toBe(3);
      expect(await len("?limit=100000")).toBe(12); // capped at 100, only 12 rows exist
    });

    it("only an admin may list or clear it (403), anonymous is 401, and a refused clear keeps the rows", async () => {
      await db.insert(faqCache).values({ questionHash: "h1", originalQuestion: "q", normalizedQuestion: "q", answer: "a" });
      for (const role of ["agent", "manager", "customer"] as const) {
        const a = await asRole(role);
        expect([role, (await a.get("/api/faq-cache")).status]).toEqual([role, 403]);
        expect([role, (await a.delete("/api/faq-cache")).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).get("/api/faq-cache")).status).toBe(401);
      expect((await request(ctx.app).delete("/api/faq-cache")).status).toBe(401);
      expect(await db.select().from(faqCache)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------- I6
  describe("I6: admin AI settings and the connection test", () => {
    it("only an admin may read, update or test (403); anonymous is 401", async () => {
      await configureBedrock();
      for (const role of ["agent", "manager", "customer"] as const) {
        const a = await asRole(role);
        expect([role, "get", (await a.get("/api/admin/ai-settings")).status]).toEqual([role, "get", 403]);
        expect([role, "put", (await a.put("/api/admin/ai-settings").send({ confidenceThreshold: 0.1 })).status]).toEqual([role, "put", 403]);
        expect([role, "test", (await a.post("/api/admin/ai-settings/test")).status]).toEqual([role, "test", 403]);
      }
      expect((await request(ctx.app).get("/api/admin/ai-settings")).status).toBe(401);
      expect((await request(ctx.app).put("/api/admin/ai-settings").send({})).status).toBe(401);
      expect((await request(ctx.app).post("/api/admin/ai-settings/test")).status).toBe(401);
      // The refused PUT changed nothing.
      const [row] = await db.select().from(bedrockSettings);
      expect(Number(row.confidenceThreshold)).toBe(0.7);
      expect(aiModelMock.totalCalls()).toBe(0);
    });

    it("an admin reads the defaults, updates the threshold and the auto-response switch, and reads them back", async () => {
      const admin = await adminAgent();
      const initial = await admin.get("/api/admin/ai-settings");
      expect(initial.status).toBe(200);
      expect(initial.body.confidenceThreshold).toBe(0.7);
      expect(initial.body.autoResponseEnabled).toBe(true);

      const put = await admin.put("/api/admin/ai-settings").send({ confidenceThreshold: 0.55, autoResponseEnabled: false });
      expect(put.status).toBe(200);
      expect(put.body.confidenceThreshold).toBe(0.55);
      expect(put.body.autoResponseEnabled).toBe(false);

      const again = await admin.get("/api/admin/ai-settings");
      expect(again.body.confidenceThreshold).toBe(0.55);
      expect(again.body.autoResponseEnabled).toBe(false);
      // Other settings are kept.
      expect(again.body.maxResponseLength).toBe(initial.body.maxResponseLength);

      const [row] = await db.select().from(aiSettings);
      expect(Number(row.confidenceThreshold)).toBe(0.55);
      expect(row.autoResponseEnabled).toBe(false);
    });

    it("out-of-range numbers are clamped, never stored raw", async () => {
      const admin = await adminAgent();
      const put = await admin.put("/api/admin/ai-settings").send({ confidenceThreshold: 7, maxResponseLength: 5 });
      expect(put.status).toBe(200);
      expect(put.body.confidenceThreshold).toBe(1);
      expect(put.body.maxResponseLength).toBe(100);
    });

    it("an unknown escalation team is 400 and changes nothing", async () => {
      const admin = await adminAgent();
      const res = await admin.put("/api/admin/ai-settings").send({ escalationTeamId: 999999, confidenceThreshold: 0.2 });
      expect(res.status).toBe(400);
      expect((await admin.get("/api/admin/ai-settings")).body.confidenceThreshold).toBe(0.7);

      const adminUser = await createUser({ role: "admin" });
      const team = await createTeam(adminUser);
      const ok = await (await loginAs(ctx.app, adminUser)).put("/api/admin/ai-settings").send({ escalationTeamId: team.id });
      expect(ok.status).toBe(200);
      expect(ok.body.escalationTeamId).toBe(team.id);
    });

    it("the saved switch is what ticket creation obeys: switched off over the API means no Bedrock call", async () => {
      await configureBedrock();
      await db.insert(knowledgeArticles).values({ title: "Printerjam fix", content: "How to clear a printerjam", isPublished: true, status: "published" });
      const admin = await adminAgent();
      await admin.put("/api/admin/ai-settings").send({ autoResponseEnabled: false }).expect(200);
      aiModelMock.reset();

      const customerA = await asRole("customer");
      expect((await createTicketAs(customerA, { title: "Printerjam broken" })).status).toBe(201);
      expect(aiModelMock.totalCalls()).toBe(0);
    });

    it("test connection: connected is 200 {success:true}", async () => {
      await configureBedrock();
      const base = aiModelMock.handler;
      aiModelMock.handler = (p) => (p.includes("this is a test") ? "Connection successful" : base(p));
      const admin = await adminAgent();
      const res = await admin.post("/api/admin/ai-settings/test");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(aiModelMock.totalCalls()).toBe(1);
    });

    it("test connection: a model that does not confirm, or an upstream error, is a clear 400 (it used to say success)", async () => {
      await configureBedrock();
      const admin = await adminAgent();

      aiModelMock.handler = () => "I cannot do that";
      const unconfirmed = await admin.post("/api/admin/ai-settings/test");
      expect(unconfirmed.status).toBe(400);
      expect(unconfirmed.body.error).toBe("ai_connection_failed");
      expect(unconfirmed.body.code).toBe("provider_failure");

      aiModelMock.handler = () => Object.assign(new Error("denied"), { name: "AccessDeniedException" });
      const upstream = await admin.post("/api/admin/ai-settings/test");
      expect(upstream.status).toBe(400);
      expect(upstream.body.error).toBe("ai_connection_failed");
      expect(JSON.stringify(upstream.body)).not.toContain("fake-secret-for-tests");
    });

    it("test connection: with no active provider settings it is 503, and OpenRouter is never called", async () => {
      const admin = await adminAgent();
      const res = await admin.post("/api/admin/ai-settings/test");
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("ai_connection_failed");
      expect(res.body.code).toBe("not_configured");
      expect(aiModelMock.totalCalls()).toBe(0);
    });
  });

  // ---------------------------------------------------------------- I8
  describe("I8 (superseded, R5/R38): no Knowledge Base sync endpoints; manual retrieval is the path", () => {
    it("the sync routes do not exist (nothing dead was re-added)", async () => {
      const admin = await adminAgent();
      for (const [method, path] of [
        ["get", "/api/admin/knowledge-base/status"],
        ["get", "/api/admin/knowledge-base/data-sources"],
        ["post", "/api/admin/knowledge-base/sync"],
        ["get", "/api/admin/knowledge-base/sync/job-1"],
      ] as const) {
        const res = await (admin as any)[method](path);
        expect([path, res.status]).toEqual([path, 404]);
      }
    });

    it("search works with Bedrock not configured: manual retrieval returns the published article", async () => {
      await db.insert(knowledgeArticles).values([
        { title: "Printer jam fix", content: "Open the rear tray", isPublished: true, status: "published" },
        { title: "Printer secret draft", content: "Not for readers", isPublished: false, status: "draft" },
      ]);
      const agent = await asRole("agent");
      const res = await agent.get("/api/ai/knowledge-search?query=printer");
      expect(res.status).toBe(200);
      expect(res.body.map((r: any) => r.article.title)).toEqual(["Printer jam fix"]);
      expect(res.body[0].relevanceScore).toBe(50);
      expect(aiModelMock.totalCalls()).toBe(0);
    });

    it("search falls back to manual retrieval when the model is down", async () => {
      await configureBedrock();
      await db.insert(knowledgeArticles).values({ title: "Printer jam fix", content: "Open the rear tray", isPublished: true, status: "published" });
      aiModelMock.handler = () => new Error("model down");
      const agent = await asRole("agent");
      const res = await agent.get("/api/ai/knowledge-search?query=printer");
      expect(res.status).toBe(200);
      expect(res.body.map((r: any) => r.article.title)).toEqual(["Printer jam fix"]);
    });
  });

  // ---------------------------------------------------------------- I9
  describe("I9: learning from resolved tickets", () => {
    const ARTICLE = {
      title: "AI written: fixing the timeout",
      summary: "Dashboard timeouts come from an exhausted pool.",
      content: "Restart the connection pool and the timeouts stop.",
      prerequisites: ["admin access"],
      variations: ["slow login"],
    };
    function modelWritesArticles() {
      const base = aiModelMock.handler;
      aiModelMock.handler = (p) => (p.includes("Create a knowledge base article from this resolved ticket") ? JSON.stringify(ARTICLE) : base(p));
    }

    /** A ticket with a resolution comment the learner can use (two comments, one long one saying "fixed"). */
    async function ticketWithResolution(admin: Agent) {
      const t = await createTicketAs(admin, { title: "Database timeout", description: "Dashboard times out" });
      const id = t.body.id as number;
      await admin.post(`/api/tasks/${id}/comments`).send({ content: "Looking into it now." }).expect(201);
      await admin
        .post(`/api/tasks/${id}/comments`)
        .send({ content: "Root cause found: the pool was exhausted. Fixed by restarting the connection pool." })
        .expect(201);
      return id;
    }
    const articlesFor = async (ticketId: number) =>
      (await db.select().from(knowledgeArticles)).filter((a) => (a.sourceTicketIds ?? []).includes(ticketId));

    it("resolving a ticket learns an article from it (held for approval) and the update succeeds", async () => {
      await configureBedrock();
      modelWritesArticles();
      const admin = await adminAgent();
      await admin.put("/api/admin/ai-settings").send({ autoLearnEnabled: true, minResolutionScore: 0, articleApprovalRequired: true }).expect(200);
      const id = await ticketWithResolution(admin);
      aiModelMock.reset();
      modelWritesArticles();

      const res = await admin.patch(`/api/tasks/${id}`).send({ status: "resolved" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("resolved");

      const learned = await articlesFor(id);
      expect(learned).toHaveLength(1);
      expect(learned[0].title).toBe(ARTICLE.title);
      expect(learned[0].isPublished).toBe(false); // approval required: not visible to readers yet
      expect(aiModelMock.seen()).toContain("Database timeout");
    });

    it("with approval off the learned article is published", async () => {
      await configureBedrock();
      const admin = await adminAgent();
      await admin.put("/api/admin/ai-settings").send({ autoLearnEnabled: true, minResolutionScore: 0, articleApprovalRequired: false }).expect(200);
      const id = await ticketWithResolution(admin);
      modelWritesArticles();
      await admin.patch(`/api/tasks/${id}`).send({ status: "resolved" }).expect(200);
      const learned = await articlesFor(id);
      expect(learned).toHaveLength(1);
      expect(learned[0].isPublished).toBe(true);
    });

    it("with learning switched off, resolving learns nothing and still succeeds", async () => {
      await configureBedrock();
      const admin = await adminAgent();
      await admin.put("/api/admin/ai-settings").send({ autoLearnEnabled: false }).expect(200);
      const id = await ticketWithResolution(admin);
      aiModelMock.reset();
      modelWritesArticles();
      await admin.patch(`/api/tasks/${id}`).send({ status: "resolved" }).expect(200);
      expect(await articlesFor(id)).toHaveLength(0);
      expect(aiModelMock.totalCalls()).toBe(0);
    });

    it("a ticket without a usable resolution learns nothing; the update still succeeds", async () => {
      await configureBedrock();
      const admin = await adminAgent();
      await admin.put("/api/admin/ai-settings").send({ autoLearnEnabled: true, minResolutionScore: 0 }).expect(200);
      const t = await createTicketAs(admin);
      await admin.patch(`/api/tasks/${t.body.id}`).send({ status: "resolved" }).expect(200);
      expect(await articlesFor(t.body.id)).toHaveLength(0);
    });

    it("if the learning step throws, the status change is kept and the response is 200", async () => {
      const { knowledgeBaseService } = await import("../../services/ai/knowledgeBase");
      jest.spyOn(knowledgeBaseService, "learnFromResolvedTicket").mockRejectedValue(new Error("boom"));
      const admin = await adminAgent();
      const t = await createTicketAs(admin);
      const res = await admin.patch(`/api/tasks/${t.body.id}`).send({ status: "resolved" });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(tasks).where(eq(tasks.id, t.body.id));
      expect(row.status).toBe("resolved");
      expect(row.resolvedAt).not.toBeNull();
    });

    it("add-to-learning queues a resolved ticket once; an open ticket and a repeat are refused", async () => {
      const admin = await adminAgent();
      const resolved = (await createTicketAs(admin)).body.id as number;
      await admin.patch(`/api/tasks/${resolved}`).send({ status: "resolved" }).expect(200);
      const open = (await createTicketAs(admin)).body.id as number;

      const queued = await admin.post(`/api/tasks/${resolved}/add-to-learning`);
      expect(queued.status).toBe(200);
      expect(queued.body.ticketId).toBe(resolved);
      expect(queued.body.processStatus).toBe("pending");

      const again = await admin.post(`/api/tasks/${resolved}/add-to-learning`);
      expect(again.status).toBe(400);
      const notResolved = await admin.post(`/api/tasks/${open}/add-to-learning`);
      expect(notResolved.status).toBe(400);
      expect(await db.select().from(learningQueue)).toHaveLength(1);
    });

    it("add-to-learning respects ticket access: an agent outside the ticket's scope is 403 and nothing is queued", async () => {
      const admin = await adminAgent();
      const resolved = (await createTicketAs(admin)).body.id as number;
      await admin.patch(`/api/tasks/${resolved}`).send({ status: "resolved" }).expect(200);
      const outsider = await asRole("agent");
      expect((await outsider.post(`/api/tasks/${resolved}/add-to-learning`)).status).toBe(403);
      expect(await db.select().from(learningQueue)).toHaveLength(0);
    });

    it("the queue status routes show pending items to an admin only", async () => {
      const admin = await adminAgent();
      const ids: number[] = [];
      for (let i = 0; i < 2; i++) {
        const id = (await createTicketAs(admin)).body.id as number;
        await admin.patch(`/api/tasks/${id}`).send({ status: "resolved" }).expect(200);
        await admin.post(`/api/tasks/${id}/add-to-learning`).expect(200);
        ids.push(id);
      }
      // One item already done today, so completedToday is exercised too.
      await db.update(learningQueue).set({ processStatus: "completed", processedAt: new Date() }).where(eq(learningQueue.ticketId, ids[0]));

      const status = await admin.get("/api/admin/learning-queue/status");
      expect(status.status).toBe(200);
      const byStatus = Object.fromEntries(status.body.map((r: any) => [r.status, Number(r.count)]));
      expect(byStatus).toEqual({ pending: 1, completed: 1 });

      const summary = await admin.get("/api/admin/learning-queue");
      expect(summary.status).toBe(200);
      expect(summary.body).toMatchObject({ pending: 1, processing: 0, completedToday: 1, isProcessing: false, totalInQueue: 1 });

      for (const role of ["agent", "manager", "customer"] as const) {
        const a = await asRole(role);
        expect([role, (await a.get("/api/admin/learning-queue/status")).status]).toEqual([role, 403]);
        expect([role, (await a.get("/api/admin/learning-queue")).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).get("/api/admin/learning-queue/status")).status).toBe(401);
    });
  });
});
