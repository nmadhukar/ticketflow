import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { apiKeys, knowledgeArticles, notifications, teamMembers, type Team, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { storage } from "../../../storage";
import { issueApiKey } from "../../../services/auth/apiKeys";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createTeam, createUser, loginAs } from "../helpers/fixtures";
import { mcpFor, type McpCaller } from "../helpers/mcpClient";
import { findSecrets } from "../helpers/noSecrets";

/**
 * Task MCP2: the rest of the app on MCP (R85-R88). Every tool mirrors a REST route; the parity
 * tests call the route and the tool as the same user and compare what comes back.
 */

const ALL_TOOLS = [
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
];

type Who = "admin" | "manager" | "agentOn" | "agentOff" | "legacy" | "customer" | "customer2";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let u: Record<Who, User>;
let mcp: Record<Who, McpCaller>;
let team: Team;
let otherTeam: Team;
let ticketId: number;
let publishedId: number;
let draftId: number;
let noteOnUnread: number;
let noteOnRead: number;
let noteOff: number;
const KB_WORD = "kbuniqueword";
const outputs: unknown[] = [];

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDb();
  u = {
    admin: await createUser({ role: "admin" }),
    manager: await createUser({ role: "manager" }),
    agentOn: await createUser({ role: "agent" }),
    agentOff: await createUser({ role: "agent" }),
    legacy: await createUser({ role: "user" }),
    customer: await createUser({ role: "customer" }),
    customer2: await createUser({ role: "customer" }),
  };
  mcp = {} as Record<Who, McpCaller>;
  for (const w of Object.keys(u) as Who[]) mcp[w] = await mcpFor(ctx.app, u[w]);

  // The manager runs `team` (its department too); agentOn is a member. otherTeam belongs to the admin.
  team = await createTeam(u.manager);
  await db.insert(teamMembers).values({ teamId: team.id, userId: u.agentOn.id, role: "member" });
  otherTeam = await createTeam(u.admin);

  const t = await storage.createTask({
    title: "History ticket",
    description: "for history",
    category: "support",
    createdBy: u.customer.id,
    assigneeId: u.agentOn.id,
    assigneeType: "user",
  } as never);
  ticketId = t.id;
  await storage.updateTask(ticketId, { priority: "high" } as never, u.agentOn.id);

  const [pub] = await db
    .insert(knowledgeArticles)
    .values({ title: `Reset ${KB_WORD}`, content: "Steps", isPublished: true, status: "published" })
    .returning();
  const [draft] = await db
    .insert(knowledgeArticles)
    .values({ title: `Draft ${KB_WORD}`, content: "Not yet", isPublished: false, status: "draft" })
    .returning();
  publishedId = pub.id;
  draftId = draft.id;

  noteOnUnread = (
    await storage.createNotification({ userId: u.agentOn.id, title: "Assigned", content: "You got one", type: "task_assigned" })
  ).id;
  noteOnRead = (
    await storage.createNotification({ userId: u.agentOn.id, title: "Old", content: "Seen", type: "system" })
  ).id;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, noteOnRead));
  noteOff = (
    await storage.createNotification({ userId: u.agentOff.id, title: "Mine", content: "Other user", type: "system" })
  ).id;
});

async function call(who: Who, name: string, args: object = {}) {
  const res = await mcp[who].call(name, args);
  outputs.push(res.data);
  expect(findSecrets(res.data)).toEqual([]);
  return res;
}

async function rest(who: Who) {
  return loginAs(ctx.app, u[who]);
}

const ids = (rows: Array<{ id: unknown }>) => rows.map((r) => r.id).sort();

async function isRead(id: number) {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
  return row.isRead;
}

