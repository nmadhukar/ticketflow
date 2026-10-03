import request from "supertest";
import { eq } from "drizzle-orm";
import {
  aiUsage,
  knowledgeArticles,
  taskComments,
  tasks,
  teamMembers,
  ticketAutoResponses,
  users,
} from "@shared/schema";
import { bedrockMock, MOCK_MODEL_ID } from "../mocks/aws-bedrock.mock";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { AI_SYSTEM_USER_EMAIL, AI_SYSTEM_USER_ID, AI_SYSTEM_USERNAME, ensureAiSystemUser } from "../../utils/aiSystemUser";
import { isTicketForeignKeyViolation, recordUsage } from "../../services/ai/costMonitoring";
import { aiAutoResponseService } from "../../services/ai/aiAutoResponse";
import * as realtime from "../../realtime/ws";

const KEY_ID = "AKIAFAKEFAKEFAKE"; // the 16-character key id configured below
const SECRET = "fake-secret-for-tests";

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

  async function setSettings(settings: {
    enabled?: boolean;
    threshold?: string;
    maxResponseLength?: number;
    maxTokensPerRequest?: number;
  }) {
    const admin = await createUser({ role: "admin" });
    await storage.updateBedrockSettings(
      {
        bedrockAccessKeyId: KEY_ID,
        bedrockSecretAccessKey: SECRET,
        bedrockRegion: "us-east-1",
        bedrockModelId: MOCK_MODEL_ID,
        autoResponseEnabled: settings.enabled ?? true,
        confidenceThreshold: settings.threshold ?? "0.7",
        maxResponseLength: settings.maxResponseLength ?? 1000,
        maxTokensPerRequest: settings.maxTokensPerRequest ?? 3000,
      } as any,
      admin.id
    );
    return admin;
  }

  /** One published article the title "Printerjam" matches: the real calculateConfidence then scores support/low-complexity tickets about 0.8. */
  async function seedMatchingArticle() {
    await db.insert(knowledgeArticles).values({
      title: "Printerjam fix",
      content: "How to clear a printerjam",
      isPublished: true,
      status: "published",
    });
  }

  const commentsOf = (taskId: number) =>
    db.select().from(taskComments).where(eq(taskComments.taskId, taskId));
  const rowsOf = (ticketId: number) =>
    db.select().from(ticketAutoResponses).where(eq(ticketAutoResponses.ticketId, ticketId));
  const logged = () => JSON.stringify(errorSpy.mock.calls.map((c: unknown[]) => c.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))));

  async function customerTicket(opts: Record<string, unknown> = {}) {
    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken", ...opts });
    expect(res.status).toBe(201);
    return { customer, customerA, id: res.body.id as number };
  }

  describe("auto-response at ticket creation", () => {
    it("AI disabled in settings: no Bedrock call at all, ticket still created", async () => {
      await setSettings({ enabled: false });
      await seedMatchingArticle();
      const { id } = await customerTicket();
      expect(bedrockMock.totalCalls()).toBe(0);
      expect(await commentsOf(id)).toHaveLength(0);
    });

    it("the setting is read at create time: an admin toggle applies to the next ticket", async () => {
      await seedMatchingArticle();
      await setSettings({ enabled: false });
      const off = await customerTicket();
      expect(await commentsOf(off.id)).toHaveLength(0);
      await setSettings({ enabled: true });
      const on = await customerTicket();
      expect(await commentsOf(on.id)).toHaveLength(1);
    });

    it("threshold 0.9 and a real confidence of about 0.8: no comment, exactly one row, not applied", async () => {
      await setSettings({ threshold: "0.90" });
      await seedMatchingArticle();
      const { id } = await customerTicket();
      expect(bedrockMock.totalCalls()).toBeGreaterThan(0);
      expect(await commentsOf(id)).toHaveLength(0);
      const rows = await rowsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].wasApplied).toBe(false);
      expect(Number(rows[0].confidenceScore)).toBeGreaterThan(0.75);
      expect(Number(rows[0].confidenceScore)).toBeLessThan(0.9);
    });

    it("threshold 0.7: one comment by the AI system user (not the customer) and one row applied, in agreement", async () => {
      await setSettings({ threshold: "0.70" });
      await seedMatchingArticle();
      const { id, customer, customerA } = await customerTicket();
      const comments = await commentsOf(id);
      expect(comments).toHaveLength(1);
      expect(comments[0].userId).toBe(AI_SYSTEM_USER_ID);
      expect(comments[0].userId).not.toBe(customer.id);

      const rows = await rowsOf(id);
      expect(rows).toHaveLength(1); // one analysis, one row (R22)
      expect(rows[0].wasApplied).toBe(true);
      expect(rows[0].respondedBy).toBe(AI_SYSTEM_USER_ID);

      const listed = await customerA.get(`/api/tasks/${id}/comments`);
      expect(listed.status).toBe(200);
      expect(listed.body[0].user.firstName).toBe("AI");
      expect(listed.body[0].user.lastName).toBe("Assistant");
      expect(listed.body[0].user.password).toBeUndefined();
    });

    it("the posted comment is cut to maxResponseLength", async () => {
      await setSettings({ maxResponseLength: 100 });
      await seedMatchingArticle();
      const base = bedrockMock.handler;
      bedrockMock.handler = (p) =>
        p.includes("helpful IT support assistant")
          ? JSON.stringify({ response: "x".repeat(400), confidence: 0.9, knowledgeBaseArticles: [] })
          : base(p);
      const { id } = await customerTicket();
      const [c] = await commentsOf(id);
      expect(c.content.split("): ")[1]).toHaveLength(100);
    });

    it("Bedrock throwing: ticket still 201, only the error type, status and ticket id are logged", async () => {
      await setSettings({});
      await seedMatchingArticle();
      const err: any = new Error(`PROMPT-TEXT-SECRET ${KEY_ID} ${SECRET}`);
      err.name = "ThrottlingException";
      err.$metadata = { httpStatusCode: 429 };
      bedrockMock.handler = () => err;
      const { id } = await customerTicket();
      expect(id).toBeGreaterThan(0);
      expect(errorSpy).toHaveBeenCalled();
      const out = logged();
      expect(out).toContain("ThrottlingException");
      expect(out).toContain("status=429");
      expect(out).not.toContain("PROMPT-TEXT-SECRET");
      expect(out).not.toContain(KEY_ID);
      expect(out).not.toContain(SECRET);
    });

    it("a cost-limit block does not fail the create either", async () => {
      await setSettings({ maxTokensPerRequest: 1 });
      await seedMatchingArticle();
      await customerTicket();
    });

    it("a failed comment write is logged with the ticket id and leaves the single row NOT applied", async () => {
      await setSettings({});
      await seedMatchingArticle();
      jest.spyOn(storage, "addTaskComment").mockRejectedValue(new Error("db down"));
      const { id } = await customerTicket();
      expect(logged()).toContain(`ticket ${id}`);
      expect(await commentsOf(id)).toHaveLength(0);
      const rows = await rowsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].wasApplied).toBe(false);
    });

    it("never logs model output, whatever the model says: an unparseable reply with a marker leaves no trace", async () => {
      await setSettings({});
      await seedMatchingArticle();
      const MARK = "MARKER_ZZ9_MODEL_OUTPUT";
      const spies = (["error", "warn", "log", "info", "debug"] as const).map((m) =>
        jest.spyOn(console, m).mockImplementation(() => undefined)
      );
      // 1) valid-looking JSON start that does not parse (a SyntaxError message quotes the text)
      // 2) plain text with no JSON at all
      for (const bad of [`{"response": ${MARK} broken`, `${MARK} plain words, no json`, `[${MARK}`]) {
        bedrockMock.handler = () => bad;
        const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
        const { id } = await customerTicket();
        await adminA.post("/api/ai/analyze-ticket").send({ ticketId: id });
        await adminA.post("/api/ai/generate-response").send({ ticketId: id });
        await adminA.post(`/api/tasks/${id}/auto-response/generate`);
      }
      const everything = JSON.stringify(spies.flatMap((s) => s.mock.calls.map((c) => c.map((a) => (typeof a === "string" ? a : JSON.stringify(a))))));
      expect(spies[0].mock.calls.length).toBeGreaterThan(0); // something was logged, so the check bites
      expect(everything).not.toContain(MARK);
    });
  });

  describe("POST /api/ai/analyze-ticket and /api/ai/generate-response take a ticketId", () => {
    const calls: Array<[string, (a: ReturnType<typeof request.agent>, body: unknown) => request.Test]> = [
      ["analyze-ticket", (a, b) => a.post("/api/ai/analyze-ticket").send(b as object)],
      ["generate-response", (a, b) => a.post("/api/ai/generate-response").send(b as object)],
    ];

    describe.each(calls)("%s", (_name, call) => {
      it("rejects free text, a missing, huge, boolean, array, float or exponent id with 400", async () => {
        await setSettings({});
        const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
        const res = await call(adminA, { title: "t", description: "d", analysis: {} });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("validation_failed");
        expect(res.body.details.fieldErrors.ticketId).toBeDefined();
        for (const ticketId of ["abc", 9999999999, "9999999999", true, [1], 1.5, "1e3", -4, 0, null, "0x10"]) {
          const bad = await call(adminA, { ticketId });
          expect([JSON.stringify(ticketId), bad.status]).toEqual([JSON.stringify(ticketId), 400]);
        }
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
        expect(bedrockMock.seen()).toContain("Stored title Alpha");
        expect(bedrockMock.seen()).not.toContain("CLIENT-SENT-EVIL");
      });

      it("a cost-limit block is 429 quota_exceeded in the error contract", async () => {
        await setSettings({});
        const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
        const { id } = await customerTicket();
        await setSettings({ maxTokensPerRequest: 1 });
        bedrockMock.reset();
        const res = await call(adminA, { ticketId: id });
        expect(res.status).toBe(429);
        expect(res.body.error).toBe("quota_exceeded");
        expect(typeof res.body.message).toBe("string");
        expect(res.body.details.isBlocked).toBe(true);
        expect(typeof res.body.details.reason).toBe("string");
        expect(res.body.reason).toBeUndefined();
      });
    });

    it("an agent who can see the ticket may use them", async () => {
      await setSettings({});
      const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
      const created = await createTicketAs(agentA);
      bedrockMock.reset();
      expect((await agentA.post("/api/ai/analyze-ticket").send({ ticketId: created.body.id })).status).toBe(200);
      expect((await agentA.post("/api/ai/analyze-ticket").send({ ticketId: String(created.body.id) })).status).toBe(200);
    });

    it("analyze-ticket is read-only: it stores no auto-response row", async () => {
      await setSettings({});
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const { id } = await customerTicket();
      const before = (await rowsOf(id)).length;
      await adminA.post("/api/ai/analyze-ticket").send({ ticketId: id });
      expect(await rowsOf(id)).toHaveLength(before);
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

    it("stores exactly one NOT-applied draft and posts no comment (no phantom applied row)", async () => {
      await setSettings({ threshold: "0.70" });
      await seedMatchingArticle();
      await setSettings({ enabled: false }); // nothing at create time
      const { id } = await customerTicket();
      await setSettings({ enabled: true, threshold: "0.70" });
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const res = await adminA.post(`/api/tasks/${id}/auto-response/generate`);
      expect(res.status).toBe(200);
      const rows = await rowsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].wasApplied).toBe(false);
      expect(await commentsOf(id)).toHaveLength(0);
    });

    it("a cost-limit block is 429 quota_exceeded", async () => {
      await setSettings({});
      const { id } = await customerTicket();
      await setSettings({ maxTokensPerRequest: 1 });
      bedrockMock.reset();
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const res = await adminA.post(`/api/tasks/${id}/auto-response/generate`);
      expect(res.status).toBe(429);
      expect(res.body.error).toBe("quota_exceeded");
    });

    it("no generated text is 503 ai_unavailable in the error contract", async () => {
      await setSettings({});
      const { id } = await customerTicket();
      jest.spyOn(aiAutoResponseService, "analyzeTicket").mockResolvedValue({
        autoResponse: null,
        confidence: 0,
        complexity: 50,
        factors: { keywords: 0, urgency: 0, technical: 0, historical: 0, sentiment: 0 },
        shouldEscalate: true,
        shouldAutoRespond: false,
      });
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const res = await adminA.post(`/api/tasks/${id}/auto-response/generate`);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("ai_unavailable");
      expect(typeof res.body.message).toBe("string");
    });
  });

  describe("GET and apply: customers never see unapplied drafts", () => {
    async function ticketWithDraft() {
      await setSettings({ enabled: false });
      const t = await customerTicket();
      await setSettings({ enabled: true });
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      expect((await adminA.post(`/api/tasks/${t.id}/auto-response/generate`)).status).toBe(200);
      return { ...t, adminA };
    }

    it("GET: customer 404 on an unapplied draft, staff 200; after apply the customer sees it", async () => {
      const { id, customerA, adminA } = await ticketWithDraft();
      const denied = await customerA.get(`/api/tasks/${id}/auto-response`);
      expect(denied.status).toBe(404);
      expect(denied.body.error).toBe("not_found");
      const staff = await adminA.get(`/api/tasks/${id}/auto-response`);
      expect(staff.status).toBe(200);
      expect(staff.body.wasApplied).toBe(false);

      expect((await adminA.post(`/api/tasks/${id}/auto-response/apply`)).status).toBe(200);
      const seen = await customerA.get(`/api/tasks/${id}/auto-response`);
      expect(seen.status).toBe(200);
      expect(seen.body.wasApplied).toBe(true);
    });

    it("GET: a customer gets 404 when there is no row at all", async () => {
      await setSettings({ enabled: false });
      const { id, customerA } = await customerTicket();
      expect((await customerA.get(`/api/tasks/${id}/auto-response`)).status).toBe(404);
    });

    it("apply posts the stored draft as the AI user, marks the row applied, and is idempotent", async () => {
      const { id, adminA } = await ticketWithDraft();
      const [draft] = await rowsOf(id);
      const notify = jest.spyOn(realtime, "notifyTicket");
      const first = await adminA.post(`/api/tasks/${id}/auto-response/apply`);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ applied: true, alreadyApplied: false });
      // M1: the same realtime event a REST comment sends.
      expect(notify).toHaveBeenCalledWith(id, "comment");
      notify.mockClear();
      const comments = await commentsOf(id);
      expect(comments).toHaveLength(1);
      expect(comments[0].userId).toBe(AI_SYSTEM_USER_ID);
      expect(comments[0].content).toContain(draft.aiResponse);
      expect((await rowsOf(id))[0].wasApplied).toBe(true);

      const second = await adminA.post(`/api/tasks/${id}/auto-response/apply`);
      expect(second.status).toBe(200);
      expect(second.body.alreadyApplied).toBe(true);
      expect(await commentsOf(id)).toHaveLength(1);
      // No comment, no event.
      expect(notify).not.toHaveBeenCalled();
      notify.mockRestore();
    });

    it("two simultaneous applies post one comment", async () => {
      const { id, adminA } = await ticketWithDraft();
      await Promise.all([
        adminA.post(`/api/tasks/${id}/auto-response/apply`),
        adminA.post(`/api/tasks/${id}/auto-response/apply`),
      ]);
      expect(await commentsOf(id)).toHaveLength(1);
    });

    it("apply: 404 with no draft or no ticket, 403 for a customer and for an agent outside the ticket's scope", async () => {
      await setSettings({ enabled: false });
      const { id, customerA } = await customerTicket();
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
      expect((await adminA.post(`/api/tasks/${id}/auto-response/apply`)).status).toBe(404);
      expect((await adminA.post(`/api/tasks/999999/auto-response/apply`)).status).toBe(404);
      expect((await customerA.post(`/api/tasks/${id}/auto-response/apply`)).status).toBe(403);
      expect((await agentA.post(`/api/tasks/${id}/auto-response/apply`)).status).toBe(403);
      expect(await commentsOf(id)).toHaveLength(0);
    });

    it("a failed comment write on apply leaves the draft unapplied (so it can be retried)", async () => {
      const { id, adminA } = await ticketWithDraft();
      const spy = jest.spyOn(storage, "addTaskComment").mockRejectedValueOnce(new Error("db down"));
      const res = await adminA.post(`/api/tasks/${id}/auto-response/apply`);
      expect(res.status).toBe(500);
      spy.mockRestore();
      expect((await rowsOf(id))[0].wasApplied).toBe(false);
      expect((await adminA.post(`/api/tasks/${id}/auto-response/apply`)).status).toBe(200);
      expect(await commentsOf(id)).toHaveLength(1);
    });
  });

  describe("GET /api/ai/knowledge-search", () => {
    const search = (a: ReturnType<typeof request.agent>, qs: string) => a.get(`/api/ai/knowledge-search${qs}`);

    it("customer 403 (only the staff analytics page calls it), staff 200", async () => {
      await setSettings({});
      await seedMatchingArticle();
      const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
      const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
      const denied = await search(customerA, "?query=printer");
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("forbidden");
      expect(bedrockMock.totalCalls()).toBe(0);
      expect((await search(agentA, "?query=printer")).status).toBe(200);
    });

    it("validates the query: required, non-empty, at most 500 characters, a single value", async () => {
      await setSettings({});
      const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
      for (const qs of ["", "?query=", "?query=%20%20", `?query=${"a".repeat(501)}`, "?query=a&query=b", "?query=a&maxResults=0", "?query=a&maxResults=999"]) {
        const res = await search(agentA, qs);
        expect([qs.slice(0, 40), res.status, res.body.error]).toEqual([qs.slice(0, 40), 400, "validation_failed"]);
      }
      expect((await search(agentA, `?query=${"a".repeat(500)}`)).status).toBe(200);
      expect(bedrockMock.totalCalls()).toBe(0); // the 400s never reached the model
    });

    it("a cost-limit block is 429 quota_exceeded, and only the error type is logged", async () => {
      await setSettings({ maxTokensPerRequest: 1 });
      await seedMatchingArticle();
      const agentA = await loginAs(ctx.app, await createUser({ role: "agent" }));
      const res = await search(agentA, "?query=printer");
      expect(res.status).toBe(429);
      expect(res.body.error).toBe("quota_exceeded");
      expect(logged()).not.toContain("Request exceeds max tokens");
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
      await seedMatchingArticle();
      const { id } = await customerTicket();
      const comments = await commentsOf(id);
      expect(comments[0]?.userId).toBe(AI_SYSTEM_USER_ID);
    });

    it("when ANOTHER account holds its email: startup does not stop, one loud log line without the email, AI authorship is off", async () => {
      await db.delete(users).where(eq(users.id, AI_SYSTEM_USER_ID));
      await db.insert(users).values({ id: "squatter-1", email: AI_SYSTEM_USER_EMAIL.toUpperCase(), role: "customer", isActive: true, isApproved: true });
      errorSpy.mockClear();
      await expect(ensureAiSystemUser()).resolves.toBeNull();
      const lines = errorSpy.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("squatter-1");
      expect(lines[0].toLowerCase()).not.toContain(AI_SYSTEM_USER_EMAIL);
      expect(await db.select().from(users).where(eq(users.id, AI_SYSTEM_USER_ID))).toHaveLength(0);

      // A new ticket is still created; the AI posts nothing (never as the customer or the squatter).
      await setSettings({});
      await seedMatchingArticle();
      const { id, customer } = await customerTicket();
      const comments = await commentsOf(id);
      expect(comments).toHaveLength(0);
      expect(comments.some((c) => c.userId === customer.id)).toBe(false);
      const rows = await rowsOf(id);
      expect(rows.every((r) => r.wasApplied === false)).toBe(true);
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

    it("is absent from /api/users, the team-member picker, admin listing, team members, counts and ticket meta pickers", async () => {
      const admin = await createUser({ role: "admin" });
      const agent = await createUser({ role: "agent" });
      const adminA = await loginAs(ctx.app, admin);
      const ids = (body: any[]) => body.map((u) => u.id);

      const all = await adminA.get("/api/users");
      expect(all.status).toBe(200);
      expect(ids(all.body)).toContain(agent.id);
      expect(ids(all.body)).not.toContain(AI_SYSTEM_USER_ID);
      const picker = await adminA.get("/api/users?forTeamMemberSelection=true");
      expect(picker.status).toBe(200);
      expect(ids(picker.body)).toContain(agent.id);
      expect(ids(picker.body)).not.toContain(AI_SYSTEM_USER_ID);
      const adminList = await adminA.get("/api/admin/users");
      expect(adminList.status).toBe(200);
      expect(ids(adminList.body)).not.toContain(AI_SYSTEM_USER_ID);

      const team = await createTeam(admin);
      await db.insert(teamMembers).values({ teamId: team.id, userId: AI_SYSTEM_USER_ID });
      const members = await adminA.get(`/api/teams/${team.id}/members`);
      expect(members.status).toBe(200);
      expect(JSON.stringify(members.body)).not.toContain(AI_SYSTEM_USER_ID);

      const stats = await storage.getAdminStats();
      expect(stats.totalUsers).toBe(2);

      const created = await createTicketAs(adminA);
      const meta = await adminA.get(`/api/tickets/${created.body.id}/meta`);
      expect(meta.status).toBe(200);
      const assignable = ids(meta.body.assignableUsers);
      expect(assignable).toContain(agent.id);
      expect(assignable).not.toContain(AI_SYSTEM_USER_ID);
    });

    it("cannot be named as a ticket assignee or added to a team", async () => {
      const admin = await createUser({ role: "admin" });
      const adminA = await loginAs(ctx.app, admin);
      const res = await createTicketAs(adminA, { assigneeId: AI_SYSTEM_USER_ID });
      expect(res.status).toBe(400);
      await expect(storage.addTeamMember({ teamId: (await createTeam(admin)).id, userId: AI_SYSTEM_USER_ID } as any)).rejects.toMatchObject({ status: 404 });
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

    it("a foreign-key violation on user_id is NOT retried without a ticket: the row is not stored", async () => {
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const t = await createTicketAs(adminA);
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      await recordUsage("mock-model", 10, 20, "analyzeTicket", "no-such-user-id", String(t.body.id));
      expect(await db.select().from(aiUsage)).toHaveLength(0);
      expect(logged()).toContain("Error recording usage");
    });

    it("isTicketForeignKeyViolation looks at the violated constraint, bare or wrapped", () => {
      const ticketFk = { code: "23503", constraint: "ai_usage_ticket_id_tasks_id_fk" };
      const userFk = { code: "23503", constraint: "ai_usage_user_id_users_id_fk" };
      expect(isTicketForeignKeyViolation(ticketFk)).toBe(true);
      expect(isTicketForeignKeyViolation({ cause: ticketFk })).toBe(true);
      expect(isTicketForeignKeyViolation(userFk)).toBe(false);
      expect(isTicketForeignKeyViolation({ cause: userFk })).toBe(false);
      expect(isTicketForeignKeyViolation({ code: "23505", constraint: "ticket_id" })).toBe(false);
    });
  });

  describe("rows stay unapplied until the comment exists; text is clamped once", () => {
    it("at the moment the create-time comment is written the row is still NOT applied, and it is applied right after", async () => {
      await setSettings({});
      await seedMatchingArticle();
      let seenDuringComment: boolean | undefined;
      const real = storage.addTaskComment.bind(storage);
      jest.spyOn(storage, "addTaskComment").mockImplementation(async (c: any) => {
        const rows = await rowsOf(c.taskId);
        seenDuringComment = rows[0]?.wasApplied ?? undefined;
        return real(c);
      });
      const { id } = await customerTicket();
      expect(seenDuringComment).toBe(false);
      expect((await rowsOf(id))[0].wasApplied).toBe(true);
    });

    it("the stored row, the create-time comment and an applied draft are all cut to maxResponseLength", async () => {
      await setSettings({ maxResponseLength: 100 });
      await seedMatchingArticle();
      const base = bedrockMock.handler;
      bedrockMock.handler = (p) =>
        p.includes("helpful IT support assistant")
          ? JSON.stringify({ response: "y".repeat(400), confidence: 0.9, knowledgeBaseArticles: [] })
          : base(p);
      const { id } = await customerTicket();
      expect((await rowsOf(id))[0].aiResponse).toHaveLength(100);

      await setSettings({ enabled: false, maxResponseLength: 100 });
      const t2 = await customerTicket();
      await setSettings({ enabled: true, maxResponseLength: 100 });
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      await adminA.post(`/api/tasks/${t2.id}/auto-response/generate`);
      expect((await rowsOf(t2.id))[0].aiResponse).toHaveLength(100);
      await adminA.post(`/api/tasks/${t2.id}/auto-response/apply`);
      const [c] = await commentsOf(t2.id);
      expect(c.content.split("): ")[1]).toHaveLength(100);
    });

    it("if releasing the claim fails too, both failures are logged and the ORIGINAL error is what the client gets", async () => {
      await setSettings({ enabled: false });
      const { id } = await customerTicket();
      await setSettings({ enabled: true });
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      await adminA.post(`/api/tasks/${id}/auto-response/generate`);
      const commentErr: any = new Error("COMMENT-FAIL-DETAIL");
      commentErr.name = "CommentWriteError";
      jest.spyOn(storage, "addTaskComment").mockRejectedValue(commentErr);
      const realUpdate = db.update.bind(db);
      let updates = 0;
      jest.spyOn(db, "update").mockImplementation(((...a: any[]) => {
        updates++;
        if (updates === 2) throw Object.assign(new Error("ROLLBACK-FAIL-DETAIL"), { name: "RollbackError" });
        return (realUpdate as any)(...a);
      }) as any);
      const res = await adminA.post(`/api/tasks/${id}/auto-response/apply`);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");
      const out = logged();
      expect(out).toContain("CommentWriteError");
      expect(out).toContain("RollbackError");
      expect(out).not.toContain("COMMENT-FAIL-DETAIL");
      expect(out).not.toContain("ROLLBACK-FAIL-DETAIL");
    });

    it("a customer keeps seeing the applied create-time row after staff generate a newer draft", async () => {
      await setSettings({});
      await seedMatchingArticle();
      const { id, customerA } = await customerTicket();
      const applied = (await rowsOf(id))[0];
      expect(applied.wasApplied).toBe(true);
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      expect((await adminA.post(`/api/tasks/${id}/auto-response/generate`)).status).toBe(200);
      expect(await rowsOf(id)).toHaveLength(2);

      const seen = await customerA.get(`/api/tasks/${id}/auto-response`);
      expect(seen.status).toBe(200);
      expect(seen.body.id).toBe(applied.id);
      expect(seen.body.wasApplied).toBe(true);
      const staff = await adminA.get(`/api/tasks/${id}/auto-response`);
      expect(staff.body.wasApplied).toBe(false); // staff see the newest row, the draft
      expect(staff.body.id).not.toBe(applied.id);
    });
  });

  describe("no model-derived text in any log (knowledge learning, article improvement, chat)", () => {
    it("titles, reasons, problem types and error messages from the model leave no trace", async () => {
      await setSettings({ enabled: false });
      const MARK = "MARKER_ZZ9_DERIVED";
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      for (let i = 0; i < 5; i++) {
        const t = await createTicketAs(adminA, { title: `Login problem ${i}`, description: "cannot sign in" });
        await db.update(tasks).set({ status: "resolved", resolvedAt: new Date() }).where(eq(tasks.id, t.body.id));
      }
      const spies = (["error", "warn", "log", "info", "debug"] as const).map((m) =>
        jest.spyOn(console, m).mockImplementation(() => undefined)
      );
      bedrockMock.handler = (p) => {
        if (p.includes("expert knowledge management AI"))
          return JSON.stringify([
            {
              problemType: `login ${MARK}`,
              commonSolutions: [`reset ${MARK}`],
              preventiveMeasures: [MARK],
              averageResolutionTime: 2,
              frequency: 5,
              successRate: 95,
            },
          ]);
        if (p.includes("technical writer creating a knowledge base article"))
          return JSON.stringify({
            title: `Title ${MARK}`,
            content: `Body ${MARK}`,
            category: `cat-${MARK}`,
            tags: [MARK],
            difficulty: "beginner",
            estimatedReadTime: 2,
            confidence: 90,
          });
        if (p.includes("improving a knowledge base article"))
          return JSON.stringify({
            shouldUpdate: true,
            confidence: 95,
            improvedContent: `Better ${MARK}`,
            improvementReason: `Because ${MARK}`,
          });
        return new Error(`${MARK} upstream said no`);
      };
      const { processKnowledgeLearning, improveKnowledgeArticle } = await import("../../services/ai/knowledgeBaseLearning");
      const result = await processKnowledgeLearning();
      expect(result.articlesCreated).toBeGreaterThan(0); // the "created" log path really ran
      const [article] = await db.select().from(knowledgeArticles);
      expect(article.createdBy).toBe(AI_SYSTEM_USER_ID);
      expect(await improveKnowledgeArticle(article.id, { ticketId: 1, resolution: "r", resolutionTime: 1, success: true })).toBe(true);

      await processKnowledgeLearning(); // second pass: the "similar article exists" log path

      // chat: the model errors with a message carrying the marker
      const chat = await adminA.post("/api/chat").send({ sessionId: "s-marker", message: "how do I reset my password?" });
      expect([200, 500]).toContain(chat.status);
      expect(bedrockMock.prompts.length).toBeGreaterThan(0);

      const everything = JSON.stringify(
        spies.flatMap((s) => s.mock.calls.map((c: unknown[]) => c.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))))
      );
      expect(spies[0].mock.calls.length + spies[2].mock.calls.length).toBeGreaterThan(0);
      expect(everything).not.toContain(MARK);
    });
  });

  describe("AI analytics count only what happened", () => {
    /** Four tickets: A applied then resolved, B two applied rows and still open, C draft only, D draft+applied then closed. */
    async function seedMix() {
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const mk = async () => (await createTicketAs(adminA)).body.id as number;
      const [a, b, c, d] = [await mk(), await mk(), await mk(), await mk()];
      const row = (ticketId: number, wasApplied: boolean, createdAt: Date, wasHelpful: boolean | null = null) =>
        db.insert(ticketAutoResponses).values({ ticketId, aiResponse: "r", confidenceScore: "0.8", wasApplied, wasHelpful, createdAt });
      const t0 = new Date(Date.now() - 3 * 3600_000);
      await row(a, true, t0, true);
      await row(b, true, t0, false);
      await row(b, true, t0);
      await row(c, false, t0);
      await row(d, false, t0);
      await row(d, true, t0);
      const later = new Date(Date.now() - 3600_000);
      await db.update(tasks).set({ status: "resolved", resolvedAt: later }).where(eq(tasks.id, a));
      await db.update(tasks).set({ status: "closed", closedAt: later }).where(eq(tasks.id, d));
      return adminA;
    }

    it("ai-performance: total counts every row, applied and helpful only the true ones", async () => {
      const adminA = await seedMix();
      const res = await adminA.get("/api/analytics/ai-performance");
      expect(res.status).toBe(200);
      expect(Number(res.body.autoResponse.total)).toBe(6);
      expect(Number(res.body.autoResponse.applied)).toBe(4);
      expect(Number(res.body.autoResponse.helpful)).toBe(1);
    });

    it("ai-analytics: autoResponsesSent counts applied rows; ticketsResolvedByAI counts DISTINCT resolved/closed tickets whose applied response came first", async () => {
      const adminA = await seedMix();
      const res = await adminA.get("/api/admin/ai-analytics");
      expect(res.status).toBe(200);
      expect(res.body.autoResponsesSent).toBe(4); // not 6: drafts were never sent
      expect(res.body.ticketsResolvedByAI).toBe(2); // A and D; B is open, C had only a draft
    });

    it("an applied response posted AFTER the ticket was resolved does not count as resolving it", async () => {
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const id = (await createTicketAs(adminA)).body.id as number;
      await db.update(tasks).set({ status: "resolved", resolvedAt: new Date(Date.now() - 7200_000) }).where(eq(tasks.id, id));
      await db.insert(ticketAutoResponses).values({ ticketId: id, aiResponse: "r", confidenceScore: "0.8", wasApplied: true, createdAt: new Date() });
      const res = await adminA.get("/api/admin/ai-analytics");
      expect(res.body.autoResponsesSent).toBe(1);
      expect(res.body.ticketsResolvedByAI).toBe(0);
    });
  });
});
