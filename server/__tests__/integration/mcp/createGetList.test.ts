import { eq } from "drizzle-orm";
import { tasks, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { storage } from "../../../storage";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createTeam, createUser, loginAs } from "../helpers/fixtures";
import { mcpFor, type McpCaller } from "../helpers/mcpClient";
import { findSecrets } from "../helpers/noSecrets";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
type Role = "customer" | "agent" | "manager" | "admin";
const ROLES: Role[] = ["customer", "agent", "manager", "admin"];

let users: Record<Role, User>;
let other: User; // a second customer
let mcp: Record<Role, McpCaller>;
let rest: Record<Role, Awaited<ReturnType<typeof loginAs>>>;
let ticketIds: number[] = [];

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  users = {
    customer: await createUser({ role: "customer" }),
    agent: await createUser({ role: "agent" }),
    manager: await createUser({ role: "manager" }),
    admin: await createUser({ role: "admin" }),
  };
  other = await createUser({ role: "customer" });
  const team = await createTeam(users.manager);
  await storage.addTeamMember({ teamId: team.id, userId: users.agent.id } as never);
  mcp = {} as never;
  rest = {} as never;
  for (const r of ROLES) {
    mcp[r] = await mcpFor(ctx.app, users[r]);
    rest[r] = await loginAs(ctx.app, users[r]);
  }
  // 14 tickets: mixed creators, statuses, categories, priorities and assignees.
  const creators = [users.customer, other, users.agent, users.manager, users.admin];
  const statuses = ["open", "in_progress", "resolved", "closed"];
  const categories = ["bug", "support", "feature"];
  const priorities = ["low", "medium", "high", "urgent"];
  ticketIds = [];
  for (let i = 0; i < 14; i++) {
    const t = await storage.createTask({
      title: `Parity ${i}`,
      category: categories[i % 3],
      priority: priorities[i % 4],
      status: statuses[i % 4],
      createdBy: creators[i % 5].id,
      assigneeId: i % 3 === 0 ? users.agent.id : null,
      assigneeType: "user",
    } as never);
    ticketIds.push(t.id);
  }
});

describe("create_ticket (M3)", () => {
  it("creates a ticket as the caller, visible over REST", async () => {
    const res = await mcp.customer.call("create_ticket", {
      title: "Printer on fire",
      category: "support",
      priority: "high",
    });
    expect(res.isError).toBe(false);
    expect(res.data.ticketNumber).toEqual(expect.any(String));
    expect(res.data.createdBy).toBe(users.customer.id);
    expect(res.data.status).toBe("open");
    const got = await rest.customer.get(`/api/tasks/${res.data.id}`);
    expect(got.status).toBe(200);
    expect(got.body.title).toBe("Printer on fire");
    expect(got.body.ticketNumber).toBe(res.data.ticketNumber);
  });

  it("invalid priority: VALIDATION and no row", async () => {
    const before = (await db.select().from(tasks)).length;
    const res = await mcp.agent.call("create_ticket", { title: "bad", category: "support", priority: "asap" });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("VALIDATION");
    expect((await db.select().from(tasks)).length).toBe(before);
  });

  it("a status in the body is refused (server-owned), no row", async () => {
    const before = (await db.select().from(tasks)).length;
    const res = await mcp.agent.call("create_ticket", { title: "x", category: "support", status: "closed" });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("VALIDATION");
    expect((await db.select().from(tasks)).length).toBe(before);
  });
});

