/**
 * Manager check: only an admin may see every customer's tickets, and no customer may see
 * another customer's tickets - on BOTH channels:
 *   - the UI, which is the REST surface (GET /api/tasks, /api/tasks/:id, .../comments, .../history)
 *   - Copilot chat, which reaches the same rules over MCP (list_tickets, get_ticket) acting as
 *     the signed-in customer (server/mcp/actAs.ts).
 *
 * John and Wick are customers. Each creates one ticket; the admin must see both, and neither
 * customer may see (or even learn about) the other's ticket or its details.
 */
import type { User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, createTicketAs, loginAs } from "./helpers/fixtures";
import { mcpFor, type McpCaller } from "./helpers/mcpClient";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: User;
let john: User;
let wick: User;
let rest: Record<"admin" | "john" | "wick", Awaited<ReturnType<typeof loginAs>>>;
let mcp: Record<"admin" | "john" | "wick", McpCaller>;
let johnTicket: number;
let wickTicket: number;

const JOHN_TICKET = "John: laptop will not boot";
const WICK_TICKET = "Wick: badge reader at the garage";

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDb();
  admin = await createUser({ role: "admin", email: "admin@example.test" });
  john = await createUser({ role: "customer", email: "john@example.test" });
  wick = await createUser({ role: "customer", email: "wick@example.test" });

  rest = {
    admin: await loginAs(ctx.app, admin),
    john: await loginAs(ctx.app, john),
    wick: await loginAs(ctx.app, wick),
  };
  mcp = {
    admin: await mcpFor(ctx.app, admin),
    john: await mcpFor(ctx.app, john),
    wick: await mcpFor(ctx.app, wick),
  };

  // Each customer creates their own ticket through the UI (POST /api/tasks).
  const j = await createTicketAs(rest.john, { title: JOHN_TICKET, description: "John's private details" });
  const w = await createTicketAs(rest.wick, { title: WICK_TICKET, description: "Wick's private details" });
  expect(j.status).toBe(201);
  expect(w.status).toBe(201);
  johnTicket = j.body.id;
  wickTicket = w.body.id;
});

describe("UI (REST) isolation between customers", () => {
  it("the admin's list shows both customers' tickets", async () => {
    const res = await rest.admin.get("/api/tasks");
    expect(res.status).toBe(200);
    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(johnTicket);
    expect(ids).toContain(wickTicket);
  });

  it("John's list shows his ticket and NOT Wick's", async () => {
    const res = await rest.john.get("/api/tasks");
    expect(res.status).toBe(200);
    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(johnTicket);
    expect(ids).not.toContain(wickTicket);
  });

  it("Wick's list shows his ticket and NOT John's", async () => {
    const res = await rest.wick.get("/api/tasks");
    expect(res.status).toBe(200);
    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(wickTicket);
    expect(ids).not.toContain(johnTicket);
  });

  it("a customer cannot open the other customer's ticket or its details", async () => {
    for (const path of [`/api/tasks/${wickTicket}`, `/api/tasks/${wickTicket}/comments`, `/api/tasks/${wickTicket}/history`]) {
      const res = await rest.john.get(path);
      expect([403, 404]).toContain(res.status);
    }
    for (const path of [`/api/tasks/${johnTicket}`, `/api/tasks/${johnTicket}/comments`, `/api/tasks/${johnTicket}/history`]) {
      const res = await rest.wick.get(path);
      expect([403, 404]).toContain(res.status);
    }
  });

  it("a customer can still open their own ticket (no over-blocking)", async () => {
    expect((await rest.john.get(`/api/tasks/${johnTicket}`)).status).toBe(200);
    expect((await rest.wick.get(`/api/tasks/${wickTicket}`)).status).toBe(200);
    expect((await rest.admin.get(`/api/tasks/${wickTicket}`)).status).toBe(200);
  });

  it("search by the other customer's wording finds nothing", async () => {
    const res = await rest.john.get("/api/tasks?search=Wick");
    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: number }) => t.id)).not.toContain(wickTicket);
  });

  it("requesting another user's assignee filter cannot widen the list", async () => {
    const res = await rest.john.get(`/api/tasks?assigneeId=${wick.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("a customer cannot update or delete the other's ticket (403/404)", async () => {
    expect([403, 404]).toContain((await rest.john.patch(`/api/tasks/${wickTicket}`).send({ priority: "urgent" })).status);
    expect([403, 404]).toContain((await rest.wick.delete(`/api/tasks/${johnTicket}`)).status);
  });
});

describe("Copilot chat (MCP) isolation between customers", () => {
  it("the admin sees both customers' tickets over list_tickets", async () => {
    const res = await mcp.admin.call("list_tickets", { limit: 100 });
    expect(res.isError).toBe(false);
    const ids = res.data.tickets.map((t: { id: number }) => t.id);
    expect(ids).toContain(johnTicket);
    expect(ids).toContain(wickTicket);
  });

  it("John's list_tickets shows his ticket and NOT Wick's", async () => {
    const res = await mcp.john.call("list_tickets", { limit: 100 });
    expect(res.isError).toBe(false);
    const ids = res.data.tickets.map((t: { id: number }) => t.id);
    expect(ids).toContain(johnTicket);
    expect(ids).not.toContain(wickTicket);
    expect(res.raw).not.toContain(WICK_TICKET);
  });

  it("Wick's list_tickets shows his ticket and NOT John's", async () => {
    const res = await mcp.wick.call("list_tickets", { limit: 100 });
    expect(res.isError).toBe(false);
    const ids = res.data.tickets.map((t: { id: number }) => t.id);
    expect(ids).toContain(wickTicket);
    expect(ids).not.toContain(johnTicket);
    expect(res.raw).not.toContain(JOHN_TICKET);
  });

  it("a customer cannot get_ticket on the other's ticket (refused, and no details leak)", async () => {
    const byId = await mcp.john.call("get_ticket", { id: wickTicket, includeComments: true });
    expect(byId.isError).toBe(true);
    expect(["FORBIDDEN", "NOT_FOUND"]).toContain(byId.data.code);
    expect(byId.raw).not.toContain(WICK_TICKET);

    const byNumber = await mcp.wick.call("get_ticket", { id: (await mcp.admin.call("get_ticket", { id: johnTicket })).data.ticketNumber });
    expect(byNumber.isError).toBe(true);
    expect(["FORBIDDEN", "NOT_FOUND"]).toContain(byNumber.data.code);
    expect(byNumber.raw).not.toContain(JOHN_TICKET);
  });

  it("customers can still use the copilot on their own tickets", async () => {
    expect((await mcp.john.call("get_ticket", { id: johnTicket })).isError).toBe(false);
    expect((await mcp.wick.call("get_ticket", { id: wickTicket })).isError).toBe(false);
    expect((await mcp.admin.call("get_ticket", { id: wickTicket })).isError).toBe(false);
  });

  it("a ticket the copilot creates belongs to the signed-in customer only", async () => {
    const created = await mcp.john.call("create_ticket", { title: "John via copilot", category: "support" });
    expect(created.isError).toBe(false);
    const newId = created.data.id as number;

    expect((await mcp.john.call("get_ticket", { id: newId })).isError).toBe(false);
    expect((await mcp.wick.call("get_ticket", { id: newId })).isError).toBe(true);
    expect((await mcp.admin.call("get_ticket", { id: newId })).isError).toBe(false);

    const wickList = await mcp.wick.call("list_tickets", { limit: 100 });
    expect(wickList.data.tickets.map((t: { id: number }) => t.id)).not.toContain(newId);
  });
});
