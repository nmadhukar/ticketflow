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
  createCopilotExpressHandler: ({ runtime }: { runtime: { options: { agents: (ctx: { request: Request }) => Record<string, unknown> } } }) =>
    (req: import("express").Request, res: import("express").Response) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const agents = runtime.options.agents({ request: new Request(`http://app${req.originalUrl}`, { headers }) });
      res.json({ agents: Object.keys(agents) });
    },
}));

import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";
import { issueApiKey } from "../../../services/auth/apiKeys";
import { verifyAssistantToken } from "../../../assistant/sessionToken";
import { assistantRuns } from "../../../assistant/runs";

const ENV = {
  ASSISTANT_ENABLED: "true",
  ASSISTANT_SESSION_SECRET: "bridge-test-assistant-session-secret-01",
  ASSISTANT_AGENT_SECRET: "bridge-test-assistant-agent-secret-0002",
  ASSISTANT_AGENT_URL: "http://agents.test:4111",
  APP_BASE_URL: "http://tickets.test",
};
const ORIGIN = ENV.APP_BASE_URL;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const saved: Record<string, string | undefined> = {};
let customer: User;
let staff: User;

const runBody = { threadId: "thread-1", runId: "run-1", messages: [{ id: "m1", role: "user", content: "hello" }], tools: [], context: [], state: {}, forwardedProps: {} };

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
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
    expect((await c.get("/api/assistant/availability")).body).toEqual({ enabled: true, agentId: "support-assistant" });
    const s = await loginAs(ctx.app, staff);
    expect((await s.get("/api/assistant/availability")).body).toEqual({ enabled: true, agentId: "ticket-assistant" });
    expect((await request(ctx.app).get("/api/assistant/availability")).status).toBe(401);
    expect((await request(ctx.app).get("/api/copilotkit/info")).status).toBe(401);
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
      expect((await c.get("/api/assistant/availability")).body).toEqual({ enabled: false, agentId: "support-assistant" });
      expect((await c.get("/api/copilotkit/info")).status).toBe(503);
    } finally {
      process.env.ASSISTANT_ENABLED = "true";
    }
  });
});
