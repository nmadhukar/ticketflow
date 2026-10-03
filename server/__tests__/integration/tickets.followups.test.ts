import { eq } from "drizzle-orm";
import { tasks, taskHistory, users as usersTable, type User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { mcpFor } from "./helpers/mcpClient";
import { db, pool } from "../../storage/db";
import { storage } from "../../storage";
import { listTickets } from "../../services/tickets/ticketService";
import { resetDefaultTriageTeam } from "../../services/tickets/triage";
import { displayNameOf } from "../../utils/displayName";
import { HttpError } from "../../http/errors";
import { logSecurityEvent } from "../../security/rbac";

/**
 * FU3: R36 triage routing, the customer routing living in ticketService, one access check
 * on REST by-id, the audit user id, M9 (one joined query per page), and the last-admin lock.
 */

type Agent = Awaited<ReturnType<typeof loginAs>>;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const savedTriage = process.env.DEFAULT_TRIAGE_TEAM_ID;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  if (savedTriage === undefined) delete process.env.DEFAULT_TRIAGE_TEAM_ID;
  else process.env.DEFAULT_TRIAGE_TEAM_ID = savedTriage;
  resetDefaultTriageTeam();
  await ctx.close();
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DEFAULT_TRIAGE_TEAM_ID;
  resetDefaultTriageTeam();
});

/** Statement texts sent to Postgres while `fn` runs. */
async function statementsDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const spy = jest.spyOn(pool as unknown as { query: (...a: unknown[]) => unknown }, "query");
  try {
    await fn();
    return spy.mock.calls.map((c) => {
      const a = c[0] as string | { text?: string };
      return typeof a === "string" ? a : (a.text ?? "");
    });
  } finally {
    spy.mockRestore();
  }
}

