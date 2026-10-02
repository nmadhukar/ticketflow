import { eq } from "drizzle-orm";
import { taskComments, taskHistory, tasks, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { storage } from "../../../storage";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";
import { mcpFor, type McpCaller } from "../helpers/mcpClient";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let customer: User;
let stranger: User;
let agent: User;
let manager: User;
let admin: User;
let mcp: Record<"customer" | "stranger" | "agent" | "manager" | "admin", McpCaller>;
const savedFlag = process.env.ALLOW_MANAGER_DELETE;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  delete process.env.ALLOW_MANAGER_DELETE;
  customer = await createUser({ role: "customer" });
  stranger = await createUser({ role: "customer" });
  agent = await createUser({ role: "agent" });
  manager = await createUser({ role: "manager" });
  admin = await createUser({ role: "admin" });
  mcp = {
    customer: await mcpFor(ctx.app, customer),
    stranger: await mcpFor(ctx.app, stranger),
    agent: await mcpFor(ctx.app, agent),
    manager: await mcpFor(ctx.app, manager),
    admin: await mcpFor(ctx.app, admin),
  };
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env.ALLOW_MANAGER_DELETE;
  else process.env.ALLOW_MANAGER_DELETE = savedFlag;
});

/** A ticket every role below can see: created by the customer, assigned to the agent and the manager creates none. */
async function ticket(createdBy: User = customer, assignee: User | null = agent) {
  return storage.createTask({
    title: "Doomed",
    category: "support",
    createdBy: createdBy.id,
    assigneeId: assignee?.id ?? null,
    assigneeType: "user",
  } as never);
}

const exists = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id))).length === 1;
const commentCount = async (id: number) =>
  (await db.select().from(taskComments).where(eq(taskComments.taskId, id))).length;

describe("delete_ticket (M8)", () => {
  it("without confirm: VALIDATION and the ticket remains", async () => {
    const t = await ticket();
    for (const args of [{ id: t.id }, { id: t.id, confirm: false }]) {
      const res = await mcp.admin.call("delete_ticket", args);
      expect(res.isError).toBe(true);
      expect(res.data.code).toBe("VALIDATION");
    }
    expect(await exists(t.id)).toBe(true);
  });

  it("a confirm that is not literally true (a string) never deletes", async () => {
    const t = await ticket();
    const res = await mcp.admin.call("delete_ticket", { id: t.id, confirm: "true" });
    expect(res.isError).toBe(true);
    expect(await exists(t.id)).toBe(true);
  });

  it("admin with confirm: deleted, comments and history gone, REST GET is 404", async () => {
    const t = await ticket();
    await mcp.agent.call("add_comment", { id: t.id, content: "bye" });
    const res = await mcp.admin.call("delete_ticket", { id: t.id, confirm: true });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ deleted: true, id: t.id, ticketNumber: t.ticketNumber });
    expect(await exists(t.id)).toBe(false);
    expect(await commentCount(t.id)).toBe(0);
    expect((await db.select().from(taskHistory).where(eq(taskHistory.taskId, t.id))).length).toBe(0);
    const rest = await loginAs(ctx.app, admin);
    expect((await rest.get(`/api/tasks/${t.id}`)).status).toBe(404);
  });

  it.each(["agent", "customer", "manager"] as const)("%s with confirm (flag off): FORBIDDEN, ticket remains", async (who) => {
    const t = await ticket(who === "manager" ? manager : customer, agent);
    // The manager can see only what they created or oversee; make the ticket theirs.
    const res = await mcp[who].call("delete_ticket", { id: t.id, confirm: true });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("FORBIDDEN");
    expect(await exists(t.id)).toBe(true);
  });

  it("manager with confirm and ALLOW_MANAGER_DELETE=true: deleted", async () => {
    process.env.ALLOW_MANAGER_DELETE = "true";
    const t = await ticket(manager, null);
    const res = await mcp.manager.call("delete_ticket", { id: t.id, confirm: true });
    expect(res.isError).toBe(false);
    expect(await exists(t.id)).toBe(false);
  });

  it("flag on does not help an agent or a customer", async () => {
    process.env.ALLOW_MANAGER_DELETE = "true";
    const t = await ticket();
    expect((await mcp.agent.call("delete_ticket", { id: t.id, confirm: true })).data.code).toBe("FORBIDDEN");
    expect((await mcp.customer.call("delete_ticket", { id: t.id, confirm: true })).data.code).toBe("FORBIDDEN");
    expect(await exists(t.id)).toBe(true);
  });

  it("unknown id: NOT_FOUND", async () => {
    expect((await mcp.admin.call("delete_ticket", { id: 999999, confirm: true })).data.code).toBe("NOT_FOUND");
  });
});

describe("add_comment (M9)", () => {
  it("is visible in GET /api/tasks/:id/comments and attributed to the caller", async () => {
    const t = await ticket();
    const res = await mcp.agent.call("add_comment", { id: t.id, content: "  on it  " });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ taskId: t.id, userId: agent.id, content: "on it" });
    const rest = await loginAs(ctx.app, customer);
    const list = await rest.get(`/api/tasks/${t.id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.map((c: { content: string }) => c.content)).toEqual(["on it"]);
  });

  it("the customer who owns the ticket may comment", async () => {
    const t = await ticket();
    const res = await mcp.customer.call("add_comment", { id: t.id, content: "thanks" });
    expect(res.isError).toBe(false);
    expect(res.data.userId).toBe(customer.id);
  });

  it("empty, blank and over-long content: VALIDATION, no row", async () => {
    const t = await ticket();
    for (const content of ["", "   ", "x".repeat(10001)]) {
      const res = await mcp.agent.call("add_comment", { id: t.id, content });
      expect(res.data.code).toBe("VALIDATION");
    }
    expect(await commentCount(t.id)).toBe(0);
  });

  it("an inaccessible ticket: FORBIDDEN, no row; unknown ticket: NOT_FOUND", async () => {
    const t = await ticket();
    const res = await mcp.stranger.call("add_comment", { id: t.id, content: "let me in" });
    expect(res.data.code).toBe("FORBIDDEN");
    expect(await commentCount(t.id)).toBe(0);
    expect((await mcp.admin.call("add_comment", { id: 999999, content: "x" })).data.code).toBe("NOT_FOUND");
  });
});
