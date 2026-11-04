import request from "supertest";
import type { User } from "@shared/schema";

/**
 * The browser-facing bridge, through the real app and a real session. CopilotKit and the Mastra
 * client are replaced by recording fakes (they are ES-module-only and do not load under Jest), so
 * the bridge's own code runs for real: the checks in front of CopilotKit, the run it opens, and
 * the agent factory that hands the sidecar its tokens. The live CopilotKit -> sidecar path is
 * exercised against the Docker stack.
 */
type Recorded = { clients: Array<{ baseUrl: string; headers: Record<string, string> }>; runtimes: Array<Record<string, unknown>>; agents: Array<Record<string, unknown>> };
const recorded: Recorded = { clients: [], runtimes: [], agents: [] };

jest.mock("@mastra/client-js", () => ({
  MastraClient: class {
    constructor(public options: { baseUrl: string; headers: Record<string, string> }) {
      recorded.clients.push(options);
    }
    getAgent(id: string) {
      return { id };
    }
  },
}));
jest.mock("@ag-ui/mastra", () => ({
  MastraAgent: class {
    constructor(public config: Record<string, unknown>) {
      recorded.agents.push(config);
    }
  },
}));
jest.mock("@copilotkit/runtime/v2", () => ({
  InMemoryAgentRunner: class {},
  CopilotRuntime: class {
    constructor(public options: Record<string, unknown>) {
      recorded.runtimes.push(options);
    }
  },
}));
jest.mock("@copilotkit/runtime/v2/express", () => ({
  // Resolves the agents the way CopilotKit does for a request, then answers.
  createCopilotExpressHandler: ({ runtime }: { runtime: { options: { agents: (ctx: { request: Request }) => Promise<Record<string, unknown>> } } }) =>
    async (req: import("express").Request, res: import("express").Response) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      // The factory may be async (it asks the sidecar whether history is on); CopilotKit awaits it.
      const agents = await runtime.options.agents({ request: new Request(`http://app${req.originalUrl}`, { headers }) });
      res.json({ agents: Object.keys(agents) });
    },
}));

import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";
import { issueApiKey } from "../../../services/auth/apiKeys";
import { verifyAssistantToken } from "../../../assistant/sessionToken";
import { assistantRuns } from "../../../assistant/runs";
import { db } from "../../../storage/db";
import { aiUsage, assistantAuditEvents, assistantUsageEvents, users } from "@shared/schema";
import { eq } from "drizzle-orm";

const ENV: Record<string, string> = {
  ASSISTANT_ENABLED: "true",
  ASSISTANT_SESSION_SECRET: "bridge-test-assistant-session-secret-01",
  ASSISTANT_AGENT_SECRET: "bridge-test-assistant-agent-secret-0002",
  APP_BASE_URL: "http://tickets.test",
};
const ORIGIN = ENV.APP_BASE_URL;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const saved: Record<string, string | undefined> = {};
let customer: User;
let staff: User;
// A stand-in sidecar that answers only /ready, saying whether saved conversations work.
let sidecarHistory = "ok";
let sidecar: import("http").Server;

const runBody = { threadId: "thread-1", runId: "run-1", messages: [{ id: "m1", role: "user", content: "hello" }], tools: [], context: [], state: {}, forwardedProps: {} };