describe("tools/list", () => {
  it("lists every tool; each one with an id argument marks it required and typed", async () => {
    const res = await request(ctx.app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${mcp.agentOn.key}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<{
      name: string;
      description?: string;
      inputSchema: { required?: string[]; properties?: Record<string, { type?: unknown; anyOf?: Array<{ type?: string }> }> };
    }>;
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    const withId = tools.filter((t) => t.inputSchema.properties?.id);
    expect(withId.map((t) => t.name).sort()).toEqual(
      [
        "add_comment",
        "close_ticket",
        "delete_ticket",
        "get_document",
        "get_knowledge_article",
        "get_team",
        "get_ticket",
        "get_ticket_history",
        "reopen_ticket",
        "update_guideline",
        "update_help_document",
        "update_knowledge_article",
        "update_policy",
        "update_ticket",
      ].sort()
    );
    for (const t of withId) {
      expect([t.name, t.inputSchema.required ?? []]).toEqual([t.name, expect.arrayContaining(["id"])]);
      const p = t.inputSchema.properties!.id;
      const types = p.type !== undefined ? [p.type].flat() : (p.anyOf ?? []).map((a) => a.type);
      expect([t.name, types]).toEqual([t.name, expect.arrayContaining(["number", "string"])]);
    }
    // R85: the one-scope ruling is stated where a model reads it.
    for (const name of ["whoami", "list_users", "list_teams", "list_notifications"]) {
      expect(tools.find((t) => t.name === name)!.description).toMatch(/mcp:tickets/);
    }
  });

  it("a key without mcp:tickets is still refused (403) for the new tools", async () => {
    const { apiKey, plaintext } = await issueApiKey({ userId: u.admin.id, name: "no-scope" });
    await db.update(apiKeys).set({ permissions: [] }).where(eq(apiKeys.id, apiKey.id));
    const res = await request(ctx.app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${plaintext}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } });
    expect(res.status).toBe(403);
  });
});

describe("whoami", () => {
  it.each(["admin", "agentOn", "legacy", "customer"] as const)("%s gets the session projection, a name and teams", async (who) => {
    const res = await call(who, "whoami");
    expect(res.isError).toBe(false);
    const me = (await (await rest(who)).get("/api/auth/user")).body;
    const { name, teams, ...rest_ } = res.data;
    expect(rest_).toEqual(me);
    expect(typeof name).toBe("string");
    expect(Array.isArray(teams)).toBe(true);
  });

  it("an agent's teams are the teams it belongs to (id and name only)", async () => {
    const res = await call("agentOn", "whoami");
    expect(res.data.teams).toEqual([{ id: team.id, name: team.name }]);
  });
});

describe("list_users", () => {
  it.each(["admin", "agentOn", "legacy"] as const)("%s: same users and projection as GET /api/users", async (who) => {
    const res = await call(who, "list_users", { limit: 100 });
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest(who)).get("/api/users")).body;
    const byId = (a: Array<{ id: string }>) => [...a].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(res.data.users)).toEqual(byId(viaRest));
    expect(res.data.total).toBe(viaRest.length);
  });

  it("an agent sees no other user's phone (R41), like REST", async () => {
    const res = await call("agentOff", "list_users", { limit: 100 });
    const other = res.data.users.find((x: { id: string }) => x.id === u.admin.id);
    expect(other).toBeDefined();
    expect("phone" in other).toBe(false);
  });

  it("a customer is FORBIDDEN, as REST answers 403", async () => {
    expect((await (await rest("customer")).get("/api/users")).status).toBe(403);
    const res = await call("customer", "list_users");
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("FORBIDDEN");
  });

  it("search narrows by name or email; limit and offset page it", async () => {
    const found = await call("admin", "list_users", { search: u.manager.email });
    expect(found.data.users.map((x: { id: string }) => x.id)).toEqual([u.manager.id]);
    const page1 = await call("admin", "list_users", { limit: 3 });
    const page2 = await call("admin", "list_users", { limit: 3, offset: "3" });
    expect(page1.data.returned).toBe(3);
    expect(page1.data.hasMore).toBe(true);
    const all = [...page1.data.users, ...page2.data.users].map((x: { id: string }) => x.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it.each([{ limit: 0 }, { limit: 101 }, { limit: "abc" }, { limit: 1.5 }, { offset: -1 }])(
    "bad paging %p is a coded VALIDATION",
    async (args) => {
      const res = await call("admin", "list_users", args);
      expect(res.isError).toBe(true);
      expect(res.data.code).toBe("VALIDATION");
      expect(Object.keys(res.data.details.fieldErrors)).toEqual(Object.keys(args));
    }
  );
});

describe("list_teams", () => {
  it("admin: every team, as GET /api/teams", async () => {
    const res = await call("admin", "list_teams");
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest("admin")).get("/api/teams")).body;
    expect(ids(res.data.teams)).toEqual(ids(viaRest));
    expect(ids(res.data.teams)).toEqual([team.id, otherTeam.id].sort());
  });

  it("manager: GET /api/teams by default, GET /api/teams/my with mine: true", async () => {
    const agent = await rest("manager");
    expect(ids((await call("manager", "list_teams")).data.teams)).toEqual(ids((await agent.get("/api/teams")).body));
    expect(ids((await call("manager", "list_teams", { mine: true })).data.teams)).toEqual(
      ids((await agent.get("/api/teams/my")).body)
    );
  });

  it.each(["agentOn", "agentOff", "legacy"] as const)("%s: the teams GET /api/teams/my returns (REST refuses agents the full list)", async (who) => {
    const res = await call(who, "list_teams");
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest(who)).get("/api/teams/my")).body;
    expect(ids(res.data.teams)).toEqual(ids(viaRest));
  });

  it("agentOn sees its team, agentOff sees none", async () => {
    expect(ids((await call("agentOn", "list_teams")).data.teams)).toEqual([team.id]);
    expect((await call("agentOff", "list_teams")).data.teams).toEqual([]);
  });

  it("a customer is FORBIDDEN, as REST answers 403", async () => {
    expect((await (await rest("customer")).get("/api/teams")).status).toBe(403);
    const res = await call("customer", "list_teams");
    expect(res.data.code).toBe("FORBIDDEN");
  });
});