describe("R36: DEFAULT_TRIAGE_TEAM_ID", () => {
  let admin: User;
  let manager: User;
  let customer: User;
  let member: User;
  let outsider: User;
  let teamId: number;
  let cust: Agent;
  let memberAgent: Agent;
  let outsiderAgent: Agent;

  beforeEach(async () => {
    resetDefaultTriageTeam();
    await resetDb();
    admin = await createUser({ role: "admin" });
    manager = await createUser({ role: "manager" });
    customer = await createUser({ role: "customer" });
    member = await createUser({ role: "agent" });
    outsider = await createUser({ role: "agent" });
    teamId = (await createTeam(manager)).id;
    await storage.addTeamMember({ teamId, userId: member.id } as never);
    cust = await loginAs(ctx.app, customer);
    memberAgent = await loginAs(ctx.app, member);
    outsiderAgent = await loginAs(ctx.app, outsider);
  });

  it("set: an unassigned customer ticket is queued to the team and its members can open it", async () => {
    process.env.DEFAULT_TRIAGE_TEAM_ID = String(teamId);
    const res = await createTicketAs(cust, {});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ assigneeType: "team", assigneeTeamId: teamId, assigneeId: null });
    expect((await memberAgent.get(`/api/tasks/${res.body.id}`)).status).toBe(200);
    expect((await outsiderAgent.get(`/api/tasks/${res.body.id}`)).status).toBe(403);
  });

  it("set, then the team is deleted: the customer ticket is created unassigned (201), not a 500", async () => {
    process.env.DEFAULT_TRIAGE_TEAM_ID = String(teamId);
    const { defaultTriageAssignment } = await import("../../services/tickets/triage");
    expect(await defaultTriageAssignment()).not.toBeNull(); // primes the cached verdict
    const schema = await import("@shared/schema");
    await db.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
    const res = await createTicketAs(cust, {});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ assigneeTeamId: null, assigneeId: null });
  });

  it("set: a customer ticket routed to a department only (no team, no user) is queued to the team too", async () => {
    process.env.DEFAULT_TRIAGE_TEAM_ID = String(teamId);
    const [t] = await db.select().from((await import("@shared/schema")).teams);
    const res = await createTicketAs(cust, { departmentId: t.departmentId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ assigneeType: "team", assigneeTeamId: teamId });
  });

  it("set: a customer's own choice of team or user is respected", async () => {
    process.env.DEFAULT_TRIAGE_TEAM_ID = String(teamId);
    const otherTeam = (await createTeam(manager)).id;
    const toTeam = await createTicketAs(cust, { assigneeType: "team", teamId: otherTeam });
    expect(toTeam.body).toMatchObject({ assigneeType: "team", assigneeTeamId: otherTeam });
    const toUser = await createTicketAs(cust, { assigneeType: "user", assigneeId: outsider.id });
    expect(toUser.body).toMatchObject({ assigneeType: "user", assigneeId: outsider.id, assigneeTeamId: null });
  });

  it("set: a ticket staff create without an assignee is not triaged (R36 covers customers and email)", async () => {
    process.env.DEFAULT_TRIAGE_TEAM_ID = String(teamId);
    const adminAgent = await loginAs(ctx.app, admin);
    const res = await createTicketAs(adminAgent, {});
    expect(res.status).toBe(201);
    expect(res.body.assigneeTeamId).toBeNull();
  });

  it("unset: behaviour is unchanged (admin triage; a team member cannot see it)", async () => {
    const res = await createTicketAs(cust, {});
    expect(res.status).toBe(201);
    expect(res.body.assigneeTeamId).toBeNull();
    expect(res.body.assigneeType).not.toBe("team");
    expect((await memberAgent.get(`/api/tasks/${res.body.id}`)).status).toBe(403);
  });

  it.each(["999999", "abc", "-3", "1.5"])("an unusable id (%s) is logged once and ignored", async (bad) => {
    process.env.DEFAULT_TRIAGE_TEAM_ID = bad;
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    err.mockClear();
    const { initDefaultTriageTeam } = await import("../../services/tickets/triage");
    expect(await initDefaultTriageTeam()).toBeNull();
    const lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("DEFAULT_TRIAGE_TEAM_ID"));
    expect(lines).toHaveLength(1);
    const res = await createTicketAs(cust, {});
    expect(res.status).toBe(201);
    expect(res.body.assigneeTeamId).toBeNull();
  });

  it("MCP create_ticket by a customer shares the routing (triage team when unassigned)", async () => {
    process.env.DEFAULT_TRIAGE_TEAM_ID = String(teamId);
    const mcp = await mcpFor(ctx.app, customer);
    const res = await mcp.call("create_ticket", { title: "Via MCP", category: "support" });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ assigneeType: "team", assigneeTeamId: teamId });
  });

  it("the customer routing rules answer 400 from the service (invalid team) and write nothing", async () => {
    const before = (await db.select().from(tasks)).length;
    const bad = await createTicketAs(cust, { assigneeType: "team", teamId: 987654 });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: "validation_failed", message: "Invalid team" });
    const noId = await createTicketAs(cust, { assigneeType: "user" });
    expect(noId.status).toBe(400);
    expect(noId.body.message).toBe("assigneeId is required for user assignment");
    expect((await db.select().from(tasks)).length).toBe(before);
  });

  it("an invalid routing choice is refused before any attachment is uploaded", async () => {
    const { s3Service } = await import("../../services/s3Service");
    const upload = jest.spyOn(s3Service, "uploadFile").mockResolvedValue(undefined as never);
    jest.spyOn(s3Service, "isConfigured").mockResolvedValue({ isConfigured: true, missing: [] } as never);
    const res = await cust
      .post("/api/tasks")
      .field("title", "With file")
      .field("category", "support")
      .field("assigneeType", "team")
      .field("teamId", "987654")
      .attach("files", Buffer.from("hello"), "a.txt");
    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("REST by-id routes check access once", () => {
  it("GET, PATCH, DELETE and POST comment each run ONE access probe", async () => {
    await resetDb();
    const admin = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, admin);
    const t = (await createTicketAs(a, {})).body;
    const probes = (s: string[]) => s.filter((q) => /select 1 from "tasks"/i.test(q)).length;

    const get = await statementsDuring(() => a.get(`/api/tasks/${t.id}`));
    const patch = await statementsDuring(() => a.patch(`/api/tasks/${t.id}`).send({}));
    const comment = await statementsDuring(() => a.post(`/api/tasks/${t.id}/comments`).send({ content: "hi" }));
    const del = await statementsDuring(() => a.delete(`/api/tasks/${t.id}`));
    expect([probes(get), probes(patch), probes(comment), probes(del)]).toEqual([1, 1, 1, 1]);
  });

  it("access is still enforced: 404 for a missing ticket, 403 outside scope, 401 anonymous", async () => {
    await resetDb();
    const c1 = await createUser({ role: "customer" });
    const c2 = await createUser({ role: "customer" });
    const a1 = await loginAs(ctx.app, c1);
    const a2 = await loginAs(ctx.app, c2);
    const t = (await createTicketAs(a1, {})).body;
    for (const call of [
      (id: number, ag: Agent) => ag.get(`/api/tasks/${id}`),
      (id: number, ag: Agent) => ag.patch(`/api/tasks/${id}`).send({ title: "x" }),
      (id: number, ag: Agent) => ag.post(`/api/tasks/${id}/comments`).send({ content: "x" }),
      (id: number, ag: Agent) => ag.delete(`/api/tasks/${id}`),
    ]) {
      expect((await call(t.id, a2)).status).toBe(403);
      expect((await call(t.id + 1000, a2)).status).toBe(404);
    }
    expect((await (await import("supertest")).default(ctx.app).get(`/api/tasks/${t.id}`)).status).toBe(401);
  });
});

describe("audit user id", () => {
  it("a refused REST status change is logged with the real user id", async () => {
    await resetDb();
    const customer = await createUser({ role: "customer" });
    const a = await loginAs(ctx.app, customer);
    const t = (await createTicketAs(a, {})).body;
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    log.mockClear();
    const res = await a.patch(`/api/tasks/${t.id}`).send({ status: "closed" });
    expect([403, 409]).toContain(res.status);
    const entries = log.mock.calls
      .filter((c) => c[0] === "SECURITY_AUDIT:")
      .map((c) => String(c[1] ?? ""))
      .filter((s) => s.includes('"change_status"'))
      .map((s) => JSON.parse(s));
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe(customer.id);
    expect(entries[0].userId).not.toBe("anonymous");
  });

  it("logSecurityEvent reads a session user's id, and still a JWT payload's userId", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    log.mockClear();
    logSecurityEvent({ user: { id: "u-1", role: "agent" }, ip: "i", get: () => undefined } as never, "a", "r", true);
    logSecurityEvent({ user: { userId: "u-2", role: "agent" }, ip: "i", get: () => undefined } as never, "a", "r", true);
    logSecurityEvent({ ip: "i", get: () => undefined } as never, "a", "r", true);
    const ids = log.mock.calls
      .filter((c) => c[0] === "SECURITY_AUDIT:")
      .map((c) => JSON.parse(String(c[1])).userId);
    expect(ids).toEqual(["u-1", "u-2", "anonymous"]);
  });
});

