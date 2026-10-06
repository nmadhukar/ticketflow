import request from "supertest";
import { eq } from "drizzle-orm";
import { apiKeys, sessions, tasks } from "@shared/schema";
import { db } from "../../../storage/db";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";
import { issueApiKey } from "../../../services/auth/apiKeys";
import { storage } from "../../../storage";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let ip = 40;
const freshIp = () => `198.51.100.${++ip}`;

const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const CREATE_CALL = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "create_ticket", arguments: { title: "x", category: "support" } },
};

function mcp(bearer?: string, body: object = TOOLS_LIST) {
  const r = request(ctx.app)
    .post("/api/mcp")
    .set("X-Forwarded-For", freshIp())
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
  return (bearer === undefined ? r : r.set("Authorization", `Bearer ${bearer}`)).send(body);
}

async function ticketCount() {
  return (await db.select().from(tasks)).length;
}

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
});

describe("POST /api/mcp authentication", () => {
  it("lists every tool for a valid key and sets no cookie and no session row", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const before = (await db.select().from(sessions)).length;
    const res = await mcp(plaintext);
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "add_comment",
      "close_ticket",
      "create_guideline",
      "create_help_document",
      "create_knowledge_article",
      "create_policy",
      "create_ticket",
      "delete_ticket",
      "get_document",
      "get_knowledge_article",
      "get_stats",
      "get_team",
      "get_ticket",
      "get_ticket_history",
      "list_activity",
      "list_departments",
      "list_guideline_categories",
      "list_notifications",
      "list_teams",
      "list_tickets",
      "list_users",
      "mark_notifications_read",
      "reopen_ticket",
      "search_documents",
      "search_knowledge",
      "update_guideline",
      "update_help_document",
      "update_knowledge_article",
      "update_policy",
      "update_ticket",
      "whoami",
    ]);
    expect((await db.select().from(sessions)).length).toBe(before);
  });

  it("no credential: 401 with WWW-Authenticate: Bearer, ticket count unchanged", async () => {
    const before = await ticketCount();
    const res = await mcp(undefined, CREATE_CALL);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
    expect(await ticketCount()).toBe(before);
  });

  it("garbage key: 401 with WWW-Authenticate: Bearer, ticket count unchanged", async () => {
    const before = await ticketCount();
    const res = await mcp("tfk_" + "0".repeat(40), CREATE_CALL);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
    expect(await ticketCount()).toBe(before);
  });

  it("revoked key: 401, ticket count unchanged", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext, apiKey } = await issueApiKey({ userId: owner.id, name: "k" });
    await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, apiKey.id));
    const before = await ticketCount();
    const res = await mcp(plaintext, CREATE_CALL);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
    expect(await ticketCount()).toBe(before);
  });

  it("expired key: 401, ticket count unchanged", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext, apiKey } = await issueApiKey({ userId: owner.id, name: "k" });
    await db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apiKeys.id, apiKey.id));
    const before = await ticketCount();
    const res = await mcp(plaintext, CREATE_CALL);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
    expect(await ticketCount()).toBe(before);
  });

  it("a key without mcp:tickets is refused (403), ticket count unchanged", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext, apiKey } = await issueApiKey({ userId: owner.id, name: "k" });
    await db.update(apiKeys).set({ permissions: [] }).where(eq(apiKeys.id, apiKey.id));
    const before = await ticketCount();
    const res = await mcp(plaintext, CREATE_CALL);
    expect(res.status).toBe(403);
    expect(await ticketCount()).toBe(before);
  });

  it("a key whose permissions column is NULL is refused (403), not an error (R50: the column has no database default)", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext, apiKey } = await issueApiKey({ userId: owner.id, name: "k" });
    await db.update(apiKeys).set({ permissions: null }).where(eq(apiKeys.id, apiKey.id));
    const before = await ticketCount();
    const res = await mcp(plaintext, CREATE_CALL);
    expect(res.status).toBe(403);
    expect(res.headers["www-authenticate"]).toMatch(/insufficient_scope/);
    expect(await ticketCount()).toBe(before);
  });

  it("a session cookie alone is refused for MCP (401 + Bearer)", async () => {
    const owner = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, owner);
    const before = await ticketCount();
    const res = await agent
      .post("/api/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send(CREATE_CALL);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
    expect(await ticketCount()).toBe(before);
  });

  it("the same key works on GET /api/auth/user", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const res = await request(ctx.app)
      .get("/api/auth/user")
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", `Bearer ${plaintext}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(owner.id);
  });

  it("GET and DELETE are 405", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    for (const method of ["get", "delete"] as const) {
      const req = request(ctx.app);
      const res = await req[method]("/api/mcp")
        .set("X-Forwarded-For", freshIp())
        .set("Authorization", `Bearer ${plaintext}`);
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("POST");
    }
  });

  it("a tool error is an isError result with a code and no stack", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const res = await mcp(plaintext, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_ticket", arguments: { id: 999999 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(JSON.parse(res.body.result.content[0].text).code).toBe("NOT_FOUND");
    expect(res.text).not.toMatch(/\n\s+at /);
  });

  it("creates a ticket as the key owner", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const res = await mcp(plaintext, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "create_ticket", arguments: { title: "via mcp", category: "support" } },
    });
    expect(res.body.result.isError).toBeFalsy();
    const created = JSON.parse(res.body.result.content[0].text);
    expect(created.createdBy).toBe(owner.id);
    expect((await storage.getTask(created.id))?.title).toBe("via mcp");
  });
});

