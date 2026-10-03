import { asc, eq } from "drizzle-orm";
import { taskHistory, tasks, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { storage } from "../../../storage";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";
import { mcpFor, type McpCaller } from "../helpers/mcpClient";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let customer: User;
let stranger: User; // another customer
let agent: User;
let admin: User;
let mcp: Record<"customer" | "stranger" | "agent" | "admin", McpCaller>;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  customer = await createUser({ role: "customer" });
  stranger = await createUser({ role: "customer" });
  agent = await createUser({ role: "agent" });
  admin = await createUser({ role: "admin" });
  mcp = {
    customer: await mcpFor(ctx.app, customer),
    stranger: await mcpFor(ctx.app, stranger),
    agent: await mcpFor(ctx.app, agent),
    admin: await mcpFor(ctx.app, admin),
  };
});

/** A ticket created by the customer and assigned to the agent. */
async function ticket(overrides: Record<string, unknown> = {}) {
  return storage.createTask({
    title: "Original",
    description: "Original description",
    category: "support",
    priority: "medium",
    createdBy: customer.id,
    assigneeId: agent.id,
    assigneeType: "user",
    ...overrides,
  } as never);
}

async function historyOf(id: number) {
  const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id)).orderBy(asc(taskHistory.id));
  return rows.map((r) => ({ userId: r.userId, action: r.action, field: r.field, oldValue: r.oldValue, newValue: r.newValue }));
}

async function row(id: number) {
  const [r] = await db.select().from(tasks).where(eq(tasks.id, id));
  return r;
}

describe("update_ticket (M6)", () => {
  it("changes only the supplied fields", async () => {
    const t = await ticket();
    const res = await mcp.agent.call("update_ticket", { id: t.id, priority: "urgent" });
    expect(res.isError).toBe(false);
    expect(res.data.appliedFields).toEqual(["priority"]);
    expect(res.data.ignoredFields).toEqual([]);
    const after = await row(t.id);
    expect(after.priority).toBe("urgent");
    expect(after.title).toBe("Original");
    expect(after.description).toBe("Original description");
    expect(after.assigneeId).toBe(agent.id);
  });

  it.each([
    ["agent", { priority: "high", notes: "looked at it", status: "in_progress" }],
    ["admin", { title: "Renamed", priority: "low", status: "in_progress", estimatedHours: 3 }],
    ["customer", { title: "Customer rename", description: "more detail" }],
  ] as const)("%s: writes the same task_history rows as a REST PATCH on a twin ticket", async (who, patch) => {
    const a = await ticket();
    const b = await ticket();
    const who2user = { agent, admin, customer }[who];
    const restAgent = await loginAs(ctx.app, who2user);
    const r = await restAgent.patch(`/api/tasks/${a.id}`).send(patch);
    expect(r.status).toBe(200);
    const m = await mcp[who].call("update_ticket", { id: b.id, ...patch });
    expect(m.isError).toBe(false);
    expect(await historyOf(b.id)).toEqual(await historyOf(a.id));
    expect((await historyOf(b.id)).length).toBeGreaterThan(0);
    const ra = await row(a.id);
    const rb = await row(b.id);
    for (const k of Object.keys(patch)) expect((rb as never)[k]).toEqual((ra as never)[k]);
  });

  it("reports ignoredFields for fields the role may not change, and leaves them alone", async () => {
    const t = await ticket();
    const res = await mcp.customer.call("update_ticket", {
      id: t.id,
      title: "Mine now",
      assigneeId: customer.id,
      priority: "urgent",
    });
    expect(res.isError).toBe(false);
    expect(res.data.appliedFields).toEqual(["title"]);
    expect([...res.data.ignoredFields].sort()).toEqual(["assigneeId", "priority"]);
    const after = await row(t.id);
    expect(after.title).toBe("Mine now");
    expect(after.assigneeId).toBe(agent.id);
    expect(after.priority).toBe("medium");
  });

  it("a customer naming staff-only effort hours is FORBIDDEN (as over REST), nothing written", async () => {
    const t = await ticket();
    const res = await mcp.customer.call("update_ticket", { id: t.id, title: "x", estimatedHours: 9 });
    expect(res.data.code).toBe("FORBIDDEN");
    expect((await row(t.id)).title).toBe("Original");
  });

  it("a bad value is VALIDATION and changes nothing", async () => {
    const t = await ticket();
    const historyBefore = await historyOf(t.id);
    const res = await mcp.agent.call("update_ticket", { id: t.id, priority: "asap" });
    expect(res.data.code).toBe("VALIDATION");
    expect((await row(t.id)).priority).toBe("medium");
    expect(await historyOf(t.id)).toEqual(historyBefore);
  });

  it("an invented status is VALIDATION", async () => {
    const t = await ticket();
    const res = await mcp.agent.call("update_ticket", { id: t.id, status: "Waiting for Review" });
    expect(res.isError).toBe(true);
    expect(["VALIDATION", "INVALID_STATE"]).toContain(res.data.code);
    expect((await row(t.id)).status).toBe("open");
  });

  it("another customer's ticket is FORBIDDEN, unknown is NOT_FOUND", async () => {
    const t = await ticket();
    expect((await mcp.stranger.call("update_ticket", { id: t.id, title: "hijack" })).data.code).toBe("FORBIDDEN");
    expect((await row(t.id)).title).toBe("Original");
    expect((await mcp.admin.call("update_ticket", { id: 999999, title: "x" })).data.code).toBe("NOT_FOUND");
  });
});

