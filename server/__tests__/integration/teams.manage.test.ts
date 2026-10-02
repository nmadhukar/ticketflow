import { and, eq } from "drizzle-orm";
import { departments, teamAdmins, teamMembers, teams, type User } from "@shared/schema";
import { AI_SYSTEM_USER_ID } from "../../utils/aiSystemUserId";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";

/**
 * Ruling R12: only an admin, or the manager of the team's department, may create
 * a team in that department or change its membership. Membership widens ticket
 * visibility, so a self-grant is a data-isolation hole.
 *
 *   D1 managed by M1 -> team T1 ; D2 managed by M2 -> team T2
 *   A1 is the creator and a team admin of T1 without being a member (old rights)
 */
describe("team creation and membership (R12)", () => {
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
    const c1 = await createUser({ role: "customer" });
    const t1 = await createTeam(m1);
    const t2 = await createTeam(m2);
    await db.insert(teamAdmins).values({ teamId: t1.id, userId: a1.id, grantedBy: m1.id });
    const [d1] = await db.select().from(departments).where(eq(departments.id, t1.departmentId));
    const [d2] = await db.select().from(departments).where(eq(departments.id, t2.departmentId));
    return { admin, m1, m2, a1, a2, c1, t1, t2, d1, d2 };
  }
  const isMember = async (teamId: number, userId: string) =>
    (await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))).length > 0;

  describe("POST /api/teams", () => {
    it.each([
      ["agent", "a1", 403],
      ["customer", "c1", 403],
      ["manager of another department", "m2", 403],
      ["manager of the department", "m1", 201],
      ["admin", "admin", 201],
    ] as const)("%s -> %i", async (_label, who, status) => {
      const w = await world();
      const agent = await loginAs(ctx.app, (w as any)[who] as User);
      const before = (await db.select().from(teams)).length;
      const res = await agent.post("/api/teams").send({ name: "New team", departmentId: w.d1.id });
      expect(res.status).toBe(status);
      const after = (await db.select().from(teams)).length;
      expect(after).toBe(status === 201 ? before + 1 : before);
      if (status === 403) expect(res.body.error).toBe("forbidden");
    });

    it("an admin may create in any department", async () => {
      const w = await world();
      const agent = await loginAs(ctx.app, w.admin);
      expect((await agent.post("/api/teams").send({ name: "x", departmentId: w.d2.id })).status).toBe(201);
    });

    it("an agent does not become a team admin or member by calling it", async () => {
      const w = await world();
      const agent = await loginAs(ctx.app, w.a2);
      await agent.post("/api/teams").send({ name: "grab", departmentId: w.d1.id }).expect(403);
      expect((await db.select().from(teamMembers).where(eq(teamMembers.userId, w.a2.id)))).toHaveLength(0);
      expect((await db.select().from(teamAdmins).where(eq(teamAdmins.userId, w.a2.id)))).toHaveLength(0);
    });

    it("a missing department is 400 for an admin", async () => {
      const w = await world();
      const agent = await loginAs(ctx.app, w.admin);
      const res = await agent.post("/api/teams").send({ name: "x", departmentId: 999999 });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/admin/users/:userId/assign-team", () => {
    it.each([
      ["agent", "a2", 403],
      ["customer", "c1", 403],
      ["manager of another department", "m2", 403],
      ["team admin and creator-style agent (A1)", "a1", 403],
      ["manager of the department", "m1", 200],
      ["admin", "admin", 200],
    ] as const)("%s adds a member -> %i", async (_label, who, status) => {
      const w = await world();
      const agent = await loginAs(ctx.app, (w as any)[who] as User);
      const res = await agent.post(`/api/admin/users/${w.a2.id}/assign-team`).send({ teamId: w.t1.id });
      expect(res.status).toBe(status);
      expect(await isMember(w.t1.id, w.a2.id)).toBe(status === 200);
    });

    it("an agent cannot add themselves to a team", async () => {
      const w = await world();
      const agent = await loginAs(ctx.app, w.a1);
      const res = await agent.post(`/api/admin/users/${w.a1.id}/assign-team`).send({ teamId: w.t1.id });
      expect(res.status).toBe(403);
      expect(await isMember(w.t1.id, w.a1.id)).toBe(false);
    });

    it("the AI system user is refused, an unknown user and team are 404 / 400", async () => {
      const w = await world();
      const agent = await loginAs(ctx.app, w.admin);
      const res = await agent.post(`/api/admin/users/${AI_SYSTEM_USER_ID}/assign-team`).send({ teamId: w.t1.id });
      expect(res.status).toBe(404);
      expect(await isMember(w.t1.id, AI_SYSTEM_USER_ID)).toBe(false);
      await expect(storage.assignUserToTeam(AI_SYSTEM_USER_ID, w.t1.id)).rejects.toMatchObject({ status: 404 });
      const ghost = await agent.post(`/api/admin/users/not-a-user/assign-team`).send({ teamId: w.t1.id });
      expect(ghost.status).toBe(404);
      const noTeam = await agent.post(`/api/admin/users/${w.a2.id}/assign-team`).send({ teamId: "abc" });
      expect(noTeam.status).toBe(400);
    });
  });

  describe("DELETE /api/admin/users/:userId/remove-team/:teamId", () => {
    it.each([
      ["agent", "a1", 403],
      ["customer", "c1", 403],
      ["manager of another department", "m2", 403],
      ["manager of the department", "m1", 204],
      ["admin", "admin", 204],
    ] as const)("%s removes a member -> %i", async (_label, who, status) => {
      const w = await world();
      await storage.addTeamMember({ teamId: w.t1.id, userId: w.a2.id });
      const agent = await loginAs(ctx.app, (w as any)[who] as User);
      const res = await agent.delete(`/api/admin/users/${w.a2.id}/remove-team/${w.t1.id}`);
      expect(res.status).toBe(status);
      expect(await isMember(w.t1.id, w.a2.id)).toBe(status !== 204);
    });
  });
});
