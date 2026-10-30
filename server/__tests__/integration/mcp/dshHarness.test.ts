import request from "supertest";
import { MCP_INSTRUCTIONS } from "../../../mcp/server";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";
import { mcpFor } from "../helpers/mcpClient";

/**
 * Phase 3: a DeepSeek Harness drives TicketFlow over the same MCP surface a normal
 * client uses. These checks follow the exact order the wiring kit documents, so a
 * regression in the handshake, the instructions or the tool discovery is caught
 * without the harness itself: initialize, tools/list, then a read-only tools/call
 * whose answer matches the owner's REST answer.
 */

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
});

/** The JSON-RPC envelope every harness request carries, as the kit's cordis entry sends it. */
function rpc(key: string, method: string, params: object) {
  return request(ctx.app)
    .post("/api/mcp")
    .set("Authorization", `Bearer ${key}`)
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json")
    .send({ jsonrpc: "2.0", id: 1, method, params });
}

describe("DeepSeek Harness handshake over /api/mcp", () => {
  it("initialize reports the ticketflow server and its document-search instructions", async () => {
    const owner = await createUser({ role: "agent" });
    const { key } = await mcpFor(ctx.app, owner);
    const res = await rpc(key, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "deepseek-harness", version: "1.0.0" },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe("ticketflow");
    expect(res.body.result.instructions).toBe(MCP_INSTRUCTIONS);
    expect(res.body.result.instructions).toMatch(/search_documents/);
  });

  it("tools/list advertises the ticket tools with an object schema each", async () => {
    const owner = await createUser({ role: "agent" });
    const { key } = await mcpFor(ctx.app, owner);
    const res = await rpc(key, "tools/list", {});
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<{ name: string; inputSchema: { type: string } }>;
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_tickets", "get_ticket", "create_ticket"]));
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
  });

  it("a read-only list_tickets call matches the owner's REST answer", async () => {
    const agent = await createUser({ role: "agent" });
    const mcp = await mcpFor(ctx.app, agent);
    const session = await loginAs(ctx.app, agent);

    const created = await session
      .post("/api/tasks")
      .send({ title: "Printer offline", description: "Floor 2 printer queue is stuck", category: "support" });
    expect(created.status).toBe(201);

    const rest = await session.get("/api/tasks");
    expect(rest.status).toBe(200);
    const restTitles = (rest.body as Array<{ title: string }>).map((t) => t.title);

    const call = await mcp.call("list_tickets", { limit: 100, offset: 0 });
    expect(call.isError).toBe(false);
    const mcpTitles = (call.data.tickets as Array<{ title: string }>).map((t) => t.title);
    expect(mcpTitles).toEqual(restTitles);
    expect(mcpTitles).toContain("Printer offline");
  });

  it("an invalid key is refused before any tool runs", async () => {
    const res = await rpc("tfk_" + "0".repeat(40), "tools/list", {});
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
  });
});