beforeAll(async () => {
  const { createServer } = await import("http");
  sidecar = createServer((req, res) => {
    res.writeHead(req.url === "/ready" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ready", checks: { history: sidecarHistory }, historyRetentionDays: 21 }));
  });
  await new Promise<void>((resolve) => sidecar.listen(0, "127.0.0.1", resolve));
  ENV.ASSISTANT_AGENT_URL = `http://127.0.0.1:${(sidecar.address() as import("net").AddressInfo).port}`;
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
  sidecar.close();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  recorded.clients = [];
  recorded.runtimes = [];
  recorded.agents = [];
  await resetDb();
  customer = await createUser({ role: "customer" });
  staff = await createUser({ role: "manager" });
});

describe("assistant bridge", () => {
  it("reports each role's agent, and refuses without a session", async () => {
    const c = await loginAs(ctx.app, customer);
    expect((await c.get("/api/assistant/availability")).body).toEqual({ enabled: true, agentId: "support-assistant", history: false });
    const s = await loginAs(ctx.app, staff);
    expect((await s.get("/api/assistant/availability")).body).toEqual({ enabled: true, agentId: "ticket-assistant", history: false });
    expect((await request(ctx.app).get("/api/assistant/availability")).status).toBe(401);
    expect((await request(ctx.app).get("/api/copilotkit/info")).status).toBe(401);
  });

  it("every role gets its own agent: customers the support one; agents, managers and admins the staff one", async () => {
    for (const role of ["customer", "agent", "manager", "admin"] as const) {
      const user = await createUser({ role });
      const session = await loginAs(ctx.app, user);
      const expected = role === "customer" ? "support-assistant" : "ticket-assistant";
      const other = role === "customer" ? "ticket-assistant" : "support-assistant";
      expect((await session.get("/api/assistant/availability")).body.agentId).toBe(expected);
      expect((await session.post(`/api/copilotkit/agent/${other}/run`).set("Origin", ORIGIN).send(runBody)).status).toBe(404);
    }
    expect(recorded.clients).toEqual([]);
  });

  it("ASSISTANT_AUDIENCE=staff: customers have no assistant (no launcher, no run, no draft decision); staff keep theirs", async () => {
    process.env.ASSISTANT_AUDIENCE = "staff";
    try {
      const c = await loginAs(ctx.app, customer);
      expect((await c.get("/api/assistant/availability")).body).toEqual({ enabled: false, agentId: null, history: false });
      expect((await c.post("/api/copilotkit/agent/support-assistant/run").set("Origin", ORIGIN).send(runBody)).status).toBe(403);
      const s = await loginAs(ctx.app, staff);
      expect((await s.get("/api/assistant/availability")).body).toMatchObject({ enabled: true, agentId: "ticket-assistant" });
      expect(recorded.clients).toEqual([]);
    } finally {
      delete process.env.ASSISTANT_AUDIENCE;
    }
  });

  it("a deactivated account loses the assistant at its next request, its open session included", async () => {
    const c = await loginAs(ctx.app, customer);
    expect((await c.get("/api/assistant/availability")).status).toBe(200);
    await db.update(users).set({ isActive: false }).where(eq(users.id, customer.id));
    expect((await c.get("/api/assistant/availability")).status).toBe(401);
    expect((await c.post("/api/copilotkit/agent/support-assistant/run").set("Origin", ORIGIN).send(runBody)).status).toBe(401);
    expect(recorded.clients).toEqual([]);
  });

  it("refuses an API key on the bridge: it is session-only", async () => {
    const { plaintext } = await issueApiKey({ userId: staff.id, name: "bridge" });
    const res = await request(ctx.app).get("/api/copilotkit/info").set("Authorization", `Bearer ${plaintext}`);
    expect(res.status).toBe(403);
    expect(recorded.clients).toEqual([]);
  });

  it("refuses the other role's agent, unlisted routes and cross-site posts before CopilotKit", async () => {
    const c = await loginAs(ctx.app, customer);
    expect((await c.post("/api/copilotkit/agent/ticket-assistant/run").set("Origin", ORIGIN).send(runBody)).status).toBe(404);
    expect((await c.post("/api/copilotkit/agent/support-assistant/suggest").set("Origin", ORIGIN).send({})).status).toBe(404);
    expect((await c.post("/api/copilotkit/agent/support-assistant/run").set("Origin", "http://evil.test").send(runBody)).status).toBe(403);
    expect((await c.post("/api/copilotkit/agent/support-assistant/run").send(runBody)).status).toBe(403);
    expect(recorded.clients).toEqual([]);
  });

  it("registers only the caller's agent, and hands the sidecar this user's run tokens", async () => {
    const c = await loginAs(ctx.app, customer);
    const res = await c
      .post("/api/copilotkit/agent/support-assistant/run")
      .set("Origin", ORIGIN)
      .set("X-Tf-Internal-Agent-Token", "forged-by-browser")
      .set("X-Tf-Internal-Mcp-Token", "forged-by-browser")
      .send(runBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ agents: ["support-assistant"] });

    const client = recorded.clients.at(-1)!;
    expect(client.baseUrl).toBe(ENV.ASSISTANT_AGENT_URL);
    const bearer = client.headers.Authorization.replace(/^Bearer /, "");
    expect(bearer).not.toBe("forged-by-browser");
    const verified = verifyAssistantToken("agent", bearer, [ENV.ASSISTANT_AGENT_SECRET]);
    expect(verified.ok && verified.claims.sub).toBe(customer.id);
    expect(verified.ok && verified.agentId).toBe("support-assistant");
    const mcpToken = client.headers["X-TicketFlow-MCP-Session"];
    expect(mcpToken).not.toBe("forged-by-browser");
    expect(verifyAssistantToken("mcp", mcpToken, [ENV.ASSISTANT_SESSION_SECRET]).ok).toBe(true);

    expect(recorded.agents.at(-1)).toMatchObject({ agentId: "support-assistant", resourceId: `user:${customer.id}` });
    // Allowlist mode: browser headers do not reach the sidecar, ours never.
    expect(recorded.runtimes.at(-1)!.forwardHeaders).toEqual({ allow: ["x-request-id"], denyPrefixes: ["x-tf-internal-"] });

    // The response has ended, so the run's MCP token is refused from now on.
    await new Promise((resolve) => setImmediate(resolve));
    await expect(assistantRuns().authenticate(mcpToken)).resolves.toMatchObject({ ok: false, reason: "run_not_open" });

    // The fake runtime never runs the agent, so the run is recorded as never started.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const verified2 = verifyAssistantToken("agent", bearer, [ENV.ASSISTANT_AGENT_SECRET]);
    const runId = verified2.ok ? verified2.claims.jti : "";
    const [row] = await db.select().from(assistantUsageEvents).where(eq(assistantUsageEvents.runId, runId));
    expect(row).toMatchObject({ userId: customer.id, agentId: "support-assistant", status: "stopped", errorCategory: "not_started", toolNames: [] });
  });

  it("opens no run, and gives the sidecar no token, for requests other than a run", async () => {
    const s = await loginAs(ctx.app, staff);
    const res = await s.get("/api/copilotkit/info").set("X-Tf-Internal-Agent-Token", "forged-by-browser");
    expect(res.body).toEqual({ agents: ["ticket-assistant"] });
    expect(recorded.clients.at(-1)!.headers).toEqual({});
  });

  it("returns 503 for everyone while the assistant is switched off", async () => {
    process.env.ASSISTANT_ENABLED = "false";
    try {
      const c = await loginAs(ctx.app, customer);
      expect((await c.get("/api/assistant/availability")).body).toEqual({ enabled: false, agentId: "support-assistant", history: false });
      expect((await c.get("/api/copilotkit/info")).status).toBe(503);
    } finally {
      process.env.ASSISTANT_ENABLED = "true";
    }
  });

  it("saved conversations: off by default, staff only, own-site deletes, valid ids only", async () => {
    const c = await loginAs(ctx.app, customer);
    const s = await loginAs(ctx.app, staff);
    expect((await s.get("/api/assistant/history")).status).toBe(503);

    process.env.ASSISTANT_STAFF_HISTORY = "true";
    try {
      // The retention shown to staff is the sidecar's, not a constant.
      expect((await s.get("/api/assistant/availability")).body).toMatchObject({ agentId: "ticket-assistant", history: true, historyRetentionDays: 21 });
      expect((await c.get("/api/assistant/availability")).body).toMatchObject({ agentId: "support-assistant", history: false });
      expect((await request(ctx.app).get("/api/assistant/history")).status).toBe(401);
      expect((await c.get("/api/assistant/history")).status).toBe(403);
      expect((await s.delete("/api/assistant/history/t1")).status).toBe(403);
      expect((await s.delete("/api/assistant/history/t1").set("Origin", "http://evil.test")).status).toBe(403);
      expect((await s.get("/api/assistant/history/bad%20id")).status).toBe(404);
      expect((await s.get(`/api/assistant/history/${"x".repeat(121)}`)).status).toBe(404);
    } finally {
      delete process.env.ASSISTANT_STAFF_HISTORY;
    }
  });

  it("history is off while the sidecar says so, whatever the app's switch says", async () => {
    // A second app, so its cached sidecar status starts empty. Not closed here: its close would
    // end the shared database pool; the main app's afterAll closes what both share.
    const app2 = await createTestApp();
    process.env.ASSISTANT_STAFF_HISTORY = "true";
    sidecarHistory = "off";
    try {
      const s = await loginAs(app2.app, staff);
      expect((await s.get("/api/assistant/availability")).body).toMatchObject({ history: false });
      expect((await s.get("/api/assistant/history")).status).toBe(503);
    } finally {
      sidecarHistory = "ok";
      delete process.env.ASSISTANT_STAFF_HISTORY;
    }
  });

  it("stops running once the AI budget is spent, and records the refusal", async () => {
    await db.insert(aiUsage).values({ modelId: "openai/gpt-5-mini", inputTokens: 1, outputTokens: 1, estimatedCost: "5000", operation: "test.spend" });
    try {
      const c = await loginAs(ctx.app, customer);
      const res = await c.post("/api/copilotkit/agent/support-assistant/run").set("Origin", ORIGIN).send(runBody);
      expect(res.status).toBe(429);
      expect(res.body.error).toBe("assistant_budget_reached");
      expect(recorded.clients).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const usage = await db.select().from(assistantUsageEvents).where(eq(assistantUsageEvents.userId, customer.id));
      expect(usage).toEqual([expect.objectContaining({ status: "refused", errorCategory: "daily_budget" })]);
      const audit = await db.select().from(assistantAuditEvents).where(eq(assistantAuditEvents.actorUserId, customer.id));
      expect(audit).toEqual([expect.objectContaining({ eventType: "run_refused", reason: "daily_budget" })]);
    } finally {
      await db.delete(aiUsage).where(eq(aiUsage.operation, "test.spend"));
    }
  });
});
