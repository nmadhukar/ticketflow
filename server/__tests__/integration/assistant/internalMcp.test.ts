import request from "supertest";
import { eq } from "drizzle-orm";
import { taskComments, users, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { storage } from "../../../storage";
import { keyOwnerBlockReason } from "../../../services/auth/apiKeys";
import { createInternalApp } from "../../../assistant/internalServer";
import { createAssistantMcpServer } from "../../../assistant/mcpServer";
import { AssistantRuns, RENEW_WINDOW_SECONDS } from "../../../assistant/runAuth";
import { ASSISTANT_TOKEN_TTL_SECONDS } from "../../../assistant/sessionToken";
import { closeDb, resetDb } from "../helpers/testDb";
import { createUser } from "../helpers/fixtures";

/**
 * The assistant's internal MCP endpoint against the real database: every tool call runs as the
 * run's user under the same rules as REST, and the run token is rechecked on every call.
 */
const SESSION_SECRET = "integration-assistant-session-secret-0001";
const AGENT_SECRET = "integration-assistant-agent-secret-00002";

let now = Date.now();
let runs: AssistantRuns<User>;
let app: ReturnType<typeof createInternalApp>;
let A: User; // customer with a ticket
let B: User; // another customer
let U: User; // agent with no link to A's ticket
let admin: User;
let ticketId: number;
let ticketNumber: string;
const TITLE = "Assistant isolation qwertyunique";

async function mcp(token: string | null, method: string, params: object = {}, headers: Record<string, string> = {}) {
  let r = request(app).post("/internal/mcp").set("Accept", "application/json, text/event-stream");
  if (token) r = r.set("X-TicketFlow-MCP-Session", token);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send({ jsonrpc: "2.0", id: 1, method, params });
}

async function callTool(token: string, name: string, args: object = {}) {
  const res = await mcp(token, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const result = res.body.result ?? {};
  const text: string = result.content?.[0]?.text ?? JSON.stringify(res.body.error ?? {});
  return { isError: !!result.isError || !!res.body.error, text };
}

beforeAll(() => {
  runs = new AssistantRuns<User>({
    sessionSecrets: [SESSION_SECRET],
    agentSecret: AGENT_SECRET,
    runMaxSeconds: 900,
    loadUser: (id) => storage.getUser(id),
    blockReason: (user) => keyOwnerBlockReason(user),
    now: () => now,
  });
  app = createInternalApp({
    runs: async () => runs,
    createMcpServer: async (user, agentId, ip) => createAssistantMcpServer(user, agentId, ip),
  });
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  now = Date.now();
  await resetDb();
  A = await createUser({ role: "customer" });
  B = await createUser({ role: "customer" });
  U = await createUser({ role: "agent" });
  admin = await createUser({ role: "admin" });
  const t = await storage.createTask({
    title: TITLE,
    description: "Body of the ticket",
    category: "support",
    createdBy: A.id,
  } as never);
  ticketId = t.id;
  ticketNumber = t.ticketNumber;
});

describe("assistant internal MCP", () => {
  it("accepts a ticket number where the tools take an id, only among the user's own tickets", async () => {
    const a = runs.start(A.id, "support-assistant");
    for (const ref of [ticketNumber, ticketNumber.toLowerCase()]) {
      const own = await callTool(a.mcpToken, "get_ticket", { id: ref });
      expect(own.isError).toBe(false);
      expect(own.text).toContain(TITLE);
    }
    expect((await callTool(a.mcpToken, "get_ticket_history", { id: ticketNumber })).isError).toBe(false);

    // Someone else's ticket and a ticket that does not exist give the same answer.
    const notFound = JSON.stringify({ code: "NOT_FOUND", message: "Ticket not found" });
    const b = runs.start(B.id, "support-assistant");
    expect(await callTool(b.mcpToken, "get_ticket", { id: ticketNumber })).toEqual({ isError: true, text: notFound });
    expect(await callTool(b.mcpToken, "get_ticket", { id: "TKT-1999-0001" })).toEqual({ isError: true, text: notFound });
    const u = runs.start(U.id, "ticket-assistant");
    expect(await callTool(u.mcpToken, "get_ticket_history", { id: ticketNumber })).toEqual({ isError: true, text: notFound });
  });

  it("a customer's run sees their own ticket, and another customer's run does not", async () => {
    const a = runs.start(A.id, "support-assistant");
    const own = await callTool(a.mcpToken, "list_tickets");
    expect(own.isError).toBe(false);
    expect(own.text).toContain(TITLE);

    const b = runs.start(B.id, "support-assistant");
    const others = await callTool(b.mcpToken, "list_tickets");
    expect(others.text).not.toContain(TITLE);
    const direct = await callTool(b.mcpToken, "get_ticket", { id: ticketId });
    expect(direct.isError).toBe(true);
    expect(direct.text).not.toContain(TITLE);
  });

  it("staff see what their own role sees: an unlinked agent does not, an admin does", async () => {
    const u = runs.start(U.id, "ticket-assistant");
    const unlinked = await callTool(u.mcpToken, "get_ticket", { id: ticketId });
    expect(unlinked.isError).toBe(true);
    expect(unlinked.text).not.toContain(TITLE);

    const ad = runs.start(admin.id, "ticket-assistant");
    const seen = await callTool(ad.mcpToken, "get_ticket", { id: ticketId });
    expect(seen.isError).toBe(false);
    expect(seen.text).toContain(TITLE);
  });

  it("lists only the agent's read tools, and a write tool cannot be called", async () => {
    const a = runs.start(A.id, "support-assistant");
    const list = await mcp(a.mcpToken, "tools/list");
    const names: string[] = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("list_tickets");
    expect(names).not.toContain("add_comment");
    expect(names).not.toContain("list_users");

    const write = await callTool(a.mcpToken, "add_comment", { id: ticketId, content: "from the model" });
    expect(write.isError).toBe(true);
    expect(await db.select().from(taskComments)).toEqual([]);
  });

  it("refuses at the next call once the user is deactivated or changes role", async () => {
    const a = runs.start(A.id, "support-assistant");
    expect((await callTool(a.mcpToken, "whoami")).isError).toBe(false);

    await db.update(users).set({ role: "agent" }).where(eq(users.id, A.id));
    expect((await mcp(a.mcpToken, "tools/call", { name: "whoami", arguments: {} })).status).toBe(401);

    await db.update(users).set({ role: "customer", isActive: false }).where(eq(users.id, A.id));
    expect((await mcp(a.mcpToken, "tools/call", { name: "whoami", arguments: {} })).status).toBe(401);
  });

  it("refuses an ended run, a missing token, a forged one and an extra API key", async () => {
    const a = runs.start(A.id, "support-assistant");
    runs.end(a.runId);
    expect((await mcp(a.mcpToken, "tools/list")).status).toBe(401);
    expect((await mcp(null, "tools/list")).status).toBe(401);
    expect((await mcp("abc.def", "tools/list")).status).toBe(401);
    // The agent-hop token is not an MCP token.
    const b = runs.start(B.id, "support-assistant");
    expect((await mcp(b.agentToken, "tools/list")).status).toBe(401);
    expect((await mcp(b.mcpToken, "tools/list", {}, { Authorization: "Bearer tfk_x" })).status).toBe(401);
  });

  it("answers anything but POST with 405, so the sidecar's readiness probe sees the route", async () => {
    expect((await request(app).get("/internal/mcp")).status).toBe(405);
  });

  it("renews a token in its last two minutes, once, and the new one works", async () => {
    const a = runs.start(A.id, "support-assistant");
    const early = await request(app).post("/internal/assistant/renew").set("X-TicketFlow-MCP-Session", a.mcpToken);
    expect(early.status).toBe(409);
    expect(early.body).toEqual({ error: "not_renewed", reason: "renew_too_early" });

    now += (ASSISTANT_TOKEN_TTL_SECONDS - RENEW_WINDOW_SECONDS) * 1000;
    const renewed = await request(app).post("/internal/assistant/renew").set("X-TicketFlow-MCP-Session", a.mcpToken);
    expect(renewed.status).toBe(200);
    const again = await request(app).post("/internal/assistant/renew").set("X-TicketFlow-MCP-Session", a.mcpToken);
    expect(again.status).toBe(401);
    expect(again.body.reason).toBe("already_renewed");

    now += (RENEW_WINDOW_SECONDS + 1) * 1000; // the first token has expired
    expect((await mcp(a.mcpToken, "tools/list")).status).toBe(401);
    expect((await callTool(renewed.body.token, "whoami")).isError).toBe(false);
  });
});