describe("get_team", () => {
  it.each(["admin", "agentOn"] as const)("%s: the team, and its members as GET /api/teams/:id/members shows them", async (who) => {
    const agent = await rest(who);
    const res = await call(who, "get_team", { id: team.id, includeMembers: true });
    expect(res.isError).toBe(false);
    const { members, ...teamOnly } = res.data;
    expect(teamOnly).toEqual((await agent.get(`/api/teams/${team.id}`)).body);
    const viaRest = (await agent.get(`/api/teams/${team.id}/members`)).body;
    const byUser = (a: Array<{ userId: string }>) => [...a].sort((x, y) => x.userId.localeCompare(y.userId));
    expect(byUser(members)).toEqual(byUser(viaRest));
  });

  it("an agent not on the team gets the team (as REST) but its members are FORBIDDEN (as REST)", async () => {
    const agent = await rest("agentOff");
    expect((await agent.get(`/api/teams/${team.id}`)).status).toBe(200);
    expect((await call("agentOff", "get_team", { id: team.id })).data.id).toBe(team.id);
    expect((await agent.get(`/api/teams/${team.id}/members`)).status).toBe(403);
    const res = await call("agentOff", "get_team", { id: team.id, includeMembers: true });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("FORBIDDEN");
  });

  it("a customer is FORBIDDEN, as REST answers 403", async () => {
    expect((await (await rest("customer")).get(`/api/teams/${team.id}`)).status).toBe(403);
    expect((await call("customer", "get_team", { id: team.id })).data.code).toBe("FORBIDDEN");
  });

  it("an unknown team is NOT_FOUND; a bad id is VALIDATION", async () => {
    expect((await call("admin", "get_team", { id: 999999 })).data.code).toBe("NOT_FOUND");
    for (const id of ["abc", 0, 2147483648, "1.5"]) {
      const res = await call("admin", "get_team", { id });
      expect([id, res.data.code]).toEqual([id, "VALIDATION"]);
      expect(res.data.details.fieldErrors.id).toBeDefined();
    }
  });
});

describe("list_departments", () => {
  it.each(["admin", "manager", "agentOn", "customer"] as const)("%s: same rows as GET /api/departments", async (who) => {
    const res = await call(who, "list_departments");
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest(who)).get("/api/departments")).body;
    expect(res.data.departments).toEqual(viaRest);
  });
});

describe("search_knowledge and get_knowledge_article", () => {
  it.each(["admin", "agentOn", "agentOff", "customer"] as const)("%s: same articles as GET /api/knowledge/search", async (who) => {
    const res = await call(who, "search_knowledge", { query: KB_WORD });
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest(who)).get(`/api/knowledge/search?query=${KB_WORD}`)).body;
    expect(ids(res.data.articles)).toEqual(ids(viaRest));
    expect(ids(res.data.articles)).toEqual([publishedId]);
  });

  it.each([{ limit: 0 }, { limit: 101 }, { limit: "x" }])("bad limit %p is VALIDATION", async (args) => {
    const res = await call("agentOn", "search_knowledge", { query: KB_WORD, ...args });
    expect(res.data.code).toBe("VALIDATION");
    expect(res.data.details.fieldErrors.limit).toBeDefined();
  });

  it.each(["admin", "agentOn", "customer"] as const)("%s reads a published article; a draft is NOT_FOUND", async (who) => {
    const res = await call(who, "get_knowledge_article", { id: String(publishedId) });
    expect(res.isError).toBe(false);
    expect(res.data.id).toBe(publishedId);
    expect(res.data.content).toBe("Steps");
    const viaRest = (await (await rest(who)).get("/api/knowledge/articles")).body;
    expect(viaRest.map((a: { id: number }) => a.id)).toContain(publishedId);
    expect(viaRest.map((a: { id: number }) => a.id)).not.toContain(draftId);
    expect((await call(who, "get_knowledge_article", { id: draftId })).data.code).toBe("NOT_FOUND");
  });

  it("a bad article id is VALIDATION", async () => {
    expect((await call("agentOn", "get_knowledge_article", { id: "x1" })).data.code).toBe("VALIDATION");
  });
});

