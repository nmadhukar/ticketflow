import request from "supertest";
import { randomUUID } from "crypto";
import { departments, taskHistory, teams } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";

/** G1 (a department manager creates a team; GET /api/teams lists it), G4 (/api/teams/my follows membership), D2 (/api/activity limit and order). */
describe("team and activity caveats (G1, G4, D2)", () => {
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

  const department = async (managerId: string) => {
    const [d] = await db.insert(departments).values({ name: `Dept ${randomUUID().slice(0, 8)}`, managerId }).returning();
    return d;
  };

  describe("G1", () => {
    it("the manager of department D creates a team in D (201) and not in another department (403); an admin's GET /api/teams lists it", async () => {
      const m1 = await createUser({ role: "manager" });
      const m2 = await createUser({ role: "manager" });
      const d1 = await department(m1.id);
      const d2 = await department(m2.id);
      const manager = await loginAs(ctx.app, m1);

      const created = await manager.post("/api/teams").send({ name: "Service desk", departmentId: d1.id });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: "Service desk", departmentId: d1.id, createdBy: m1.id });

      const elsewhere = await manager.post("/api/teams").send({ name: "Intruders", departmentId: d2.id });
      expect(elsewhere.status).toBe(403);
      expect(elsewhere.body.error).toBe("forbidden");
      expect(await db.select().from(teams)).toHaveLength(1);

      const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const listed = await admin.get("/api/teams");
      expect(listed.status).toBe(200);
      expect((listed.body as any[]).map((t) => [t.id, t.name, t.departmentId])).toEqual([[created.body.id, "Service desk", d1.id]]);

      // The creating manager finds it under their own teams.
      const mine = await manager.get("/api/teams/my");
      expect(mine.status).toBe(200);
      expect((mine.body as any[]).map((t) => t.id)).toEqual([created.body.id]);
    });

    it("GET /api/teams: an agent is 403, a customer is 403, anonymous is 401", async () => {
      for (const role of ["agent", "customer"] as const) {
        const a = await loginAs(ctx.app, await createUser({ role }));
        expect([role, (await a.get("/api/teams")).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).get("/api/teams")).status).toBe(401);
    });
  });

  describe("G4", () => {
    it("after an admin adds a member, that member's GET /api/teams/my lists the team; after removal it does not", async () => {
      const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const m1 = await createUser({ role: "manager" });
      const d1 = await department(m1.id);
      const t1 = (await admin.post("/api/teams").send({ name: "Alpha", departmentId: d1.id })).body;
      const t2 = (await admin.post("/api/teams").send({ name: "Beta", departmentId: d1.id })).body;
      const memberUser = await createUser({ role: "agent" });
      const member = await loginAs(ctx.app, memberUser);
      const idsOf = async () => ((await member.get("/api/teams/my")).body as any[]).map((t) => t.id).sort();

      expect((await member.get("/api/teams/my")).status).toBe(200);
      expect(await idsOf()).toEqual([]);

      expect((await admin.post(`/api/admin/users/${memberUser.id}/assign-team`).send({ teamId: t1.id })).status).toBe(200);
      expect(await idsOf()).toEqual([t1.id]);

      expect((await admin.post(`/api/admin/users/${memberUser.id}/assign-team`).send({ teamId: t2.id })).status).toBe(200);
      expect(await idsOf()).toEqual([t1.id, t2.id].sort());

      expect((await admin.delete(`/api/admin/users/${memberUser.id}/remove-team/${t1.id}`)).status).toBe(204);
      expect(await idsOf()).toEqual([t2.id]);

      expect((await admin.delete(`/api/admin/users/${memberUser.id}/remove-team/${t2.id}`)).status).toBe(204);
      expect(await idsOf()).toEqual([]);
    });

    it("a customer is 403 on /api/teams/my and anonymous is 401", async () => {
      const c = await loginAs(ctx.app, await createUser({ role: "customer" }));
      expect((await c.get("/api/teams/my")).status).toBe(403);
      expect((await request(ctx.app).get("/api/teams/my")).status).toBe(401);
    });
  });

  describe("D2: GET /api/activity", () => {
    async function seedHistory(n: number) {
      const admin = await createUser({ role: "admin" });
      const adminA = await loginAs(ctx.app, admin);
      const ticket = await createTicketAs(adminA);
      expect(ticket.status).toBe(201);
      await db.delete(taskHistory); // keep only the rows below, with known timestamps
      const base = Date.now() - 3_600_000;
      const ids: number[] = [];
      for (let i = 0; i < n; i++) {
        const [row] = await db
          .insert(taskHistory)
          .values({ taskId: ticket.body.id, userId: admin.id, action: "updated", field: "notes", oldValue: `v${i}`, newValue: `v${i + 1}`, createdAt: new Date(base + i * 60_000) })
          .returning();
        ids.push(row.id);
      }
      return { adminA, ids };
    }

    it("?limit=N returns at most N rows, newest first", async () => {
      const { adminA, ids } = await seedHistory(12);
      for (const limit of [1, 3, 5, 12]) {
        const res = await adminA.get("/api/activity").query({ limit });
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(limit);
        expect((res.body as any[]).map((r) => r.id)).toEqual([...ids].reverse().slice(0, limit));
      }
      const all = await adminA.get("/api/activity").query({ limit: 50 });
      expect(all.body).toHaveLength(12); // fewer rows than the limit: all of them
      const times = (all.body as any[]).map((r) => new Date(r.createdAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it("no limit, or a limit that is not a positive integer, gives the default of 10", async () => {
      const { adminA } = await seedHistory(12);
      for (const q of [{}, { limit: "0" }, { limit: "-4" }, { limit: "abc" }]) {
        const res = await adminA.get("/api/activity").query(q);
        expect([JSON.stringify(q), res.status, res.body.length]).toEqual([JSON.stringify(q), 200, 10]);
      }
    });
  });
});
