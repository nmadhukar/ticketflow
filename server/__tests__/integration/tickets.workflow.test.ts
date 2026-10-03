import { eq, sql } from "drizzle-orm";
import { tasks, type User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { buildTicketMeta } from "../../services/tickets/meta";
import { db } from "../../storage/db";

describe("ticket workflow, meta route and search", () => {
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function actors() {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const customer = await createUser({ role: "customer" });
    const other = await createUser({ role: "customer" });
    return {
      admin,
      agent,
      customer,
      adminA: await loginAs(ctx.app, admin),
      agentA: await loginAs(ctx.app, agent),
      customerA: await loginAs(ctx.app, customer),
      otherA: await loginAs(ctx.app, other),
    };
  }
  const row = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];
  const assignTo = (id: number, u: User) =>
    db.update(tasks).set({ assigneeType: "user", assigneeId: u.id }).where(eq(tasks.id, id));

  it("agent resolves then closes an accessible ticket; timestamps follow", async () => {
    const { agentA } = await actors();
    const t = (await createTicketAs(agentA)).body;
    let res = await agentA.patch(`/api/tasks/${t.id}`).send({ status: "resolved" });
    expect(res.status).toBe(200);
    expect((await row(t.id)).resolvedAt).not.toBeNull();
    res = await agentA.patch(`/api/tasks/${t.id}`).send({ status: "closed" });
    expect(res.status).toBe(200);
    const r = await row(t.id);
    expect(r.status).toBe("closed");
    expect(r.closedAt).not.toBeNull();
  });

  it("agent resolved -> on_hold is 409 invalid_transition; same status is a 200 no-op", async () => {
    const { agentA } = await actors();
    const t = (await createTicketAs(agentA)).body;
    await agentA.patch(`/api/tasks/${t.id}`).send({ status: "resolved" });
    const bad = await agentA.patch(`/api/tasks/${t.id}`).send({ status: "on_hold" });
    expect(bad.status).toBe(409);
    expect(bad.body.error).toBe("invalid_transition");
    expect((await row(t.id)).status).toBe("resolved");
    const same = await agentA.patch(`/api/tasks/${t.id}`).send({ status: "resolved" });
    expect(same.status).toBe(200);
    expect((await row(t.id)).status).toBe("resolved");
  });

  it("customer cannot close their own ticket (403); can reopen it once closed", async () => {
    const { adminA, customerA, customer } = await actors();
    const t = (await createTicketAs(customerA)).body;
    expect(t.createdBy).toBe(customer.id);
    const close = await customerA.patch(`/api/tasks/${t.id}`).send({ status: "closed" });
    expect(close.status).toBe(403);
    expect((await row(t.id)).status).toBe("open");

    expect((await adminA.patch(`/api/tasks/${t.id}`).send({ status: "resolved" })).status).toBe(200);
    expect((await adminA.patch(`/api/tasks/${t.id}`).send({ status: "closed" })).status).toBe(200);
    const closed = await row(t.id);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.resolvedAt).not.toBeNull();

    const reopen = await customerA.patch(`/api/tasks/${t.id}`).send({ status: "open" });
    expect(reopen.status).toBe(200);
    const r = await row(t.id);
    expect(r.status).toBe("open");
    expect(r.closedAt).toBeNull();
    expect(r.resolvedAt).toBeNull();
  });

  it("customer reopening someone else's ticket is refused by the access gate", async () => {
    const { adminA, customerA, otherA } = await actors();
    const t = (await createTicketAs(customerA)).body;
    await adminA.patch(`/api/tasks/${t.id}`).send({ status: "closed" });
    const res = await otherA.patch(`/api/tasks/${t.id}`).send({ status: "open" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect((await row(t.id)).status).toBe("closed");
  });

  it("meta: allowedFields equals what PATCH accepts, per role", async () => {
    const { adminA, agentA, customerA, agent } = await actors();
    const t = (await createTicketAs(customerA)).body;
    await assignTo(t.id, agent);

    const admin = (await adminA.get(`/api/tickets/${t.id}/meta`)).body.permissions;
    for (const f of ["tags", "estimatedHours", "actualHours", "dueDate", "departmentId", "teamId"]) {
      expect(admin.allowedFields).toContain(f);
    }
    const ag = (await agentA.get(`/api/tickets/${t.id}/meta`)).body.permissions;
    expect([...ag.allowedFields].sort()).toEqual(
      ["actualHours", "estimatedHours", "notes", "priority", "status"].sort()
    );
    expect([...ag.allowedStatuses].sort()).toEqual(["closed", "in_progress", "on_hold", "resolved"]);
    expect(ag.canChangeStatus).toBe(true);

    const cu = (await customerA.get(`/api/tickets/${t.id}/meta`)).body.permissions;
    expect([...cu.allowedFields].sort()).toEqual(["description", "notes", "title"]);
    expect(cu.canChangeStatus).toBe(false);
    // The customer meta matches PATCH: hours are refused, notes accepted.
    expect((await customerA.patch(`/api/tasks/${t.id}`).send({ estimatedHours: 3 })).status).toBe(403);
    expect((await customerA.patch(`/api/tasks/${t.id}`).send({ notes: "n" })).status).toBe(200);

    // Once closed, the customer's meta offers status (reopen) and PATCH takes it.
    await adminA.patch(`/api/tasks/${t.id}`).send({ status: "closed" });
    const cu2 = (await customerA.get(`/api/tickets/${t.id}/meta`)).body.permissions;
    expect(cu2.allowedFields).toContain("status");
    expect(cu2.allowedStatuses).toEqual(["open"]);
  });

  it("every field meta lists is accepted by PATCH for admin, manager, agent and customer", async () => {
    const { admin, adminA, agent, agentA, customerA } = await actors();
    const manager = await createUser({ role: "manager" });
    const managerA = await loginAs(ctx.app, manager);
    const sample: Record<string, unknown> = {
      title: "retitled",
      description: "d",
      category: "bug",
      priority: "high",
      notes: "n",
      assigneeId: admin.id,
      assigneeType: "user",
      assigneeTeamId: null,
      dueDate: "2030-01-01T00:00:00.000Z",
      departmentId: null,
      teamId: null,
      tags: ["a"],
      estimatedHours: 2,
      actualHours: 1,
    };
    for (const [name, a] of [
      ["admin", adminA],
      ["manager", managerA],
      ["agent", agentA],
      ["customer", customerA],
    ] as const) {
      const t = (await createTicketAs(name === "customer" ? customerA : adminA)).body;
      await db.update(tasks).set({ assigneeType: "user", assigneeId: agent.id }).where(eq(tasks.id, t.id));
      if (name === "manager") {
        await db.update(tasks).set({ createdBy: manager.id }).where(eq(tasks.id, t.id));
      }
      const fields: string[] = (await a.get(`/api/tickets/${t.id}/meta`)).body.permissions.allowedFields;
      expect(fields.length).toBeGreaterThan(0);
      for (const f of fields) {
        const body = f === "status" ? { status: "in_progress" } : { [f]: sample[f] };
        const res = await a.patch(`/api/tasks/${t.id}`).send(body);
        expect([name, f, res.status]).toEqual([name, f, 200]);
      }
    }
    // A staff-only field missing from a customer's list is refused.
    const t2 = (await createTicketAs(customerA)).body;
    const cfields: string[] = (await customerA.get(`/api/tickets/${t2.id}/meta`)).body.permissions.allowedFields;
    for (const f of ["estimatedHours", "actualHours"]) {
      expect(cfields).not.toContain(f);
      expect((await customerA.patch(`/api/tasks/${t2.id}`).send({ [f]: 4 })).status).toBe(403);
    }
  });

  it("customer: a combined body with a refused status is refused whole; reopen of RESOLVED works; same status is a no-op", async () => {
    const { adminA, customerA } = await actors();
    const t = (await createTicketAs(customerA, { title: "orig" })).body;
    const combined = await customerA.patch(`/api/tasks/${t.id}`).send({ status: "closed", title: "x" });
    expect(combined.status).toBe(403);
    const r0 = await row(t.id);
    expect([r0.title, r0.status]).toEqual(["orig", "open"]);

    const noop = await customerA.patch(`/api/tasks/${t.id}`).send({ status: "open" });
    expect(noop.status).toBe(200);
    expect((await row(t.id)).status).toBe("open");

    await adminA.patch(`/api/tasks/${t.id}`).send({ status: "resolved" });
    expect((await row(t.id)).resolvedAt).not.toBeNull();
    const reopen = await customerA.patch(`/api/tasks/${t.id}`).send({ status: "open" });
    expect(reopen.status).toBe(200);
    const r = await row(t.id);
    expect([r.status, r.resolvedAt, r.closedAt]).toEqual(["open", null, null]);
  });

  it("a stored status outside the vocabulary does not crash: meta 200, staff may move it, customer gets nothing", async () => {
    const { adminA, agent, agentA, customerA } = await actors();
    const t = (await createTicketAs(customerA)).body;
    await db.update(tasks).set({ status: "pending", assigneeType: "user", assigneeId: agent.id }).where(eq(tasks.id, t.id));
    const meta = await adminA.get(`/api/tickets/${t.id}/meta`);
    expect(meta.status).toBe(200);
    expect([...meta.body.permissions.allowedStatuses].sort()).toEqual(
      ["closed", "in_progress", "on_hold", "open", "resolved"]
    );
    const cmeta = await customerA.get(`/api/tickets/${t.id}/meta`);
    expect(cmeta.status).toBe(200);
    expect(cmeta.body.permissions.allowedStatuses).toEqual([]);
    expect((await customerA.patch(`/api/tasks/${t.id}`).send({ status: "open" })).status).toBe(403);
    expect((await agentA.patch(`/api/tasks/${t.id}`).send({ status: "in_progress" })).status).toBe(200);
    expect((await row(t.id)).status).toBe("in_progress");
  });

  it("the status write is conditional on the status the guard checked (stale from -> 409)", async () => {
    const { admin, adminA } = await actors();
    const t = (await createTicketAs(adminA)).body;
    await db.update(tasks).set({ status: "on_hold" }).where(eq(tasks.id, t.id)); // changes between read and write
    await expect(
      storage.updateTask(t.id, { status: "resolved" }, admin.id, { expectedStatus: "open" })
    ).rejects.toMatchObject({ status: 409, code: "invalid_transition" });
    expect((await row(t.id)).status).toBe("on_hold");
    const ok = await storage.updateTask(t.id, { status: "resolved" }, admin.id, { expectedStatus: "on_hold" });
    expect(ok.status).toBe("resolved");
  });

  it("an unknown role never gets meta: the session layer fails closed (401) and buildTicketMeta refuses it", async () => {
    const odd = await createUser({ role: "agent" });
    const oddA = await loginAs(ctx.app, odd);
    await db.execute(sql`UPDATE users SET role = 'superuser' WHERE id = ${odd.id}`);
    // The deserializer rejects an unknown role before any route runs, so the route's own
    // 403 forbidden branch (buildTicketMeta -> null) is defence in depth, pinned here directly.
    expect((await oddA.get("/api/tickets/meta")).status).toBe(401);
    expect(await buildTicketMeta({ id: odd.id, role: "superuser" })).toBeNull();
  });

  it("I2: a customer's meta lists active staff as {id, displayName} only: no email, no role, no inactive staff", async () => {
    const { customerA, agent, admin } = await actors();
    const manager = await createUser({ role: "manager", email: "manager.person@example.test" });
    const inactive = await createUser({ role: "agent", isActive: false });
    const unapproved = await createUser({ role: "agent", isApproved: false });
    const legacy = await createUser({ role: "agent" });
    await db.execute(sql`UPDATE users SET role = 'user', first_name = 'Lee', last_name = 'Legacy' WHERE id = ${legacy.id}`);
    const nameless = await createUser({ role: "agent" });
    await db.execute(sql`UPDATE users SET first_name = NULL, last_name = NULL WHERE id = ${nameless.id}`);
    const nullActive = await createUser({ role: "agent" });
    await db.execute(sql`UPDATE users SET is_active = NULL WHERE id = ${nullActive.id}`);

    const res = await customerA.get("/api/tickets/meta");
    expect(res.status).toBe(200);
    const listed = res.body.assignableUsers as Array<Record<string, unknown>>;
    expect(JSON.stringify(listed)).not.toContain("@");
    for (const u of listed) expect(Object.keys(u).sort()).toEqual(["displayName", "id"]);
    const ids = listed.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([agent.id, manager.id, legacy.id, nameless.id]));
    for (const hidden of [inactive.id, unapproved.id, nullActive.id, admin.id]) expect(ids).not.toContain(hidden);
    expect(listed.find((u) => u.id === legacy.id)?.displayName).toBe("Lee Legacy");
    expect(listed.find((u) => u.id === nameless.id)?.displayName).toBe("Support agent");

    // The same customer can still create a ticket addressed to a listed agent.
    const created = await createTicketAs(customerA, { assigneeType: "user", assigneeId: agent.id });
    expect(created.status).toBe(201);
    expect(created.body.assigneeId).toBe(agent.id);
    const perTicket = await customerA.get(`/api/tickets/${created.body.id}/meta`);
    expect(perTicket.status).toBe(200);
    expect(JSON.stringify(perTicket.body.assignableUsers)).not.toContain("@");

    // Staff still get the full list (unchanged).
    const staff = await (await loginAs(ctx.app, admin)).get("/api/tickets/meta");
    expect(staff.body.assignableUsers.find((u: { id: string }) => u.id === manager.id)?.email).toBe(
      "manager.person@example.test"
    );
  });

  it("meta makes no outbound request and ignores a forged Host header", async () => {
    const { adminA, agentA } = await actors();
    const t = (await createTicketAs(agentA)).body;
    const fetchSpy = jest.spyOn(globalThis, "fetch" as any);
    const res = await adminA.get(`/api/tickets/${t.id}/meta`).set("Host", "evil.invalid:9");
    expect(res.status).toBe(200);
    expect(res.body.statuses).toEqual(["open", "in_progress", "resolved", "closed", "on_hold"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("search is case-insensitive in both search paths", async () => {
    const { adminA } = await actors();
    const t = (await createTicketAs(adminA, { title: "printer jam" })).body;
    await createTicketAs(adminA, { title: "unrelated" });

    const list = await adminA.get("/api/tasks").query({ search: "PRINTER" });
    expect(list.status).toBe(200);
    const rows: any[] = Array.isArray(list.body) ? list.body : (list.body.tasks ?? []);
    expect(rows.map((x) => x.id)).toEqual([t.id]);

    const filtered = await storage.getTasks({ search: "PRINTER" });
    expect(filtered.map((x: any) => x.id)).toEqual([t.id]);
  });
});