describe("updateTask with no row written", () => {
  it("without expectedStatus the answer is 404 (the ticket vanished), with it 409", async () => {
    await resetDb();
    const admin = await createUser({ role: "admin" });
    const t = await storage.createTask({ title: "gone", category: "support", createdBy: admin.id } as never);
    const real = await storage.getTask(t.id);
    await db.delete(taskHistory).where(eq(taskHistory.taskId, t.id));
    await db.delete(tasks).where(eq(tasks.id, t.id));
    jest.spyOn(storage, "getTask").mockResolvedValue(real);
    const plain = await storage.updateTask(t.id, { title: "x" }, admin.id).catch((e) => e);
    expect(plain).toBeInstanceOf(HttpError);
    expect(plain).toMatchObject({ status: 404, code: "not_found" });
    const conditional = await storage.updateTask(t.id, { status: "closed" }, admin.id, { expectedStatus: "open" }).catch((e) => e);
    expect(conditional).toMatchObject({ status: 409, code: "invalid_transition" });
  });
});

describe("Round 2: createTask clashes, demo seeders, deny-by-default", () => {
  it("a second ticket-number clash is 409 conflict with no pg text (not a raw 500)", async () => {
    await resetDb();
    const admin = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, admin);
    const first = (await createTicketAs(a, {})).body;
    // The counter keeps handing out a number that already exists: both attempts clash.
    const spy = jest
      .spyOn(storage as unknown as { getNextTicketNumber: () => Promise<string> }, "getNextTicketNumber")
      .mockResolvedValue(first.ticketNumber);
    try {
      const before = (await db.select().from(tasks)).length;
      const res = await createTicketAs(a, {});
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("conflict");
      expect(JSON.stringify(res.body)).not.toMatch(/duplicate|constraint|ticket_number|tasks_/i);
      expect((await db.select().from(tasks)).length).toBe(before);
      // The storage layer says the same (and the service does not remap it to invalid_transition).
      await expect(
        storage.createTask({ title: "again", category: "support", createdBy: admin.id } as never)
      ).rejects.toMatchObject({ status: 409, code: "conflict" });
    } finally {
      spy.mockRestore();
    }
  });

  it("a single clash is repaired by re-syncing the counter (201, and the number is new)", async () => {
    await resetDb();
    const admin = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, admin);
    const first = (await createTicketAs(a, {})).body;
    const real = (storage as unknown as { getNextTicketNumber: () => Promise<string> }).getNextTicketNumber.bind(storage);
    const spy = jest
      .spyOn(storage as unknown as { getNextTicketNumber: () => Promise<string> }, "getNextTicketNumber")
      .mockResolvedValueOnce(first.ticketNumber)
      .mockImplementation(real);
    const res = await createTicketAs(a, {});
    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).not.toBe(first.ticketNumber);
    spy.mockRestore();
  });

  it("running the demo seeders twice, then creating a ticket, is 201", async () => {
    await resetDb();
    const { runSeeders } = await import("../../seed/runSeeders");
    const env = { NODE_ENV: "development", SEED_DEMO_DATA: "true" } as NodeJS.ProcessEnv;
    await runSeeders(env);
    await runSeeders(env);
    const seeded = (await db.select().from(tasks)).length;
    expect(seeded).toBeGreaterThan(0);
    const customer = await createUser({ role: "customer" });
    const c = await loginAs(ctx.app, customer);
    const res = await createTicketAs(c, {});
    expect(res.status).toBe(201);
    expect((await db.select().from(tasks)).length).toBe(seeded + 1);
  });

  it("assertAgentMayAssign denies an unknown or missing role (deny by default), and still allows admin and manager", async () => {
    const { assertAgentMayAssign } = await import("../../services/tickets/assignees");
    for (const role of [null, undefined, "superuser", ""]) {
      await expect(assertAgentMayAssign({ id: "u", role }, {})).rejects.toMatchObject({ status: 403, code: "forbidden" });
    }
    await expect(assertAgentMayAssign({ id: "u", role: "admin" }, { assigneeId: "someone" })).resolves.toBeUndefined();
    await expect(assertAgentMayAssign({ id: "u", role: "manager" }, { assigneeId: "someone" })).resolves.toBeUndefined();
    await expect(assertAgentMayAssign({ id: "u", role: "customer" }, {})).resolves.toBeUndefined();
    await expect(assertAgentMayAssign({ id: "u", role: "agent" }, { assigneeId: "someone" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("M9: one joined query per page", () => {
  let admin: User;
  let agent: User;
  let manager: User;
  let teamId: number;

  beforeAll(async () => {
    await resetDb();
    admin = await createUser({ role: "admin" });
    agent = await createUser({ role: "agent" });
    manager = await createUser({ role: "manager" });
    teamId = (await createTeam(manager)).id;
    await storage.addTeamMember({ teamId, userId: agent.id } as never);
    const customer = await createUser({ role: "customer" });
    const creators = [admin, agent, manager, customer];
    for (let i = 0; i < 30; i++) {
      const t = await storage.createTask({
        title: `Page ${i}`,
        category: "support",
        priority: ["low", "medium", "high", "urgent"][i % 4],
        createdBy: creators[i % 4].id,
        ...(i % 3 === 0
          ? { assigneeType: "team", assigneeTeamId: teamId, assigneeId: null }
          : i % 3 === 1
            ? { assigneeType: "user", assigneeId: agent.id, assigneeTeamId: null }
            : {}),
      } as never);
      if (i % 5 === 0) await storage.updateTask(t.id, { title: `Page ${i} edited` }, manager.id);
    }
  });

  it("listTickets for a page of 25 runs 2 statements (count + page), and matches getTask row for row", async () => {
    let result!: Awaited<ReturnType<typeof listTickets>>;
    const statements = await statementsDuring(async () => {
      result = await listTickets(admin, { limit: 25 });
    });
    expect(statements).toHaveLength(2);
    expect(result.tickets).toHaveLength(25);
    expect(result.total).toBe(30);
    expect(result.hasMore).toBe(true);
    const expected = await Promise.all(result.tickets.map((t) => storage.getTask(t.id)));
    expect(result.tickets).toEqual(expected);
    // Newest first, id as tie-break.
    const ids = result.tickets.map((t) => t.id);
    expect(ids).toEqual([...ids].sort((x, y) => y - x));
  });

  it("the statement count does not grow with the page size (REST list)", async () => {
    const a = await loginAs(ctx.app, admin);
    const small = await statementsDuring(() => a.get("/api/tasks?limit=5"));
    const large = await statementsDuring(() => a.get("/api/tasks?limit=25"));
    expect(large.length).toBe(small.length);
    expect(large.filter((q) => /from "tasks"/i.test(q))).toHaveLength(1);
  });

  it("the REST list rows keep the per-row name rules (creator, team or user assignee, last updater)", async () => {
    const a = await loginAs(ctx.app, admin);
    const res = await a.get("/api/tasks?limit=30");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(30);
    const everyone = await db.select().from(usersTable);
    const byId = new Map(everyone.map((u) => [u.id, u]));
    const [team] = [await storage.getTeam(teamId)];
    for (const row of res.body) {
      expect(row.creatorName).toBe(row.createdBy && byId.get(row.createdBy) ? displayNameOf(byId.get(row.createdBy)) : "Unknown");
      const expectedAssignee =
        row.assigneeType === "team" && row.assigneeTeamId
          ? (team?.name ?? "")
          : row.assigneeId && byId.get(row.assigneeId)
            ? displayNameOf(byId.get(row.assigneeId))
            : "";
      expect(row.assigneeName).toBe(expectedAssignee);
      const [last] = (await db.select().from(taskHistory).where(eq(taskHistory.taskId, row.id))).sort(
        (x, y) => +y.createdAt! - +x.createdAt! || y.id - x.id
      );
      expect(row.lastUpdatedBy).toBe(last?.userId && byId.get(last.userId) ? displayNameOf(byId.get(last.userId)) : "");
    }
    // Still newest first, no row repeated.
    expect(new Set(res.body.map((r: { id: number }) => r.id)).size).toBe(30);
  });

  it("paging by offset reaches every row exactly once", async () => {
    const seen: number[] = [];
    for (let offset = 0; offset < 30; offset += 7) {
      seen.push(...(await listTickets(admin, { limit: 7, offset })).tickets.map((t) => t.id));
    }
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });
});

describe("toggle-status flips inside the lock", () => {
  it("two concurrent toggles flip twice: the user ends where it started", async () => {
    await resetDb();
    const admin = await createUser({ role: "admin" });
    await createUser({ role: "admin" });
    const target = await createUser({ role: "agent" });
    const a = await loginAs(ctx.app, admin);
    const before = (await db.select().from(usersTable).where(eq(usersTable.id, target.id)))[0].isActive;
    const [r1, r2] = await Promise.all([
      a.post(`/api/admin/users/${target.id}/toggle-status`),
      a.post(`/api/admin/users/${target.id}/toggle-status`),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.isActive).not.toBe(r2.body.isActive);
    const after = (await db.select().from(usersTable).where(eq(usersTable.id, target.id)))[0].isActive;
    expect(after).toBe(before);
  });
});

describe("last administrator", () => {
  async function twoAdmins() {
    await resetDb();
    const a = await createUser({ role: "admin" });
    const b = await createUser({ role: "admin" });
    return { a, b };
  }

  it("two admins demoting each other at once: exactly one wins, one admin remains", async () => {
    for (let round = 0; round < 3; round++) {
      const { a, b } = await twoAdmins();
      const results = await Promise.allSettled([
        storage.updateUserKeepingAnAdmin(b.id, { role: "agent" }, a.id),
        storage.updateUserKeepingAnAdmin(a.id, { role: "agent" }, b.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ status: 409, code: "last_admin" });
      const left = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
      expect(left).toHaveLength(1);
    }
  });

  it("an inactive admin is not an active admin (target and the others alike); is_active cannot be NULL", async () => {
    const { a, b } = await twoAdmins();
    // Migration 0020 made users.is_active NOT NULL, so the NULL case of the original test no longer exists.
    await expect(
      db.update(usersTable).set({ isActive: null as unknown as boolean }).where(eq(usersTable.id, b.id))
    ).rejects.toThrow();
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, b.id));
    // b is not active, so a is the last active administrator.
    await expect(storage.updateUserKeepingAnAdmin(a.id, { role: "agent" }, "someone-else")).rejects.toMatchObject({
      status: 409,
      code: "last_admin",
    });
    // Demoting the inactive admin loses no active admin.
    await expect(storage.updateUserKeepingAnAdmin(b.id, { role: "agent" }, a.id)).resolves.toMatchObject({ role: "agent" });
  });

  it("an admin cannot demote or deactivate themselves while another remains; a missing user is 404", async () => {
    const { a } = await twoAdmins();
    await expect(storage.updateUserKeepingAnAdmin(a.id, { role: "agent" }, a.id)).rejects.toMatchObject({
      status: 409,
      code: "self_demotion",
    });
    await expect(storage.updateUserKeepingAnAdmin(a.id, { isActive: false }, a.id)).rejects.toMatchObject({
      code: "self_demotion",
    });
    await expect(storage.updateUserKeepingAnAdmin("nobody", { role: "agent" }, a.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("POST toggle-status cannot deactivate the last active admin (it used to have no check)", async () => {
    await resetDb();
    const a = await createUser({ role: "admin" });
    const b = await createUser({ role: "admin" });
    const ag = await loginAs(ctx.app, a);
    // b is the only OTHER admin: deactivating b leaves a, allowed.
    expect((await ag.post(`/api/admin/users/${b.id}/toggle-status`)).status).toBe(200);
    // Now a is the only active admin; toggling a is refused.
    const res = await ag.post(`/api/admin/users/${a.id}/toggle-status`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_admin");
    expect((await storage.getUser(a.id))?.isActive).toBe(true);
  });
});
