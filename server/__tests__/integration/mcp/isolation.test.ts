import { eq } from "drizzle-orm";
import { taskComments, taskHistory, tasks, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { storage } from "../../../storage";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser } from "../helpers/fixtures";
import { callTool, mcpFor, type McpCaller } from "../helpers/mcpClient";
import { findSecrets } from "../helpers/noSecrets";

/**
 * Isolation matrix for the eight MCP tools. A is a customer with a ticket; B is
 * another customer and U an agent with no link to A's ticket. Neither may read,
 * change, close, reopen, comment on or delete it, and nothing they get back may
 * carry its title or number. Every tool also gets its success, validation,
 * unauthenticated, forbidden and not-found case.
 */

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let A: User;
let B: User;
let U: User;
let admin: User;
let agent: User; // assigned to A's ticket
let mcp: Record<"A" | "B" | "U" | "admin" | "agent", McpCaller>;
let ticketId: number;
let ticketNumber: string;
const WORD = "zyxwvuniqueword";
const TITLE = `Secret ${WORD}`;
const outputs: unknown[] = [];

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  A = await createUser({ role: "customer" });
  B = await createUser({ role: "customer" });
  U = await createUser({ role: "agent" });
  agent = await createUser({ role: "agent" });
  admin = await createUser({ role: "admin" });
  mcp = {
    A: await mcpFor(ctx.app, A),
    B: await mcpFor(ctx.app, B),
    U: await mcpFor(ctx.app, U),
    admin: await mcpFor(ctx.app, admin),
    agent: await mcpFor(ctx.app, agent),
  };
  const t = await storage.createTask({
    title: TITLE,
    description: `Body with ${WORD}`,
    category: "support",
    createdBy: A.id,
    assigneeId: agent.id,
    assigneeType: "user",
  } as never);
  ticketId = t.id;
  ticketNumber = t.ticketNumber;
});

async function snapshot() {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, ticketId));
  return {
    row: JSON.stringify(row),
    comments: (await db.select().from(taskComments).where(eq(taskComments.taskId, ticketId))).length,
    history: (await db.select().from(taskHistory).where(eq(taskHistory.taskId, ticketId))).length,
    tickets: (await db.select().from(tasks)).length,
  };
}

async function run(caller: McpCaller, name: string, args: object) {
  const res = await caller.call(name, args);
  outputs.push(res.data);
  return res;
}

/** The six tools that act on one ticket, with the arguments an intruder would send. */
const ID_TOOLS: Array<[string, (id: number) => object]> = [
  ["get_ticket", (id) => ({ id, includeComments: true })],
  ["update_ticket", (id) => ({ id, title: "hijacked", priority: "urgent" })],
  ["close_ticket", (id) => ({ id })],
  ["reopen_ticket", (id) => ({ id })],
  ["delete_ticket", (id) => ({ id, confirm: true })],
  ["add_comment", (id) => ({ id, content: "let me in" })],
];

describe.each(ID_TOOLS)("%s", (tool, args) => {
  it.each(["B", "U"] as const)("%s is FORBIDDEN, nothing changes, nothing leaks", async (who) => {
    const before = await snapshot();
    const res = await run(mcp[who], tool, args(ticketId));
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("FORBIDDEN");
    expect(res.raw).not.toContain(TITLE);
    expect(res.raw).not.toContain(ticketNumber);
    expect(await snapshot()).toEqual(before);
  });

  it("an unknown id is NOT_FOUND", async () => {
    const res = await run(mcp.admin, tool, args(999999));
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("NOT_FOUND");
  });

  it("no credential: 401 and nothing changes", async () => {
    const before = await snapshot();
    const res = await callTool(ctx.app, undefined, tool, args(ticketId));
    expect(res.status).toBe(401);
    expect(await snapshot()).toEqual(before);
  });
});

describe("list_tickets", () => {
  it.each(["B", "U"] as const)("%s's search for A's unique word finds nothing", async (who) => {
    const res = await run(mcp[who], "list_tickets", { search: WORD });
    expect(res.isError).toBe(false);
    expect(res.data.tickets).toEqual([]);
    expect(res.data.total).toBe(0);
    expect(res.raw).not.toContain(ticketNumber);
    const all = await run(mcp[who], "list_tickets", {});
    expect(all.raw).not.toContain(TITLE);
  });

  it("the owner and an admin do find it", async () => {
    for (const who of ["A", "admin", "agent"] as const) {
      const res = await run(mcp[who], "list_tickets", { search: WORD });
      expect(res.data.tickets.map((t: { id: number }) => t.id)).toEqual([ticketId]);
    }
  });

  it("an assigneeId filter cannot widen B's view", async () => {
    const res = await run(mcp.B, "list_tickets", { assigneeId: agent.id });
    expect(res.data.tickets).toEqual([]);
  });
});

