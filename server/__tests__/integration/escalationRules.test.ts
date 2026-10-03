import request from "supertest";
import { escalationRules } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";

/**
 * S4: an admin creates, edits and deletes escalation rules at /api/admin/escalation-rules.
 * The stored rules are configuration only: nothing in the server acts on them yet and the
 * client hides their controls (ruling R23), so this proves the admin API, not an effect.
 */
describe("escalation rules admin API (S4)", () => {
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

  const admin = async () => loginAs(ctx.app, await createUser({ role: "admin" }));
  const rule = (extra: Record<string, unknown> = {}) => ({
    ruleName: "Urgent to managers",
    description: "Escalate urgent tickets after an hour",
    conditions: { priority: "urgent", afterMinutes: 60 },
    targetRole: "manager",
    priority: 5,
    ...extra,
  });

  it("an admin creates a rule and lists it", async () => {
    const a = await admin();
    const created = await a.post("/api/admin/escalation-rules").send(rule());
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ ruleName: "Urgent to managers", targetRole: "manager", priority: 5, isActive: true });
    expect(created.body.conditions).toEqual({ priority: "urgent", afterMinutes: 60 });

    const listed = await a.get("/api/admin/escalation-rules");
    expect(listed.status).toBe(200);
    expect(listed.body.map((r: any) => r.id)).toEqual([created.body.id]);
  });

  it("rules are listed highest priority first", async () => {
    const a = await admin();
    await a.post("/api/admin/escalation-rules").send(rule({ ruleName: "low", priority: 1 })).expect(200);
    await a.post("/api/admin/escalation-rules").send(rule({ ruleName: "high", priority: 9 })).expect(200);
    await a.post("/api/admin/escalation-rules").send(rule({ ruleName: "mid", priority: 4 })).expect(200);
    expect((await a.get("/api/admin/escalation-rules")).body.map((r: any) => r.ruleName)).toEqual(["high", "mid", "low"]);
  });

  it("a rule can target a team", async () => {
    const adminUser = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, adminUser);
    const team = await createTeam(adminUser);
    const created = await a.post("/api/admin/escalation-rules").send(rule({ targetTeamId: team.id, targetRole: "agent" }));
    expect(created.status).toBe(200);
    expect(created.body.targetTeamId).toBe(team.id);
  });

  it("an admin edits a rule: only the named fields change, and it can be switched off", async () => {
    const a = await admin();
    const { body } = await a.post("/api/admin/escalation-rules").send(rule());
    const edited = await a.put(`/api/admin/escalation-rules/${body.id}`).send({ ruleName: "Renamed", isActive: false });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id: body.id, ruleName: "Renamed", isActive: false, targetRole: "manager", priority: 5 });
    expect(edited.body.conditions).toEqual(body.conditions);
    expect(new Date(edited.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(body.updatedAt).getTime());
    expect((await a.get("/api/admin/escalation-rules")).body[0].ruleName).toBe("Renamed");
  });

  it("an admin deletes a rule", async () => {
    const a = await admin();
    const { body } = await a.post("/api/admin/escalation-rules").send(rule());
    const del = await a.delete(`/api/admin/escalation-rules/${body.id}`);
    expect(del.status).toBe(200);
    expect(await db.select().from(escalationRules)).toHaveLength(0);
    expect((await a.get("/api/admin/escalation-rules")).body).toEqual([]);
  });

  it("an incomplete or mistyped rule is 400 (it used to be a database 500) and stores nothing", async () => {
    const a = await admin();
    for (const body of [{}, { ruleName: "x" }, rule({ conditions: undefined }), rule({ targetRole: undefined }), rule({ priority: "high" }), rule({ ruleName: 7 })]) {
      const res = await a.post("/api/admin/escalation-rules").send(body);
      expect([JSON.stringify(body).slice(0, 50), res.status]).toEqual([JSON.stringify(body).slice(0, 50), 400]);
    }
    expect(await db.select().from(escalationRules)).toHaveLength(0);
  });

  it("a client cannot choose the id or timestamps on create (unknown columns are dropped)", async () => {
    const a = await admin();
    const created = await a.post("/api/admin/escalation-rules").send(rule({ id: 4242, createdAt: "2001-01-01T00:00:00Z" }));
    expect(created.status).toBe(200);
    expect(created.body.id).not.toBe(4242);
    expect(new Date(created.body.createdAt).getFullYear()).toBeGreaterThan(2020);
  });

  it("editing or deleting an unknown rule is 404, and a bad edit is 400 and changes nothing", async () => {
    const a = await admin();
    expect((await a.put("/api/admin/escalation-rules/999999").send({ ruleName: "x" })).status).toBe(404);
    expect((await a.delete("/api/admin/escalation-rules/999999")).status).toBe(404);
    const { body } = await a.post("/api/admin/escalation-rules").send(rule());
    expect((await a.put(`/api/admin/escalation-rules/${body.id}`).send({ priority: "high" })).status).toBe(400);
    expect((await a.get("/api/admin/escalation-rules")).body[0].priority).toBe(5);
  });

  it("only an admin may use it (403 for manager, agent, customer; 401 anonymous) and the rules stay untouched", async () => {
    const a = await admin();
    const { body } = await a.post("/api/admin/escalation-rules").send(rule());
    for (const role of ["manager", "agent", "customer"] as const) {
      const u = await loginAs(ctx.app, await createUser({ role }));
      expect([role, "list", (await u.get("/api/admin/escalation-rules")).status]).toEqual([role, "list", 403]);
      expect([role, "create", (await u.post("/api/admin/escalation-rules").send(rule())).status]).toEqual([role, "create", 403]);
      expect([role, "edit", (await u.put(`/api/admin/escalation-rules/${body.id}`).send({ ruleName: "Hijacked" })).status]).toEqual([role, "edit", 403]);
      expect([role, "delete", (await u.delete(`/api/admin/escalation-rules/${body.id}`)).status]).toEqual([role, "delete", 403]);
    }
    expect((await request(ctx.app).get("/api/admin/escalation-rules")).status).toBe(401);
    const rows = await db.select().from(escalationRules);
    expect(rows).toHaveLength(1);
    expect(rows[0].ruleName).toBe("Urgent to managers");
  });
});
