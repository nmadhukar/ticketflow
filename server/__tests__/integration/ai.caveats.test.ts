import request from "supertest";
import { eq } from "drizzle-orm";
import { aiUsage, knowledgeArticles, tasks, ticketComplexityScores } from "@shared/schema";
import { bedrockMock, MOCK_MODEL_ID } from "../mocks/aws-bedrock.mock";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { AI_SYSTEM_USER_ID, ensureAiSystemUser } from "../../utils/aiSystemUser";

/**
 * Requirement caveats that need Bedrock faked at the SDK boundary:
 * I1 the saved complexity score, I7 usage reporting, I9 processing the learning queue.
 */
describe("AI caveats (I1, I7, I9)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
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
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function configureBedrock() {
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
      } as any,
      admin.id
    );
    return admin;
  }

  describe("I1: creating a ticket stores the complexity score the model reported", () => {
    it("one ticket_complexity_scores row, with the faked score, the computed factors and a note", async () => {
      await configureBedrock();
      bedrockMock.reset({ complexityScore: 37 });
      const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
      const created = await createTicketAs(customerA, { title: "Printer is jammed", description: "Paper stuck in tray two" });
      expect(created.status).toBe(201);

      const rows = await db.select().from(ticketComplexityScores).where(eq(ticketComplexityScores.ticketId, created.body.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].complexityScore).toBe(37);
      expect(Object.keys(rows[0].factors as object).sort()).toEqual(["historical", "keywords", "sentiment", "technical", "urgency"]);
      expect(rows[0].aiAnalysis).toMatch(/^Complexity: 37\/100\. Should escalate: (true|false)$/);
      expect(rows[0].calculatedAt).toBeTruthy();
    });

    it("a different model answer is a different stored score, and with auto-response off nothing is stored", async () => {
      const admin = await configureBedrock();
      bedrockMock.reset({ complexityScore: 81 });
      const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
      const first = await createTicketAs(customerA);
      const [row] = await db.select().from(ticketComplexityScores).where(eq(ticketComplexityScores.ticketId, first.body.id));
      expect(row.complexityScore).toBe(81);

      await storage.updateBedrockSettings({ autoResponseEnabled: false } as any, admin.id);
      const second = await createTicketAs(customerA);
      expect(second.status).toBe(201);
      expect(await db.select().from(ticketComplexityScores).where(eq(ticketComplexityScores.ticketId, second.body.id))).toHaveLength(0);
    });
  });

  describe("I7: usage reporting (the routes that exist: /api/bedrock/usage and /api/bedrock/cost-statistics)", () => {
    async function seedUsage() {
      const alice = await createUser({ role: "agent" });
      const bob = await createUser({ role: "agent" });
      const row = (userId: string, inputTokens: number, outputTokens: number, estimatedCost: string, operation: string) =>
        db.insert(aiUsage).values({ modelId: MOCK_MODEL_ID, inputTokens, outputTokens, estimatedCost, operation, userId });
      await row(alice.id, 100, 50, "0.010000", "chat");
      await row(alice.id, 200, 100, "0.020000", "chat");
      await row(bob.id, 400, 300, "0.040000", "ticket_analysis");
      return { alice, bob };
    }

    it("/api/bedrock/cost-statistics is admin only and sums every recorded row", async () => {
      await seedUsage();
      const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const res = await admin.get("/api/bedrock/cost-statistics");
      expect(res.status).toBe(200);
      expect(res.body.dailyUsage.requestCount).toBe(3);
      expect(res.body.dailyUsage.totalInputTokens).toBe(700);
      expect(res.body.dailyUsage.totalOutputTokens).toBe(450);
      expect(res.body.dailyUsage.totalCost).toBeCloseTo(0.07, 6);
      expect(res.body.dailyUsage.operations).toEqual({ chat: 2, ticket_analysis: 1 });
      expect(res.body.monthlyUsage.requestCount).toBe(3);
      expect(res.body.recentUsage).toHaveLength(3);
      expect(res.body.limits).toEqual(expect.objectContaining({ dailyLimitUSD: expect.any(Number) }));

      for (const role of ["agent", "manager", "customer"] as const) {
        const a = await loginAs(ctx.app, await createUser({ role }));
        expect([role, (await a.get("/api/bedrock/cost-statistics")).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).get("/api/bedrock/cost-statistics")).status).toBe(401);
    });

    it("/api/bedrock/usage lists the caller's own rows with their totals; only an admin may name another user", async () => {
      const { alice, bob } = await seedUsage();
      const aliceA = await loginAs(ctx.app, alice);
      const own = await aliceA.get("/api/bedrock/usage");
      expect(own.status).toBe(200);
      expect(own.body).toHaveLength(2);
      expect(own.body.map((r: any) => r.userId)).toEqual([alice.id, alice.id]);
      expect(own.body.reduce((n: number, r: any) => n + r.totalTokens, 0)).toBe(450);
      expect(own.body.reduce((n: number, r: any) => n + r.cost, 0)).toBeCloseTo(0.03, 6);

      // Naming someone else changes nothing for a non-admin.
      const nosy = await aliceA.get("/api/bedrock/usage").query({ userId: bob.id });
      expect(nosy.body).toHaveLength(2);
      expect(nosy.body.every((r: any) => r.userId === alice.id)).toBe(true);

      const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const bobs = await admin.get("/api/bedrock/usage").query({ userId: bob.id });
      expect(bobs.body).toHaveLength(1);
      expect(bobs.body[0]).toMatchObject({ userId: bob.id, inputTokens: 400, outputTokens: 300, totalTokens: 700 });
      expect((await request(ctx.app).get("/api/bedrock/usage")).status).toBe(401);
    });
  });

  describe("I9: POST /api/admin/learning-queue/process", () => {
    const MARK_PATTERNS = JSON.stringify([
      {
        problemType: "Login problems",
        commonSolutions: ["Reset the password from the sign-in page"],
        preventiveMeasures: ["Use a password manager"],
        averageResolutionTime: 2,
        frequency: 5,
        successRate: 95,
      },
    ]);
    const ARTICLE = JSON.stringify({
      title: "Fixing login problems",
      content: "Reset the password from the sign-in page.",
      category: "support",
      tags: ["login"],
      difficulty: "beginner",
      estimatedReadTime: 2,
      confidence: 90,
    });

    async function resolvedTickets(n: number) {
      const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
      for (let i = 0; i < n; i++) {
        const t = await createTicketAs(adminA, { title: `Login problem ${i}`, description: "cannot sign in" });
        await db.update(tasks).set({ status: "resolved", resolvedAt: new Date() }).where(eq(tasks.id, t.body.id));
      }
      return adminA;
    }
    async function until<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
      let value = await read();
      for (let i = 0; i < 100 && !done(value); i++) {
        await new Promise((r) => setTimeout(r, 100));
        value = await read();
      }
      return value;
    }

    it("an admin starts it; with 5 resolved tickets the faked model's pattern becomes a stored article", async () => {
      await configureBedrock();
      const adminA = await resolvedTickets(5);
      bedrockMock.handler = (p) => {
        if (p.includes("expert knowledge management AI")) return MARK_PATTERNS;
        if (p.includes("technical writer creating a knowledge base article")) return ARTICLE;
        return "{}";
      };

      const res = await adminA.post("/api/admin/learning-queue/process");
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/started/i);

      const articles = await until(() => db.select().from(knowledgeArticles), (rows) => rows.length > 0);
      expect(articles).toHaveLength(1);
      expect(articles[0]).toMatchObject({ title: "Fixing login problems", createdBy: AI_SYSTEM_USER_ID });
      expect(articles[0].content).toContain("Reset the password");
      expect(bedrockMock.prompts.some((p) => p.includes("expert knowledge management AI"))).toBe(true);
    });

    it("with fewer than 5 resolved tickets it starts and learns nothing", async () => {
      await configureBedrock();
      const adminA = await resolvedTickets(4);
      bedrockMock.prompts = [];
      const res = await adminA.post("/api/admin/learning-queue/process");
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 500));
      expect(await db.select().from(knowledgeArticles)).toHaveLength(0);
      expect(bedrockMock.prompts.some((p) => p.includes("expert knowledge management AI"))).toBe(false);
    });

    it("only an admin may start it (403), anonymous is 401, and a refused call runs nothing", async () => {
      await configureBedrock();
      await resolvedTickets(5);
      bedrockMock.prompts = [];
      for (const role of ["agent", "manager", "customer"] as const) {
        const a = await loginAs(ctx.app, await createUser({ role }));
        expect([role, (await a.post("/api/admin/learning-queue/process")).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).post("/api/admin/learning-queue/process")).status).toBe(401);
      await new Promise((r) => setTimeout(r, 500));
      expect(bedrockMock.prompts).toHaveLength(0);
      expect(await db.select().from(knowledgeArticles)).toHaveLength(0);
    });
  });
});
