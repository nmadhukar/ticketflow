import { eq } from "drizzle-orm";
import { tasks, type User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
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
    const { adminA, admin } = await actors();
    const t = (await createTicketAs(adminA, { title: "printer jam" })).body;
    await createTicketAs(adminA, { title: "unrelated" });

    const list = await adminA.get("/api/tasks").query({ search: "PRINTER" });
    expect(list.status).toBe(200);
    const rows: any[] = Array.isArray(list.body) ? list.body : (list.body.tasks ?? []);
    expect(rows.map((x) => x.id)).toEqual([t.id]);

    const filtered = await storage.getTasks({ search: "PRINTER" });
    expect(filtered.map((x: any) => x.id)).toEqual([t.id]);
    expect(admin.id).toBeTruthy();
  });
});