describe("create_ticket", () => {
  it("B creates only a ticket of their own, which A cannot see", async () => {
    const before = await snapshot();
    const res = await run(mcp.B, "create_ticket", { title: `Mine ${WORD}`, category: "support" });
    expect(res.isError).toBe(false);
    expect(res.data.createdBy).toBe(B.id);
    const mine = await run(mcp.A, "get_ticket", { id: res.data.id });
    expect(mine.data.code).toBe("FORBIDDEN");
    const { tickets: _t, ...rest } = await snapshot();
    const { tickets: _b, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });
});

describe("every tool: success, validation, unauthenticated, forbidden, not-found", () => {
  const CASES: Array<{
    tool: string;
    success: (id: number) => object;
    successBy: "A" | "admin" | "agent";
    invalid: object;
    forbidden?: (id: number) => object;
    notFound?: object;
  }> = [
    {
      tool: "create_ticket",
      success: () => ({ title: "ok", category: "support" }),
      successBy: "A",
      invalid: { title: "ok", category: "support", priority: "asap" },
    },
    {
      tool: "get_ticket",
      success: (id) => ({ id }),
      successBy: "A",
      invalid: { id: -3 },
      forbidden: (id) => ({ id }),
      notFound: { id: 999999 },
    },
    {
      tool: "list_tickets",
      success: () => ({}),
      successBy: "A",
      invalid: { status: "Waiting for Review" },
    },
    {
      tool: "update_ticket",
      success: (id) => ({ id, notes: "n" }),
      successBy: "agent",
      invalid: { id: 0, notes: "n" },
      forbidden: (id) => ({ id, notes: "n" }),
      notFound: { id: 999999, notes: "n" },
    },
    {
      tool: "close_ticket",
      success: (id) => ({ id }),
      successBy: "agent",
      invalid: { id: 0 },
      forbidden: (id) => ({ id }),
      notFound: { id: 999999 },
    },
    {
      tool: "reopen_ticket",
      success: (id) => ({ id }),
      successBy: "admin",
      invalid: { id: -1 },
      forbidden: (id) => ({ id }),
      notFound: { id: 999999 },
    },
    {
      tool: "delete_ticket",
      success: (id) => ({ id, confirm: true }),
      successBy: "admin",
      invalid: { id: 0, confirm: true },
      forbidden: (id) => ({ id, confirm: true }),
      notFound: { id: 999999, confirm: true },
    },
    {
      tool: "add_comment",
      success: (id) => ({ id, content: "hi" }),
      successBy: "A",
      invalid: { id: 1, content: "" },
      forbidden: (id) => ({ id, content: "hi" }),
      notFound: { id: 999999, content: "hi" },
    },
  ];

  it.each(CASES.map((c) => [c.tool, c] as const))("%s", async (_name, c) => {
    // unauthenticated
    expect((await callTool(ctx.app, undefined, c.tool, c.success(ticketId))).status).toBe(401);
    // validation
    const invalid = c.tool === "add_comment" ? { id: ticketId, content: "" } : c.invalid;
    const bad = await run(c.successBy === "A" ? mcp.A : mcp.admin, c.tool, invalid);
    expect(bad.isError).toBe(true);
    expect(bad.data.code).toBe("VALIDATION");
    // forbidden and not-found
    if (c.forbidden) {
      const f = await run(mcp.B, c.tool, c.forbidden(ticketId));
      expect(f.data.code).toBe("FORBIDDEN");
    }
    if (c.notFound) {
      const n = await run(mcp.admin, c.tool, c.notFound);
      expect(n.data.code).toBe("NOT_FOUND");
    }
    // success last (close/delete change state)
    if (c.tool === "reopen_ticket") await run(mcp.admin, "close_ticket", { id: ticketId });
    const ok = await run(mcp[c.successBy], c.tool, c.success(ticketId));
    expect(ok.isError).toBe(false);
  });
});

it("no tool output anywhere in this file carries a secret key", () => {
  expect(outputs.length).toBeGreaterThan(20);
  expect(outputs.flatMap((o) => findSecrets(o))).toEqual([]);
});