describe("get_stats", () => {
  it.each(["admin", "agentOn", "agentOff", "legacy", "customer", "customer2"] as const)(
    "%s: the same counts as GET /api/stats (R45 scope)",
    async (who) => {
      const res = await call(who, "get_stats");
      expect(res.isError).toBe(false);
      const viaRest = (await (await rest(who)).get("/api/stats")).body;
      expect(res.data).toEqual(viaRest);
    }
  );

  it("scope differs by who is asking", async () => {
    expect((await call("admin", "get_stats")).data.total).toBe(1);
    expect((await call("agentOn", "get_stats")).data.total).toBe(1);
    expect((await call("agentOff", "get_stats")).data.total).toBe(0);
    expect((await call("customer2", "get_stats")).data.total).toBe(0);
  });
});

describe("list_activity", () => {
  it.each(["admin", "agentOn", "agentOff", "customer", "customer2"] as const)("%s: the same events as GET /api/activity", async (who) => {
    const res = await call(who, "list_activity", { limit: 10 });
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest(who)).get("/api/activity?limit=10")).body;
    expect(ids(res.data.activity)).toEqual(ids(viaRest));
  });

  it("agentOff sees no event of a ticket it cannot see; agentOn does", async () => {
    expect((await call("agentOff", "list_activity")).data.activity).toEqual([]);
    expect((await call("agentOn", "list_activity")).data.activity.length).toBeGreaterThan(0);
  });

  it.each([{ limit: 0 }, { limit: 101 }, { limit: [] }])("bad limit %p is VALIDATION", async (args) => {
    const res = await call("admin", "list_activity", args);
    expect(res.data.code).toBe("VALIDATION");
    expect(res.data.details.fieldErrors.limit).toBeDefined();
  });
});

describe("get_ticket_history", () => {
  it.each(["admin", "agentOn", "customer"] as const)("%s: the same entries as GET /api/tasks/:id/history", async (who) => {
    const res = await call(who, "get_ticket_history", { id: ticketId });
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest(who)).get(`/api/tasks/${ticketId}/history`)).body;
    expect(res.data.history).toEqual(viaRest);
    expect(res.data.history.length).toBeGreaterThan(0);
  });

  it.each(["agentOff", "customer2"] as const)("%s cannot see the ticket: FORBIDDEN, as REST answers 403 (and as get_ticket)", async (who) => {
    expect((await (await rest(who)).get(`/api/tasks/${ticketId}/history`)).status).toBe(403);
    const res = await call(who, "get_ticket_history", { id: ticketId });
    expect(res.data.code).toBe("FORBIDDEN");
    expect((await call(who, "get_ticket", { id: ticketId })).data.code).toBe("FORBIDDEN");
    expect(res.raw).not.toContain("History ticket");
  });

  it("unknown is NOT_FOUND; bad ids are VALIDATION", async () => {
    expect((await call("admin", "get_ticket_history", { id: 999999 })).data.code).toBe("NOT_FOUND");
    expect((await call("admin", "get_ticket_history", { id: "abc" })).data.code).toBe("VALIDATION");
    expect((await call("admin", "get_ticket_history", { id: 2147483648 })).data.code).toBe("VALIDATION");
  });

  it("a customer sees the actor as REST shows it to a customer (no email, no role)", async () => {
    const res = await call("customer", "get_ticket_history", { id: ticketId });
    const withUser = res.data.history.find((h: { user?: object }) => h.user);
    expect(withUser.user).not.toHaveProperty("email");
    expect(withUser.user).not.toHaveProperty("role");
  });
});

