import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";

describe("ticket history", () => {
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

  it("GET /history lists create, status change and reassignment, oldest first, with a public actor", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const adminA = await loginAs(ctx.app, admin);
    const t = await createTicketAs(adminA);
    expect(t.status).toBe(201);
    const id = t.body.id;
    await adminA.patch(`/api/tasks/${id}`).send({ status: "in_progress" }).expect(200);
    await adminA.patch(`/api/tasks/${id}`).send({ assigneeType: "user", assigneeId: agent.id }).expect(200);

    const res = await adminA.get(`/api/tasks/${id}/history`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);

    expect(res.body[0].action).toBe("created");

    const times = res.body.map((h: any) => new Date(h.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const ids = res.body.map((h: any) => h.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);

    for (const h of res.body) {
      expect(h).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          action: expect.any(String),
          createdAt: expect.any(String),
          user: expect.objectContaining({ id: admin.id, firstName: "admin" }),
        })
      );
      expect(h.user.password).toBeUndefined();
      expect(h.user.failedLoginAttempts).toBeUndefined();
      expect(h.user.lockedUntil).toBeUndefined();
      expect(h.user.passwordResetToken).toBeUndefined();
    }
    const status = res.body.find((h: any) => h.field === "status");
    expect(status).toEqual(expect.objectContaining({ oldValue: "open", newValue: "in_progress" }));
    const assignee = res.body.find((h: any) => h.field === "assigneeId");
    expect(assignee).toEqual(expect.objectContaining({ newValue: agent.id }));
  });

  it("a customer outside the ticket is 403, a missing ticket is 404, a bad id is 400", async () => {
    const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const t = await createTicketAs(adminA);
    const stranger = await loginAs(ctx.app, await createUser({ role: "customer" }));
    const res = await stranger.get(`/api/tasks/${t.body.id}/history`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect((await adminA.get("/api/tasks/999999/history")).status).toBe(404);
    expect((await adminA.get("/api/tasks/abc/history")).status).toBe(400);
    expect((await request(ctx.app).get(`/api/tasks/${t.body.id}/history`)).status).toBe(401);
  });

  it("updateTask records null, 0, false and the empty string faithfully", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const t = await createTicketAs(adminA, { notes: "first" });
    const id = t.body.id as number;

    await storage.updateTask(id, { estimatedHours: 5 }, admin.id); // null -> 5
    await storage.updateTask(id, { estimatedHours: 0 }, admin.id); // 5 -> 0
    await storage.updateTask(id, { estimatedHours: null }, admin.id); // 0 -> null
    await storage.updateTask(id, { notes: "" }, admin.id); // "first" -> ""

    const res = await adminA.get(`/api/tasks/${id}/history`);
    const hours = res.body.filter((h: any) => h.field === "estimatedHours");
    expect(hours.map((h: any) => [h.oldValue, h.newValue])).toEqual([
      [null, "5"],
      ["5", "0"],
      ["0", null],
    ]);
    const notes = res.body.filter((h: any) => h.field === "notes");
    expect(notes.map((h: any) => [h.oldValue, h.newValue])).toEqual([["first", ""]]);
  });

  it("updateTask on a ticket deleted mid-request is 404 not_found; a conditional status miss stays 409", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const t = await createTicketAs(adminA);
    const id = t.body.id as number;

    // Status moved under the caller: conditional write is a 409.
    await expect(
      storage.updateTask(id, { status: "closed" }, admin.id, { expectedStatus: "resolved" })
    ).rejects.toMatchObject({ status: 409, code: "invalid_transition" });

    // Row vanishes after the existence check (simulated by racing the delete).
    const realGet = storage.getTask.bind(storage);
    const spy = jest.spyOn(storage, "getTask").mockImplementation(async (tid: number) => {
      const row = await realGet(tid);
      await storage.deleteTask(tid);
      return row;
    });
    await expect(storage.updateTask(id, { notes: "late" }, admin.id)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    spy.mockRestore();
  });
});