describe("MCP status-change audit", () => {
  it("a customer's refused close_ticket is FORBIDDEN and writes a change_status SECURITY_AUDIT line", async () => {
    const customer = await createUser({ role: "customer" });
    const task = await storage.createTask({
      title: "mine",
      category: "support",
      createdBy: customer.id,
    } as never);
    const { plaintext } = await issueApiKey({ userId: customer.id, name: "k" });
    const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    let res;
    let calls: unknown[][];
    try {
      res = await mcp(plaintext, {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "close_ticket", arguments: { id: task.id } },
      });
    } finally {
      calls = [...spy.mock.calls];
      spy.mockRestore();
    }
    expect(res.body.result.isError).toBe(true);
    expect(JSON.parse(res.body.result.content[0].text).code).toBe("FORBIDDEN");
    const lines = calls
      .filter((c) => c[0] === "SECURITY_AUDIT:")
      .map((c) => JSON.parse(String(c[1])));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      action: "change_status",
      resource: "ticket",
      success: false,
      details: { userId: customer.id, from: "open", to: "closed", taskId: task.id, channel: "mcp" },
    });
    expect((await storage.getTask(task.id))?.status).toBe("open");
  });

  it("the audit line carries the caller's IP, not a literal 'mcp' (R60)", async () => {
    const customer = await createUser({ role: "customer" });
    const task = await storage.createTask({ title: "mine", category: "support", createdBy: customer.id } as never);
    const { plaintext } = await issueApiKey({ userId: customer.id, name: "k" });
    const callerIp = "198.51.100.222";
    const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    let calls: unknown[][];
    try {
      await request(ctx.app)
        .post("/api/mcp")
        .set("X-Forwarded-For", callerIp)
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", `Bearer ${plaintext}`)
        .send({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "close_ticket", arguments: { id: task.id } },
        });
    } finally {
      calls = [...spy.mock.calls];
      spy.mockRestore();
    }
    const lines = calls.filter((c) => c[0] === "SECURITY_AUDIT:").map((c) => JSON.parse(String(c[1])));
    expect(lines).toHaveLength(1);
    expect(lines[0].ip).toBe(callerIp);
    expect(lines[0].details.channel).toBe("mcp");
  });
});