describe("get_ticket parity with GET /api/tasks/:id (M4)", () => {
  it.each(ROLES)("%s: same body for visible tickets, same refusal for the rest", async (role) => {
    let seen200 = 0;
    for (const id of ticketIds) {
      const r = await rest[role].get(`/api/tasks/${id}`);
      const m = await mcp[role].call("get_ticket", { id });
      if (r.status === 200) {
        seen200++;
        expect(m.isError).toBe(false);
        expect(m.data).toEqual(JSON.parse(JSON.stringify(r.body)));
      } else {
        expect(m.isError).toBe(true);
        expect(m.data.code).toBe(r.status === 403 ? "FORBIDDEN" : "NOT_FOUND");
      }
    }
    expect(seen200).toBeGreaterThan(0);
  });

  it("unknown id: NOT_FOUND; non-positive id: VALIDATION", async () => {
    expect((await mcp.admin.call("get_ticket", { id: 999999 })).data.code).toBe("NOT_FOUND");
    expect((await mcp.admin.call("get_ticket", { id: 0 })).data.code).toBe("VALIDATION");
  });

  it("includeComments returns the comments", async () => {
    await mcp.admin.call("add_comment", { id: ticketIds[0], content: "hello there" });
    const m = await mcp.admin.call("get_ticket", { id: ticketIds[0], includeComments: true });
    expect(m.data.comments.map((c: { content: string }) => c.content)).toContain("hello there");
  });
});

const FILTERS = (agentId: string): Record<string, unknown>[] => [
  {},
  { status: "open" },
  { status: "closed" },
  { category: "bug" },
  { priority: "high" },
  { assigneeId: agentId },
  { status: "open", category: "bug" },
  { limit: 3 },
  { limit: 3, offset: 3 },
  { limit: 5, offset: 100 },
  { status: "in_progress", limit: 2, offset: 1 },
  { assigneeId: agentId, limit: 2, offset: 1 },
];

describe("list_tickets parity with GET /api/tasks (M5)", () => {
  it.each(ROLES)("%s: same ids in the same order across every filter, limit and offset", async (role) => {
    for (const f of FILTERS(users.agent.id)) {
      const qs = new URLSearchParams(Object.entries(f).map(([k, v]) => [k, String(v)])).toString();
      const r = await rest[role].get(`/api/tasks?${qs}`);
      expect(r.status).toBe(200);
      const m = await mcp[role].call("list_tickets", f);
      expect(m.isError).toBe(false);
      expect(m.data.tickets.map((t: { id: number }) => t.id)).toEqual(r.body.map((t: { id: number }) => t.id));
      expect(m.data.returned).toBe(m.data.tickets.length);
    }
  });

  it.each(ROLES)("%s: total equals the REST count and paging reaches every row", async (role) => {
    const all = await rest[role].get("/api/tasks");
    const first = await mcp[role].call("list_tickets", { limit: 4 });
    expect(first.data.total).toBe(all.body.length);
    expect(first.data.hasMore).toBe(all.body.length > 4);
    const seen: number[] = [];
    let offset = 0;
    for (let guard = 0; guard < 20; guard++) {
      const p = await mcp[role].call("list_tickets", { limit: 4, offset });
      seen.push(...p.data.tickets.map((t: { id: number }) => t.id));
      if (!p.data.hasMore) break;
      offset += p.data.returned;
    }
    expect(seen).toEqual(all.body.map((t: { id: number }) => t.id));
  });

  it("an invented status is VALIDATION, never an empty list", async () => {
    const res = await mcp.admin.call("list_tickets", { status: "Waiting for Review" });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("VALIDATION");
    expect(res.data.tickets).toBeUndefined();
  });

  it("bad limit, offset, category and priority are VALIDATION", async () => {
    for (const bad of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { category: "nonsense" }, { priority: "asap" }]) {
      const res = await mcp.admin.call("list_tickets", bad);
      expect(res.data.code).toBe("VALIDATION");
    }
  });

  it("customers see other users by name only (R19): no staff emails or secrets in any output", async () => {
    await db.update(tasks).set({ createdBy: users.customer.id, assigneeId: users.agent.id, assigneeType: "user" }).where(eq(tasks.id, ticketIds[0]));
    await mcp.agent.call("add_comment", { id: ticketIds[0], content: "staff note" });
    const list = await mcp.customer.call("list_tickets", {});
    const one = await mcp.customer.call("get_ticket", { id: ticketIds[0], includeComments: true });
    expect(one.data.comments.length).toBeGreaterThan(0);
    for (const out of [list, one]) {
      expect(out.raw).not.toContain(users.agent.email);
      expect(out.raw).not.toContain(users.manager.email);
      expect(out.raw).not.toContain(users.admin.email);
      expect(findSecrets(out.data)).toEqual([]);
    }
  });
});
