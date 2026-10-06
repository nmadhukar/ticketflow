import { eq } from "drizzle-orm";
import { aiSettings, knowledgeArticles, taskComments } from "@shared/schema";
import { aiModelMock, MOCK_MODEL_ID } from "../mocks/openRouter.mock";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { getAISettings } from "../../admin/aiSettings";
import { estimatePromptTokensForBudget, saveCostLimits } from "../../services/ai/costMonitoring";
import { analyzeTicket, generateAutoResponseForTicket } from "../../services/ai/aiTicketAnalysis";
import { generateResponse } from "../../services/ai/bedrockIntegration";
import { PROMPT_TEMPLATES } from "../../services/ai/prompts";
import { DESCRIPTION_TRUNCATION_MARKER, MIN_DESCRIPTION_CHARS } from "../../services/ai/promptBudget";
import type { Task } from "@shared/schema";

const priorOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

describe("AI cost limits and long tickets", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let warnSpy: jest.SpyInstance;

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
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    // setup.ts already replaces console.warn with a jest.fn, which spyOn returns as it is: its calls
    // would carry over from the previous test.
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSpy.mockClear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------------------------------------------ M1
  describe("M1: saving cost limits does not turn AI on", () => {
    it("on an install with no AI settings row, a cost-limits save keeps AI disabled", async () => {
      const admin = await createUser({ role: "admin" });
      expect((await getAISettings()).isActive).toBe(false); // before: no row reads as off
      expect(await db.select().from(aiSettings)).toHaveLength(0);

      await saveCostLimits({ dailyLimitUSD: 12, monthlyLimitUSD: 34, maxTokensPerRequest: 2500 }, admin.id);

      const after = await getAISettings();
      expect(after.isActive).toBe(false); // it used to read true here
      expect(after).toMatchObject({ dailyLimitUsd: 12, monthlyLimitUsd: 34, maxTokensPerRequest: 2500 });
      const rows = await db.select().from(aiSettings);
      expect(rows).toHaveLength(1);
      expect(rows[0].isActive).toBe(false);
    });

    it("the same through PUT /api/bedrock/cost-limits", async () => {
      const admin = await createUser({ role: "admin" });
      const agent = await loginAs(ctx.app, admin);
      const res = await agent.put("/api/bedrock/cost-limits").send({ dailyLimitUSD: 7, monthlyLimitUSD: 70, maxTokensPerRequest: 4000 });
      expect(res.status).toBe(200);
      expect((await getAISettings()).isActive).toBe(false);
    });

    it("AI stays disabled until somebody enables it explicitly, and an enabled row stays enabled", async () => {
      const admin = await createUser({ role: "admin" });
      await saveCostLimits({ dailyLimitUSD: 12, monthlyLimitUSD: 34, maxTokensPerRequest: 2500 }, admin.id);
      expect((await getAISettings()).isActive).toBe(false);

      await storage.updateAISettings({ isActive: true }, admin.id);
      expect((await getAISettings()).isActive).toBe(true);

      await saveCostLimits({ dailyLimitUSD: 15, monthlyLimitUSD: 40, maxTokensPerRequest: 3000 }, admin.id);
      expect((await getAISettings()).isActive).toBe(true);
    });
  });

  // ------------------------------------------------------------------ M3
  describe("M3: a long ticket description is truncated to fit the token cap, not skipped", () => {
    const TEN_KB = 10 * 1024;
    const START = "STARTOFDESCRIPTION";
    const END = "ENDOFDESCRIPTION";
    const longDescription = `${START} ${"printerjam spools and never prints. ".repeat(Math.ceil(TEN_KB / 36))} ${END}`;
    const CAP_TOKENS = 3000; // the default maxTokensPerRequest, copied from the legacy settings

    async function activeWithDefaultCap() {
      const admin = await createUser({ role: "admin" });
      await storage.updateAISettings({
        modelId: MOCK_MODEL_ID,
        isActive: true,
        autoResponseEnabled: true,
        confidenceThreshold: "0.7",
        maxResponseLength: 1000,
        maxTokensPerRequest: CAP_TOKENS,
      }, admin.id);
      return admin;
    }
    const withDescription = () => aiModelMock.prompts.filter((p) => p.includes(START));
    // The cap is a ceiling on prompt plus output tokens, and the budget estimate is two bytes per token.
    const promptWithinCap = (prompt: string) => Math.ceil(Buffer.byteLength(prompt, "utf8") / 2) + 16 < CAP_TOKENS;

    it("a 10 KB description is longer than the cap allows", () => {
      expect(Buffer.byteLength(longDescription, "utf8")).toBeGreaterThan(TEN_KB);
      expect(Math.ceil(Buffer.byteLength(longDescription, "utf8") / 2)).toBeGreaterThan(CAP_TOKENS);
    });

    it("ticket creation still gets AI: the model is called with a truncated description and a comment is posted", async () => {
      await activeWithDefaultCap();
      await db.insert(knowledgeArticles).values({ title: "Printerjam fix", content: "How to clear a printerjam", isPublished: true, status: "published" });
      const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
      const res = await createTicketAs(customerA, { title: "Printerjam broken", description: longDescription });
      expect(res.status).toBe(201);

      const prompts = withDescription();
      expect(prompts.length).toBeGreaterThanOrEqual(2); // analyzeTicket and generateResponse
      for (const prompt of prompts) {
        expect(promptWithinCap(prompt)).toBe(true);
        expect(prompt).toContain(START);
        expect(prompt).not.toContain(END);
        expect(prompt).toContain("[description truncated]");
        // The instructions after the description survive: only the description is cut.
        expect(prompt).toContain("CRITICAL FORMAT REQUIREMENTS");
      }
      const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, res.body.id));
      expect(comments.length).toBeGreaterThanOrEqual(1);
    });

    it("the log line carries only length numbers, never the description", async () => {
      await activeWithDefaultCap();
      const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
      expect((await createTicketAs(customerA, { title: "Printerjam broken", description: longDescription })).status).toBe(201);

      const lines = warnSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).filter((line) => /truncated/i.test(line));
      expect(lines.length).toBeGreaterThanOrEqual(1);
      for (const line of lines) {
        expect(line).toMatch(/originalChars=\d+/);
        expect(line).toMatch(/keptChars=\d+/);
        expect(line).not.toContain(START);
        expect(line).not.toContain("printerjam");
      }
    });

    it("a short description is sent untouched, with no marker and no log line", async () => {
      await activeWithDefaultCap();
      const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
      const description = `${START} printer is jammed ${END}`;
      expect((await createTicketAs(customerA, { title: "Printerjam broken", description })).status).toBe(201);
      const prompts = withDescription();
      expect(prompts.length).toBeGreaterThanOrEqual(2);
      for (const prompt of prompts) {
        expect(prompt).toContain(END);
        expect(prompt).not.toContain("[description truncated]");
      }
      expect(warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).filter((l) => /truncated/i.test(l))).toEqual([]);
    });

    it("the ticket analysis and auto-response prompts of aiTicketAnalysis are truncated the same way", async () => {
      const admin = await activeWithDefaultCap();
      const analysis = await analyzeTicket({ title: "Printerjam broken", description: longDescription, category: "support", priority: "medium", reporterId: admin.id });
      expect(analysis).not.toBeNull();
      const reply = await generateAutoResponseForTicket(
        { title: "Printerjam broken", description: longDescription, category: "support", priority: "medium" },
        analysis!
      );
      expect(reply).not.toBeNull();
      const prompts = withDescription();
      expect(prompts).toHaveLength(2);
      for (const prompt of prompts) {
        expect(promptWithinCap(prompt)).toBe(true);
        expect(prompt).not.toContain(END);
        expect(prompt).toContain("[description truncated]");
      }
    });

    // ------------------------------------------------------------------ N1
    describe("N1: when the rest of the prompt already exceeds the budget, the description is sent whole and the budget check decides", () => {
      const ticket = (description: string) =>
        ({ title: "Printerjam broken", description, category: "support", priority: "medium" }) as unknown as Task;
      const bigArticles = (bytes: number) => [{ id: 1, title: "Printerjam guide", summary: "kb ".repeat(Math.ceil(bytes / 3)) }];
      const knowledgeBase = (articles: { title: string; summary: string }[]) => articles.map((a) => `- ${a.title}: ${a.summary}`).join("\n");
      const GENERATE_RESPONSE_OUTPUT = 800; // OPERATION_OUTPUT_CAP.generateResponse, under the default maxTokens of 2000
      const sentWithoutText = () => aiModelMock.prompts.filter((p) => p.includes("helpful IT support assistant"));

      it("the scenario is the one N1 describes: the prompt minus the description is over the budget but under the cap", () => {
        const withoutDescription = estimatePromptTokensForBudget(
          PROMPT_TEMPLATES.generateResponse(ticket(DESCRIPTION_TRUNCATION_MARKER), knowledgeBase(bigArticles(3500)))
        );
        expect(withoutDescription).toBeGreaterThan(CAP_TOKENS - GENERATE_RESPONSE_OUTPUT);
        expect(withoutDescription).toBeLessThan(CAP_TOKENS);
      });

      // Above the 500-character floor, and small enough that the whole prompt is still under the cap.
      const midDescription = `${START} ${"the office printer is jammed again. ".repeat(16)} ${END}`;

      it("the mid-size description is above the floor, and its whole prompt is under the cap", () => {
        expect(midDescription.length).toBeGreaterThan(MIN_DESCRIPTION_CHARS);
        const whole = estimatePromptTokensForBudget(PROMPT_TEMPLATES.generateResponse(ticket(midDescription), knowledgeBase(bigArticles(3500))));
        expect(whole).toBeLessThan(CAP_TOKENS);
      });

      it("a description that cannot be cut to the floor is sent whole, and the cost monitor blocks the call if it is over the cap, as before M3", async () => {
        await activeWithDefaultCap();
        await expect(generateResponse(ticket(longDescription), bigArticles(3500))).rejects.toMatchObject({
          isBlocked: true,
          message: "Request exceeds max tokens per request",
        });
        expect(aiModelMock.totalCalls()).toBe(0);

        const lines = warnSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).filter((line) => /truncated/i.test(line));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("not truncated: below the floor");
        expect(lines[0]).toMatch(/operation=generateResponse/);
        expect(lines[0]).toMatch(/originalChars=\d+/);
        expect(lines[0]).not.toContain(START);
        expect(lines[0]).not.toContain("printerjam");
      });

      it("nothing is refused that the old code ran: a description above the floor, whole prompt under the cap, is sent whole", async () => {
        await activeWithDefaultCap();
        const result = await generateResponse(ticket(midDescription), bigArticles(3500));
        expect(result.response).toBe("Try restarting the service.");
        const prompts = sentWithoutText();
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain(START);
        expect(prompts[0]).toContain(END);
        expect(prompts[0]).not.toContain("[description truncated]");
      });

      it("a short description is sent whole too: the model always sees the ticket text", async () => {
        await activeWithDefaultCap();
        const description = `${START} printer is jammed ${END}`;
        const result = await generateResponse(ticket(description), bigArticles(3500));
        expect(result.response).toBe("Try restarting the service.");
        const prompts = sentWithoutText();
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain(description);
        expect(prompts[0]).not.toContain("[description truncated]");
      });

      it("the same long description with a normal knowledge base still gets the truncated call", async () => {
        await activeWithDefaultCap();
        const result = await generateResponse(ticket(longDescription), bigArticles(200));
        expect(result.response).toBe("Try restarting the service.");
        const prompts = sentWithoutText();
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain(START);
        expect(prompts[0]).toContain("[description truncated]");
        expect(prompts[0]).not.toContain(END);
        expect(promptWithinCap(prompts[0])).toBe(true);
      });

      it("ticket creation still succeeds, and no prompt reaches the model without the start of the ticket text", async () => {
        await activeWithDefaultCap();
        await db.insert(knowledgeArticles).values({
          title: "Printerjam fix",
          content: "How to clear a printerjam",
          summary: "printerjam ".repeat(320),
          isPublished: true,
          status: "published",
        });
        const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
        const res = await createTicketAs(customerA, { title: "Printerjam broken", description: longDescription });
        expect(res.status).toBe(201);
        // Whatever reached the model carried the start of the ticket text, never just the marker.
        for (const prompt of aiModelMock.prompts.filter((p) => p.includes("helpful IT support assistant"))) {
          expect(prompt).toContain(START);
        }
      });
    });

    it("the cap stays a ceiling: when even the prompt without a description cannot fit, the call is still blocked", async () => {
      const admin = await createUser({ role: "admin" });
      await storage.updateAISettings({ modelId: MOCK_MODEL_ID, isActive: true, autoResponseEnabled: true, maxTokensPerRequest: 200 }, admin.id);
      await expect(
        analyzeTicket({ title: "Printerjam broken", description: longDescription, category: "support", priority: "medium", reporterId: admin.id })
      ).rejects.toMatchObject({ isBlocked: true });
      expect(aiModelMock.totalCalls()).toBe(0);
    });
  });
});