describe("close_ticket and reopen_ticket (M7)", () => {
  it.each(["agent", "admin"] as const)("%s closes a ticket; closedAt is set", async (who) => {
    const t = await ticket();
    const res = await mcp[who].call("close_ticket", { id: t.id });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("closed");
    expect((await row(t.id)).closedAt).not.toBeNull();
  });

  it("closing twice: the second is INVALID_STATE and writes nothing more", async () => {
    const t = await ticket();
    expect((await mcp.agent.call("close_ticket", { id: t.id })).isError).toBe(false);
    const historyBefore = await historyOf(t.id);
    const second = await mcp.agent.call("close_ticket", { id: t.id });
    expect(second.isError).toBe(true);
    expect(second.data.code).toBe("INVALID_STATE");
    expect(await historyOf(t.id)).toEqual(historyBefore);
  });

  it("a customer cannot close, even their own ticket (FORBIDDEN, status unchanged)", async () => {
    const t = await ticket();
    const res = await mcp.customer.call("close_ticket", { id: t.id });
    expect(res.data.code).toBe("FORBIDDEN");
    expect((await row(t.id)).status).toBe("open");
  });

  it("the creating customer reopens: open again, resolvedAt and closedAt cleared", async () => {
    const t = await ticket();
    await mcp.agent.call("update_ticket", { id: t.id, status: "in_progress" });
    await mcp.agent.call("update_ticket", { id: t.id, status: "resolved" });
    await mcp.agent.call("close_ticket", { id: t.id });
    const closed = await row(t.id);
    expect(closed.closedAt).not.toBeNull();
    const res = await mcp.customer.call("reopen_ticket", { id: t.id });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("open");
    const after = await row(t.id);
    expect(after.status).toBe("open");
    expect(after.resolvedAt).toBeNull();
    expect(after.closedAt).toBeNull();
  });

  it("staff reopen a closed ticket", async () => {
    const t = await ticket();
    await mcp.admin.call("close_ticket", { id: t.id });
    const res = await mcp.agent.call("reopen_ticket", { id: t.id });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("open");
  });

  it("another customer cannot reopen (FORBIDDEN, still closed)", async () => {
    const t = await ticket();
    await mcp.admin.call("close_ticket", { id: t.id });
    const res = await mcp.stranger.call("reopen_ticket", { id: t.id });
    expect(res.data.code).toBe("FORBIDDEN");
    expect((await row(t.id)).status).toBe("closed");
  });

  it("reopening an open ticket is INVALID_STATE", async () => {
    const t = await ticket();
    const res = await mcp.customer.call("reopen_ticket", { id: t.id });
    expect(res.data.code).toBe("INVALID_STATE");
  });

  it("unknown ticket: NOT_FOUND", async () => {
    expect((await mcp.admin.call("close_ticket", { id: 999999 })).data.code).toBe("NOT_FOUND");
    expect((await mcp.admin.call("reopen_ticket", { id: 999999 })).data.code).toBe("NOT_FOUND");
  });
});
