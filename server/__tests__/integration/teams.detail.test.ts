import { and, eq } from "drizzle-orm";
import { teamAdmins, type User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";

/**
 * G2: team detail and members. G3 (superseded, R38): a member's role was removed from the
 * product ("use team admins instead"), no client calls PATCH /api/teams/:teamId/members/:userId,
 * and the path that replaced it is granting and revoking team admins. That path is tested here.
 *
 *   D1 managed by M1 -> T1 with members A1 and A2 ; D2 managed by M2 -> T2 ; A3 is on no team
 */
describe("team detail, members (G2) and team admins instead of member roles (G3)", () => {
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

  async function world() {
    const admin = await createUser({ role: "admin" });
    const m1 = await createUser({ role: "manager" });
    const m2 = await createUser({ role: "manager" });
    const a1 = await createUser({ role: "agent" });
    const a2 = await createUser({ role: "agent" });
    const a3 = await createUser({ role: "agent" });
    const c1 = await createUser({ role: "customer" });
    const t1 = await createTeam(m1, { name: "Platform" });
    const t2 = await createTeam(m2);
    await storage.addTeamMember({ teamId: t1.id, userId: a1.id });
    await storage.addTeamMember({ teamId: t1.id, userId: a2.id });
    const as = (u: User) => loginAs(ctx.app, u);
    return { admin, m1, m2, a1, a2, a3, c1, t1, t2, as };
  }
  const isAdminRow = async (teamId: number, userId: string) =>
    (await db.select().from(teamAdmins).where(and(eq(teamAdmins.teamId, teamId), eq(teamAdmins.userId, userId)))).length > 0;

  describe("G2: GET /api/teams/:id and /api/teams/:id/members", () => {
    it("returns the team: id, name, department", async () => {
      const w = await world();
      const res = await (await w.as(w.admin)).get(`/api/teams/${w.t1.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: w.t1.id, name: "Platform", departmentId: w.t1.departmentId });
    });

    it("a customer gets 403 forbidden and no team record; staff roles get it", async () => {
      const w = await world();
      const denied = await (await w.as(w.c1)).get(`/api/teams/${w.t1.id}`);
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("forbidden");
      expect(denied.body.name).toBeUndefined();
      for (const who of ["admin", "m1", "m2", "a1", "a3"] as const) {
        const res = await (await w.as((w as any)[who] as User)).get(`/api/teams/${w.t1.id}`);
        expect([who, res.status]).toEqual([who, 200]);
      }
      const request = (await import("supertest")).default;
      expect((await request(ctx.app).get(`/api/teams/${w.t1.id}`)).status).toBe(401);
    });

    it("an unknown team is 404 and a non-numeric id is 400", async () => {
      const w = await world();
      const admin = await w.as(w.admin);
      expect((await admin.get("/api/teams/999999")).status).toBe(404);
      expect((await admin.get("/api/teams/abc")).status).toBe(400);
      expect((await admin.get("/api/teams/abc/members")).status).toBe(400);
    });

    it("lists the members of the team with their public details and an isAdmin flag, never a password or role", async () => {
      const w = await world();
      await storage.addTeamAdmin(w.a1.id, w.t1.id, w.m1.id);
      const res = await (await w.as(w.admin)).get(`/api/teams/${w.t1.id}/members`);
      expect(res.status).toBe(200);
      // The creator (M1) is a member of the team they made, then A1 and A2.
      expect(res.body).toHaveLength(3);
      const byUser = Object.fromEntries(res.body.map((m: any) => [m.userId, m]));
      expect(Object.keys(byUser).sort()).toEqual([w.m1.id, w.a1.id, w.a2.id].sort());
      expect(byUser[w.m1.id].isAdmin).toBe(false);
      expect(byUser[w.a1.id].isAdmin).toBe(true);
      expect(byUser[w.a2.id].isAdmin).toBe(false);
      expect(byUser[w.a1.id].user.firstName).toBe("agent");
      expect(byUser[w.a1.id].role).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it("a team lists only its own members, and a new member shows up", async () => {
      const w = await world();
      const admin = await w.as(w.admin);
      const before = await admin.get(`/api/teams/${w.t2.id}/members`);
      expect(before.body.map((m: any) => m.userId)).toEqual([w.m2.id]); // just its creator
      await storage.addTeamMember({ teamId: w.t2.id, userId: w.a3.id });
      const after = await admin.get(`/api/teams/${w.t2.id}/members`);
      expect(after.body.map((m: any) => m.userId).sort()).toEqual([w.m2.id, w.a3.id].sort());
      // T1 is unaffected.
      expect((await admin.get(`/api/teams/${w.t1.id}/members`)).body).toHaveLength(3);
    });

    it.each([
      ["admin", "admin", 200],
      ["manager of the department", "m1", 200],
      ["agent who is a member", "a1", 200],
      ["agent who is not a member", "a3", 403],
      ["manager of another department", "m2", 403],
      ["customer", "c1", 403],
    ] as const)("members of T1 for %s (%s) -> %i", async (_label, who, status) => {
      const w = await world();
      const res = await (await w.as((w as any)[who] as User)).get(`/api/teams/${w.t1.id}/members`);
      expect(res.status).toBe(status);
      if (status === 200) expect(res.body).toHaveLength(3);
      else expect(res.body.error).toBe("forbidden");
    });
  });

  describe("G3 (superseded): team admins replace the member role", () => {
    it("PATCH on a member is a compatibility no-op: it returns the member and a role in the body changes nothing", async () => {
      const w = await world();
      const m1 = await w.as(w.m1);
      const res = await m1.patch(`/api/teams/${w.t1.id}/members/${w.a2.id}`).send({ role: "admin" });
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(w.a2.id);
      expect(await isAdminRow(w.t1.id, w.a2.id)).toBe(false);
      const members = await m1.get(`/api/teams/${w.t1.id}/members`);
      expect(members.body.find((m: any) => m.userId === w.a2.id).isAdmin).toBe(false);
      // A user who is not on the team is not found.
      expect((await m1.patch(`/api/teams/${w.t1.id}/members/${w.a3.id}`).send({ role: "admin" })).status).toBe(404);
    });

    it("PATCH by an unauthorised caller is 403 (so a member cannot self-promote through it)", async () => {
      const w = await world();
      for (const who of ["a2", "a3", "c1", "m2"] as const) {
        const res = await (await w.as((w as any)[who] as User)).patch(`/api/teams/${w.t1.id}/members/${w.a2.id}`).send({ role: "admin" });
        expect([who, res.status]).toEqual([who, 403]);
      }
      expect(await isAdminRow(w.t1.id, w.a2.id)).toBe(false);
    });

    it("the replacing path: a department manager grants team admin to a member, who then manages the team", async () => {
      const w = await world();
      const m1 = await w.as(w.m1);
      const granted = await m1.post(`/api/teams/${w.t1.id}/admins`).send({ memberId: w.a1.id });
      expect(granted.status).toBe(201);
      expect(await isAdminRow(w.t1.id, w.a1.id)).toBe(true);

      const members = await m1.get(`/api/teams/${w.t1.id}/members`);
      expect(members.body.find((m: any) => m.userId === w.a1.id).isAdmin).toBe(true);

      const a1 = await w.as(w.a1);
      const perms = await a1.get(`/api/teams/${w.t1.id}/permissions`);
      expect(perms.body).toMatchObject({ canManageTeam: true, isTeamAdmin: true });
      const listed = await a1.get(`/api/teams/${w.t1.id}/admins`);
      expect(listed.status).toBe(200);
      expect(listed.body.map((a: any) => a.userId)).toEqual([w.a1.id]);

      // A plain member sees no such rights.
      const plain = await (await w.as(w.a2)).get(`/api/teams/${w.t1.id}/permissions`);
      expect(plain.body).toMatchObject({ canManageTeam: false, isTeamAdmin: false });
    });

    it("granting is 403 for a plain member, a stranger, a customer and another department's manager", async () => {
      const w = await world();
      for (const who of ["a2", "a3", "c1", "m2"] as const) {
        const res = await (await w.as((w as any)[who] as User)).post(`/api/teams/${w.t1.id}/admins`).send({ memberId: w.a2.id });
        expect([who, res.status]).toEqual([who, 403]);
      }
      expect(await isAdminRow(w.t1.id, w.a2.id)).toBe(false);
    });

    it("granting needs a memberId, an existing member, and is refused twice", async () => {
      const w = await world();
      const m1 = await w.as(w.m1);
      expect((await m1.post(`/api/teams/${w.t1.id}/admins`).send({})).status).toBe(400);
      expect((await m1.post(`/api/teams/${w.t1.id}/admins`).send({ memberId: w.a3.id })).status).toBe(400); // not on the team
      expect((await m1.post(`/api/teams/${w.t1.id}/admins`).send({ memberId: w.a1.id })).status).toBe(201);
      expect((await m1.post(`/api/teams/${w.t1.id}/admins`).send({ memberId: w.a1.id })).status).toBe(400);
      expect(await isAdminRow(w.t1.id, w.a3.id)).toBe(false);
    });

    it("revoking removes the rights; it is 403 for outsiders and a manager cannot revoke themselves", async () => {
      const w = await world();
      const m1 = await w.as(w.m1);
      await m1.post(`/api/teams/${w.t1.id}/admins`).send({ memberId: w.a1.id }).expect(201);

      expect((await (await w.as(w.a2)).delete(`/api/teams/${w.t1.id}/admins/${w.a1.id}`)).status).toBe(403);
      expect((await (await w.as(w.m2)).delete(`/api/teams/${w.t1.id}/admins/${w.a1.id}`)).status).toBe(403);
      expect(await isAdminRow(w.t1.id, w.a1.id)).toBe(true);

      const revoked = await m1.delete(`/api/teams/${w.t1.id}/admins/${w.a1.id}`);
      expect(revoked.status).toBe(200);
      expect(await isAdminRow(w.t1.id, w.a1.id)).toBe(false);
      const perms = await (await w.as(w.a1)).get(`/api/teams/${w.t1.id}/permissions`);
      expect(perms.body).toMatchObject({ canManageTeam: false, isTeamAdmin: false });

      // An admin team member cannot strip their own admin status.
      await m1.post(`/api/teams/${w.t1.id}/admins`).send({ memberId: w.a1.id }).expect(201);
      const self = await (await w.as(w.a1)).delete(`/api/teams/${w.t1.id}/admins/${w.a1.id}`);
      expect(self.status).toBe(400);
      expect(await isAdminRow(w.t1.id, w.a1.id)).toBe(true);
    });
  });
});
