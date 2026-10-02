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
  it("lists the eight tools for a valid key and sets no cookie and no session row", async () => {
    const owner = await createUser({ role: "agent" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const before = (await db.select().from(sessions)).length;
    const res = await mcp(plaintext);
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "add_comment",
      "close_ticket",
      "create_ticket",
      "delete_ticket",
      "get_ticket",
      "list_tickets",
      "reopen_ticket",
      "update_ticket",
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