describe("list_notifications", () => {
  it.each(["agentOn", "agentOff", "customer", "admin"] as const)("%s: the same unread notifications as GET /api/notifications", async (who) => {
    const res = await call(who, "list_notifications", { limit: 50 });
    expect(res.isError).toBe(false);
    const viaRest = (await (await rest(who)).get("/api/notifications?read=false&limit=50")).body;
    expect(ids(res.data.notifications)).toEqual(ids(viaRest));
  });

  it("only the caller's own; unreadOnly: false adds the read ones", async () => {
    expect(ids((await call("agentOn", "list_notifications")).data.notifications)).toEqual([noteOnUnread]);
    expect(ids((await call("agentOn", "list_notifications", { unreadOnly: false })).data.notifications)).toEqual(
      [noteOnUnread, noteOnRead].sort()
    );
    expect(ids((await call("agentOff", "list_notifications", { unreadOnly: false })).data.notifications)).toEqual([noteOff]);
  });

  it("since keeps only newer notifications", async () => {
    await db
      .update(notifications)
      .set({ createdAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(notifications.id, noteOnRead));
    const res = await call("agentOn", "list_notifications", { unreadOnly: false, since: "2021-01-01T00:00:00Z" });
    expect(ids(res.data.notifications)).toEqual([noteOnUnread]);
  });

  it("polling with the newest createdAt as since returns nothing new (microsecond rows, millisecond cursor)", async () => {
    await db.execute(sql`UPDATE notifications SET created_at = '2026-01-01T00:00:00.123456Z' WHERE id = ${noteOnUnread}`);
    const first = await call("agentOn", "list_notifications");
    const cursor = first.data.notifications[0].createdAt;
    const again = await call("agentOn", "list_notifications", { since: cursor });
    expect(ids(again.data.notifications)).toEqual([]);
  });

  it.each([{ since: "yesterday" }, { since: "2026-13-45" }, { limit: 0 }, { limit: "lots" }])("bad %p is VALIDATION", async (args) => {
    const res = await call("agentOn", "list_notifications", args);
    expect(res.data.code).toBe("VALIDATION");
    expect(Object.keys(res.data.details.fieldErrors)).toEqual(Object.keys(args));
  });
});

describe("mark_notifications_read", () => {
  it("marks the caller's own by id", async () => {
    const res = await call("agentOn", "mark_notifications_read", { ids: [noteOnUnread] });
    expect(res.isError).toBe(false);
    expect(res.data.marked).toBe(1);
    expect(await isRead(noteOnUnread)).toBe(true);
  });

  it("admin marks all of its own (it has none): nothing else changes", async () => {
    const res = await call("admin", "mark_notifications_read", { all: true });
    expect(res.data.marked).toBe(0);
    expect(await isRead(noteOnUnread)).toBe(false);
    expect(await isRead(noteOff)).toBe(false);
  });

  it("cannot touch another user's notification, by id or with all: true", async () => {
    const byId = await call("agentOff", "mark_notifications_read", { ids: [noteOnUnread] });
    expect(byId.isError).toBe(false);
    expect(byId.data.marked).toBe(0);
    expect(await isRead(noteOnUnread)).toBe(false);
    const all = await call("agentOff", "mark_notifications_read", { all: true });
    expect(all.data.marked).toBe(1);
    expect(await isRead(noteOff)).toBe(true);
    expect(await isRead(noteOnUnread)).toBe(false);
  });

  it("REST PATCH /api/notifications/:id/read cannot touch another user's notification either", async () => {
    const res = await (await rest("agentOff")).patch(`/api/notifications/${noteOnUnread}/read`);
    expect(res.status).toBe(200);
    expect(await isRead(noteOnUnread)).toBe(false);
    await (await rest("agentOn")).patch(`/api/notifications/${noteOnUnread}/read`);
    expect(await isRead(noteOnUnread)).toBe(true);
  });

  it.each([{}, { ids: [] }, { ids: ["x"] }, { ids: [0] }, { ids: [1], all: true }, { all: false }])(
    "%p is VALIDATION and nothing changes",
    async (args) => {
      const res = await call("agentOn", "mark_notifications_read", args);
      expect(res.isError).toBe(true);
      expect(res.data.code).toBe("VALIDATION");
      expect(await isRead(noteOnUnread)).toBe(false);
    }
  );
});

describe("assignment", () => {
  it("update_ticket already reassigns under PATCH /api/tasks/:id rules (no assign_ticket tool)", async () => {
    const res = await call("admin", "update_ticket", { id: ticketId, assigneeId: u.agentOff.id, assigneeType: "user" });
    expect(res.isError).toBe(false);
    expect(res.data.appliedFields).toEqual(expect.arrayContaining(["assigneeId"]));
    expect((await call("agentOff", "get_ticket", { id: ticketId })).isError).toBe(false);
  });
});

afterAll(() => {
  expect(findSecrets(outputs)).toEqual([]);
});
