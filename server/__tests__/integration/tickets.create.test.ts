import { eq, sql } from "drizzle-orm";
import { tasks, teamMembers } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";

async function ticketCount(): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(tasks);
  return r[0].n;
}

describe("ticket create and update validation", () => {
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
    return {
      admin,
      agent,
      customer,
      adminA: await loginAs(ctx.app, admin),
      agentA: await loginAs(ctx.app, agent),
      customerA: await loginAs(ctx.app, customer),
    };
  }

  it("T1: create returns 201 with ticketNumber, status open and createdBy the caller", async () => {
    const { agent, agentA } = await actors();
    const res = await createTicketAs(agentA, { title: "  Printer jam  " });
    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^TKT-/);
    expect(res.body.status).toBe("open");
    expect(res.body.createdBy).toBe(agent.id);
    expect(res.body.title).toBe("Printer jam");
  });

  it("T2: bad title, priority or category is 400 with details and writes nothing", async () => {
    const { adminA } = await actors();
    const bad: Array<[string, Record<string, unknown>, string]> = [
      ["missing title", { title: undefined }, "title"],
      ["blank title", { title: "   " }, "title"],
      ["priority critical", { priority: "critical" }, "priority"],
      ["unknown category", { category: "nonsense" }, "category"],
      ["missing category", { category: undefined }, "category"],
    ];
    for (const [name, body, field] of bad) {
      const res = await createTicketAs(adminA, body);
      expect([name, res.status]).toEqual([name, 400]);
      expect(res.body.error).toBe("validation_failed");
      expect(res.body.details.fieldErrors[field]).toBeDefined();
    }
    expect(await ticketCount()).toBe(0);
  });

  it("server-owned fields in a create body are 400 and write nothing", async () => {
    const { adminA, admin } = await actors();
    const owned: Array<Record<string, unknown>> = [
      { status: "closed" },
      { status: "open" },
      { resolvedAt: new Date().toISOString() },
      { closedAt: new Date().toISOString() },
      { createdBy: admin.id },
      { ticketNumber: "TKT-0000-0001" },
    ];
    for (const extra of owned) {
      const res = await createTicketAs(adminA, extra);
      expect([JSON.stringify(extra), res.status]).toEqual([JSON.stringify(extra), 400]);
    }
    expect(await ticketCount()).toBe(0);
  });

  it("R3 and T18: staff set hours, dueDate and tags and read them back; a customer cannot set hours", async () => {
    const { adminA, agentA, customerA } = await actors();
    const due = "2030-01-15T00:00:00.000Z";
    const created = await createTicketAs(adminA, {
      estimatedHours: 8,
      actualHours: 3,
      dueDate: due,
      tags: ["ui", "urgent-ish"],
    });
    expect(created.status).toBe(201);
    const read = await adminA.get(`/api/tasks/${created.body.id}`);
    expect(read.body.estimatedHours).toBe(8);
    expect(read.body.actualHours).toBe(3);
    expect(new Date(read.body.dueDate).toISOString()).toBe(due);
    expect(read.body.tags).toEqual(["ui", "urgent-ish"]);

    // Staff PATCH reads back unchanged too (an agent on a ticket they created).
    const own = await createTicketAs(agentA);
    const patched = await agentA.patch(`/api/tasks/${own.body.id}`).send({ estimatedHours: 5, actualHours: 2 });
    expect(patched.status).toBe(200);
    expect(patched.body.estimatedHours).toBe(5);
    expect(patched.body.actualHours).toBe(2);
    const adminPatch = await adminA
      .patch(`/api/tasks/${created.body.id}`)
      .send({ tags: ["a"], dueDate: "2031-02-02T00:00:00.000Z", estimatedHours: 13 });
    expect(adminPatch.status).toBe(200);
    expect(adminPatch.body.tags).toEqual(["a"]);
    expect(adminPatch.body.estimatedHours).toBe(13);

    // Customer: 400 on create, 403 on PATCH.
    const before = await ticketCount();
    for (const f of ["estimatedHours", "actualHours"]) {
      const res = await createTicketAs(customerA, { [f]: 4 });
      expect([f, res.status]).toEqual([f, 400]);
    }
    expect(await ticketCount()).toBe(before);
    const mine = await createTicketAs(customerA);
    expect(mine.status).toBe(201);
    for (const f of ["estimatedHours", "actualHours"]) {
      const res = await customerA.patch(`/api/tasks/${mine.body.id}`).send({ [f]: 4 });
      expect([f, res.status]).toEqual([f, 403]);
    }
    const unchanged = await adminA.get(`/api/tasks/${mine.body.id}`);
    expect(unchanged.body.estimatedHours).toBeNull();
  });

  it("PATCH with an unknown category, priority or blank title is 400 with details", async () => {
    const { adminA } = await actors();
    const t = await createTicketAs(adminA);
    for (const [field, value] of [
      ["category", "nonsense"],
      ["priority", "critical"],
      ["title", "  "],
    ] as const) {
      const res = await adminA.patch(`/api/tasks/${t.body.id}`).send({ [field]: value });
      expect([field, res.status]).toEqual([field, 400]);
      expect(res.body.error).toBe("validation_failed");
      expect(res.body.details.fieldErrors[field]).toBeDefined();
    }
    const after = await adminA.get(`/api/tasks/${t.body.id}`);
    expect(after.body.category).toBe("support");
    expect(after.body.priority).toBe("medium");
  });

  it("staff create keeps one assignee kind and sets the type; a bad assigneeType is 400", async () => {
    const { admin, agent, adminA } = await actors();
    const team = await createTeam(admin);

    // Both ids and no type is ambiguous: refused, nothing written.
    const ambiguous = await createTicketAs(adminA, { assigneeId: agent.id, assigneeTeamId: team.id });
    expect(ambiguous.status).toBe(400);
    expect(await ticketCount()).toBe(0);

    // One id: the type follows it.
    const byUser = await createTicketAs(adminA, { assigneeId: agent.id });
    expect(byUser.status).toBe(201);
    expect(byUser.body.assigneeType).toBe("user");
    expect(byUser.body.assigneeTeamId).toBeNull();
    const byTeam = await createTicketAs(adminA, { assigneeTeamId: team.id });
    expect(byTeam.body.assigneeType).toBe("team");
    expect(byTeam.body.assigneeId).toBeNull();

    // Both ids with a type: the other column is cleared.
    const typedTeam = await createTicketAs(adminA, {
      assigneeId: agent.id,
      assigneeTeamId: team.id,
      assigneeType: "team",
    });
    expect(typedTeam.body.assigneeType).toBe("team");
    expect(typedTeam.body.assigneeId).toBeNull();
    expect(typedTeam.body.assigneeTeamId).toBe(team.id);
    const typedUser = await createTicketAs(adminA, {
      assigneeId: agent.id,
      assigneeTeamId: team.id,
      assigneeType: "user",
    });
    expect(typedUser.body.assigneeId).toBe(agent.id);
    expect(typedUser.body.assigneeTeamId).toBeNull();

    const before = await ticketCount();
    for (const assigneeType of ["group", "", "USER"]) {
      const res = await createTicketAs(adminA, { assigneeType });
      expect([assigneeType, res.status]).toEqual([assigneeType, 400]);
      expect(res.body.details.fieldErrors.assigneeType).toBeDefined();
    }
    expect(await ticketCount()).toBe(before);
  });

  it("includeOwn=false treats a team-queued ticket with a stale assignee_id equal to the caller as team-queued", async () => {
    const admin = await createUser({ role: "admin" });
    const me = await createUser({ role: "agent" });
    const customer = await createUser({ role: "customer" });
    const team = await createTeam(admin);
    await db.insert(teamMembers).values({ teamId: team.id, userId: me.id } as any);
    let n = 0;
    const mk = async (over: Record<string, unknown>) =>
      (
        await db
          .insert(tasks)
          .values({
            ticketNumber: `TKT-OWN-${++n}`,
            title: "t",
            category: "support",
            createdBy: customer.id,
            ...over,
          } as any)
          .returning()
      )[0];
    const queuedStale = await mk({ assigneeType: "team", assigneeTeamId: team.id, assigneeId: me.id });
    const mine = await mk({ assigneeType: "user", assigneeId: me.id });
    const legacyMine = await mk({ assigneeType: null, assigneeId: me.id });

    const all = await storage.getVisibleTasksForUser({ userId: me.id, role: "agent" });
    expect(all.map((t) => t.id).sort()).toEqual([queuedStale.id, mine.id, legacyMine.id].sort());
    const others = await storage.getVisibleTasksForUser({ userId: me.id, role: "agent", includeOwn: false });
    expect(others.map((t) => t.id)).toEqual([queuedStale.id]);
  });

  it("getTask shows the assignee name when assignee_type is NULL", async () => {
    const agent = await createUser({ role: "agent" });
    const customer = await createUser({ role: "customer" });
    const [row] = await db
      .insert(tasks)
      .values({
        ticketNumber: "TKT-NULLTYPE-1",
        title: "t",
        category: "support",
        createdBy: customer.id,
        assigneeId: agent.id,
        assigneeType: null,
      } as any)
      .returning();
    const t = await storage.getTask(row.id);
    expect(t.assigneeName).toBe("agent Tester");
    expect(t.assignedToName).toBe("agent Tester");
    const [raw] = await db.select().from(tasks).where(eq(tasks.id, row.id));
    expect(raw.assigneeType).toBeNull();
  });

  it("a nonexistent assignee user or team is 400 naming the field, and writes nothing", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, admin);
    const u = await createTicketAs(a, { assigneeId: "no-such-user" });
    expect(u.status).toBe(400);
    expect(u.body.error).toBe("validation_failed");
    expect(u.body.details.fieldErrors.assigneeId).toBeDefined();
    const t = await createTicketAs(a, { assigneeTeamId: 999999 });
    expect(t.status).toBe(400);
    expect(t.body.details.fieldErrors.assigneeTeamId).toBeDefined();
    expect(await ticketCount()).toBe(0);

    // PATCH has the same check.
    const ok = await createTicketAs(a);
    const p = await a.patch(`/api/tasks/${ok.body.id}`).send({ assigneeId: "no-such-user" });
    expect(p.status).toBe(400);
    expect(p.body.details.fieldErrors.assigneeId).toBeDefined();
    const p2 = await a.patch(`/api/tasks/${ok.body.id}`).send({ assigneeTeamId: 999999 });
    expect(p2.status).toBe(400);
  });

  it("a blank assigneeId is no assignee", async () => {
    const a = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const res = await createTicketAs(a, { assigneeId: "" });
    expect(res.status).toBe(201);
    expect(res.body.assigneeId).toBeNull();
  });

  it("R16: an agent may assign a new ticket only to themself or to a team they belong to", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const other = await createUser({ role: "agent" });
    const mine = await createTeam(admin);
    const notMine = await createTeam(admin);
    await db.insert(teamMembers).values({ teamId: mine.id, userId: agent.id } as any);
    const a = await loginAs(ctx.app, agent);

    const self = await createTicketAs(a, { assigneeType: "user", assigneeId: agent.id });
    expect(self.status).toBe(201);
    const own = await createTicketAs(a, { assigneeTeamId: mine.id });
    expect(own.status).toBe(201);
    expect(own.body.assigneeType).toBe("team");
    const before = await ticketCount();
    for (const body of [{ assigneeId: other.id }, { assigneeTeamId: notMine.id }]) {
      const res = await createTicketAs(a, body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 403]);
      expect(res.body.error).toBe("forbidden");
    }
    expect(await ticketCount()).toBe(before);

    // Admin is unrestricted.
    const adminA = await loginAs(ctx.app, admin);
    expect((await createTicketAs(adminA, { assigneeId: other.id })).status).toBe(201);
  });

  it("PATCH dueDate null clears it; an absent dueDate leaves it", async () => {
    const a = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const t = await createTicketAs(a, { dueDate: "2030-01-15T00:00:00.000Z" });
    expect((await a.get(`/api/tasks/${t.body.id}`)).body.dueDate).not.toBeNull();
    expect((await a.patch(`/api/tasks/${t.body.id}`).send({ notes: "x" })).status).toBe(200);
    expect((await a.get(`/api/tasks/${t.body.id}`)).body.dueDate).not.toBeNull();
    const cleared = await a.patch(`/api/tasks/${t.body.id}`).send({ dueDate: null });
    expect(cleared.status).toBe(200);
    expect((await a.get(`/api/tasks/${t.body.id}`)).body.dueDate).toBeNull();
  });

  it("multipart create with tags (JSON string) and a file is 201 and tags read back", async () => {
    const { s3Service } = await import("../../services/s3Service");
    jest.spyOn(s3Service, "isConfigured").mockResolvedValue({ isConfigured: true, missing: [] } as any);
    jest.spyOn(s3Service, "uploadFile").mockResolvedValue(undefined as any);
    const a = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const res = await a
      .post("/api/tasks")
      .field("title", "With file")
      .field("category", "support")
      .field("tags", JSON.stringify(["a", "b"]))
      .attach("files", Buffer.from("hello"), "note.txt");
    expect(res.status).toBe(201);
    expect((await a.get(`/api/tasks/${res.body.id}`)).body.tags).toEqual(["a", "b"]);
    // A bare comma string is ambiguous and refused.
    const bad = await a
      .post("/api/tasks")
      .field("title", "Bad tags")
      .field("category", "support")
      .field("tags", "a,b");
    expect(bad.status).toBe(400);
  });
});
