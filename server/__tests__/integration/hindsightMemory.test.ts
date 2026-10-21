import { taskComments, tasks } from "@shared/schema";
import { eq } from "drizzle-orm";
import { aiModelMock, MOCK_MODEL_ID } from "../mocks/openRouter.mock";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";

type FetchFn = (input: string, init?: { body?: string; headers?: Record<string, string> }) => Promise<Response>;
interface MemoryCall { url: string; body?: Record<string, unknown> }

/**
 * Hindsight agent memory. The service's coordinates are deployment configuration
 * (HINDSIGHT_ENABLED, default off); there is no live instance in this suite, so every
 * request it would make is faked at fetch, beside the OpenRouter fake. With the flag off
 * the create and resolve paths are byte-for-byte what they were, which the first test
 * pins down.
 */
describe("Hindsight memory", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const savedEnv = { ...process.env };
  const priorOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  const MEMORY_VARS = ["HINDSIGHT_ENABLED", "HINDSIGHT_URL", "HINDSIGHT_API_KEY", "HINDSIGHT_BANK_ID"];

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => {
    await ctx.close();
    for (const key of MEMORY_VARS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (priorOpenRouterApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorOpenRouterApiKey;
  });

  beforeEach(async () => {
    await resetDb();
    await ensureAiSystemUser();
    aiModelMock.reset();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const key of MEMORY_VARS) delete process.env[key];
  });
  afterEach(() => { jest.restoreAllMocks(); });

  /** AI on, threshold low enough that a matched reply is posted. */
  async function enableAi() {
    const admin = await createUser({ role: "admin" });
    await storage.updateAISettings({
      modelId: MOCK_MODEL_ID, isActive: true, autoResponseEnabled: true,
      confidenceThreshold: "0.1", maxResponseLength: 1000, maxTokensPerRequest: 3000,
    }, admin.id);
    return admin;
  }

  const setFetch = (fn: FetchFn) => {
    globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  };

  /**
   * Routes OpenRouter calls to the model fake and everything else to a recording memory
   * fake, so both can share global fetch. Returns the recorded memory calls.
   */
  function fakeMemoryService(opts: { recall?: unknown; recallStatus?: number } = {}) {
    const openRouterFetch = globalThis.fetch;
    const calls: MemoryCall[] = [];
    setFetch((input, init) => {
      const url = String(input);
      if (url.startsWith("https://openrouter.ai")) return openRouterFetch(input, init);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/memories/recall")) {
        return Promise.resolve(new Response(JSON.stringify(opts.recall ?? { results: [] }), {
          status: opts.recallStatus ?? 200, headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    return calls;
  }

  const memoryItems = (call: MemoryCall) =>
    (call.body as { items: { content: string; document_id?: string }[] }).items;

  function enableMemory() {
    process.env.HINDSIGHT_ENABLED = "true";
    process.env.HINDSIGHT_URL = "http://memory.test:8888";
    process.env.HINDSIGHT_BANK_ID = "ticketflow-test";
  }

  it("off by default: no memory request is made on create", async () => {
    await enableAi();
    const openRouterFetch = globalThis.fetch;
    setFetch((input, init) => {
      const url = String(input);
      if (!url.startsWith("https://openrouter.ai")) throw new Error("unexpected request while Hindsight is off: " + url);
      return openRouterFetch(input, init);
    });

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printer jam", description: "The spooler is stuck." });
    expect(res.status).toBe(201);
    expect(res.body.assigneeTeamId).toBeNull();
    expect(aiModelMock.totalCalls()).toBeGreaterThan(0); // the normal AI path still ran
  });

  it("recalls memories before replying and adds them to the reply prompt", async () => {
    await enableAi();
    enableMemory();
    const calls = fakeMemoryService({ recall: { results: [{ text: "Last time, restarting the print spooler fixed it." }] } });

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printer jam", description: "The spooler is stuck." });
    expect(res.status).toBe(201);

    const recallCall = calls.find((c) => c.url.endsWith("/memories/recall"));
    expect(recallCall).toBeDefined();
    expect(recallCall!.url).toBe("http://memory.test:8888/v1/default/banks/ticketflow-test/memories/recall");
    expect((recallCall!.body as { query: string }).query).toContain("Printer jam");

    expect(aiModelMock.prompts.join("\n---\n")).toContain("restarting the print spooler");
  });

  it("retains a memory when a ticket is resolved", async () => {
    const admin = await enableAi();
    enableMemory();
    const adminA = await loginAs(ctx.app, admin);
    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const created = await createTicketAs(customerA, { title: "Printer jam", description: "The spooler is stuck." });
    expect(created.status).toBe(201);

    const calls = fakeMemoryService();
    await db.insert(taskComments).values({
      taskId: created.body.id as number, userId: admin.id,
      content: "Restarted the print spooler and it is resolved.",
    });
    const resolved = await adminA.patch(`/api/tasks/${created.body.id}`).send({ status: "resolved" });
    expect(resolved.status).toBe(200);

    const retainCall = calls.find((c) => c.url.endsWith("/memories") && Array.isArray(c.body?.items));
    expect(retainCall).toBeDefined();
    expect(retainCall!.url).toBe("http://memory.test:8888/v1/default/banks/ticketflow-test/memories");
    const [item] = memoryItems(retainCall!);
    expect(item.content).toContain("Printer jam");
    expect(item.content).toContain("print spooler");
    expect(item.document_id).toBe(`ticket-${created.body.id}`);
  });

  it("a memory service that is down never fails the ticket write", async () => {
    await enableAi();
    enableMemory();
    const openRouterFetch = globalThis.fetch;
    setFetch((input, init) =>
      String(input).startsWith("https://openrouter.ai")
        ? openRouterFetch(input, init)
        : Promise.reject(new Error("connection refused")));

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printer jam", description: "The spooler is stuck." });
    expect(res.status).toBe(201);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, res.body.id as number));
    expect(row).toBeDefined();
  });
});