import { jest } from "@jest/globals";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";

function loggedText(): string {
  const parts: string[] = [];
  for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
    const mock = console[fn] as unknown as jest.Mock;
    for (const call of mock.mock?.calls ?? []) parts.push(call.map(String).join(" "));
  }
  return parts.join("\n");
}

describe("forced password change, session revocation, admin reset rules", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const savedMax = process.env.AUTH_RATE_LIMIT_MAX;
  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = "1000";
    ctx = await createTestApp();
  });
  afterAll(async () => {
    if (savedMax === undefined) delete process.env.AUTH_RATE_LIMIT_MAX;
    else process.env.AUTH_RATE_LIMIT_MAX = savedMax;
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
      (console[fn] as unknown as jest.Mock).mockClear?.();
    }
  });

  const adminReset = async (targetId: string) => {
    const admin = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, admin);
    return a.post(`/api/admin/users/${targetId}/reset-password`);
  };
  const sessionCount = async (userId: string) =>
    (await db.execute(sql`SELECT 1 FROM sessions WHERE sess->'passport'->>'user' = ${userId}`)).rows.length;

  it("a flagged user gets 403 password_change_required except for user, logout and change-password; after changing, the app works", async () => {
    const target = await createUser({ role: "agent" });
    const temp = (await adminReset(target.id)).body.tempPassword;
    const agent = request.agent(ctx.app);
    expect((await agent.post("/api/auth/login").send({ email: target.email, password: temp })).status).toBe(200);

    const blocked = await agent.get("/api/tasks");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("password_change_required");
    expect((await agent.post("/api/tasks").send({ title: "x" })).status).toBe(403);
    expect((await agent.get("/api/auth/user")).status).toBe(200);

    const wrong = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "nope-nope-1", password: "Chosen-by-user-77!" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_current_password");
    expect((await agent.get("/api/tasks")).status).toBe(403);

    const same = await agent.post("/api/auth/change-password").send({ currentPassword: temp, password: temp });
    expect(same.status).toBe(400);

    const ok = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: temp, password: "Chosen-by-user-77!" });
    expect(ok.status).toBe(200);
    expect((await agent.get("/api/tasks")).status).toBe(200);
    expect((await agent.get("/api/auth/user")).body.mustChangePassword).toBe(false);
    expect(loggedText()).not.toContain(temp);
    expect(loggedText()).not.toContain("Chosen-by-user-77!");
    expect(
      (await request(ctx.app).post("/api/auth/login").send({ email: target.email, password: temp })).status
    ).toBe(401);
    expect(
      (await request(ctx.app).post("/api/auth/login").send({ email: target.email, password: "Chosen-by-user-77!" })).status
    ).toBe(200);
  });

  it("change-password needs a session", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "a", password: "Whatever-pw-1!" });
    expect(res.status).toBe(401);
  });

  it("a normal self change keeps the current session and ends the others", async () => {
    const u = await createUser({ role: "agent" });
    const a1 = await loginAs(ctx.app, u);
    const a2 = await loginAs(ctx.app, u);
    expect(await sessionCount(u.id)).toBe(2);
    const res = await a1
      .post("/api/auth/change-password")
      .send({ currentPassword: DEFAULT_PASSWORD, password: "Another-pw-12345!" });
    expect(res.status).toBe(200);
    expect(await sessionCount(u.id)).toBe(1);
    expect((await a1.get("/api/auth/user")).status).toBe(200);
    expect((await a2.get("/api/auth/user")).status).toBe(401);
  });

  it("admin reset ends the target's live session", async () => {
    const target = await createUser({ role: "agent" });
    const live = await loginAs(ctx.app, target);
    expect((await live.get("/api/auth/user")).status).toBe(200);
    expect((await adminReset(target.id)).status).toBe(200);
    expect((await live.get("/api/auth/user")).status).toBe(401);
    expect(await sessionCount(target.id)).toBe(0);
  });

  it("a token reset ends existing sessions", async () => {
    const target = await createUser({ role: "agent" });
    const live = await loginAs(ctx.app, target);
    await storage.setPasswordResetToken(target.id, "tok-for-session-test", new Date(Date.now() + 3600000));
    const r = await request(ctx.app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-for-session-test", password: "Fresh-pw-123456!" });
    expect(r.status).toBe(200);
    expect((await live.get("/api/auth/user")).status).toBe(401);
  });

  it("admin reset refuses password-less accounts: SSO with 409 no_local_password, the system user as not found", async () => {
    const id = randomUUID();
    await db.insert(users).values({ id, email: "sso2@example.test", role: "agent", isActive: true, isApproved: true });
    await db
      .insert(users)
      .values({ id: "system", email: "system@ticketflow.local", role: "admin", isActive: true, isApproved: true });
    const sso = await adminReset(id);
    expect(sso.status).toBe(409);
    expect(sso.body.error).toBe("no_local_password");
    // The legacy system user is hidden like the AI user (Task 17): no admin route sees it.
    const system = await adminReset("system");
    expect(system.status).toBe(404);
    expect(system.body.error).toBe("user_not_found");
    const [r] = await db.select().from(users).where(eq(users.id, id));
    expect(r.password).toBeNull();
    expect(r.mustChangePassword).toBe(false);
  });

  it("the temporary password response is no-store and the reset is audited without the password", async () => {
    const target = await createUser({ role: "agent" });
    const res = await adminReset(target.id);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    const text = loggedText();
    expect(text).toContain("admin_reset_password");
    expect(text).toContain(target.id);
    expect(text).not.toContain(res.body.tempPassword);
  });

  it("login fails closed for an unknown role: no session, error code", async () => {
    const u = await createUser({ role: "agent" });
    await db.update(users).set({ role: "superuser" }).where(eq(users.id, u.id));
    const agent = request.agent(ctx.app);
    const res = await agent.post("/api/auth/login").send({ email: u.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("invalid_role");
    expect((await agent.get("/api/auth/user")).status).toBe(401);
    expect(await sessionCount(u.id)).toBe(0);
  });

  it("the must-change check is not bypassed by changing the case of the path", async () => {
    const target = await createUser({ role: "agent" });
    const temp = (await adminReset(target.id)).body.tempPassword;
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: target.email, password: temp });
    for (const path of ["/API/tasks", "/Api/tasks", "/api/TASKS"]) {
      const res = await agent.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("password_change_required");
    }
  });

  describe("revocation does not depend on the session row staying deleted", () => {
    const snapshot = async (userId: string) =>
      (await db.execute(sql`SELECT sid, sess, expire FROM sessions WHERE sess->'passport'->>'user' = ${userId}`)).rows as any[];
    const restore = async (rows: any[]) => {
      for (const r of rows) {
        await db.execute(
          sql`INSERT INTO sessions (sid, sess, expire) VALUES (${r.sid}, ${JSON.stringify(r.sess)}::jsonb, ${r.expire}) ON CONFLICT (sid) DO NOTHING`
        );
      }
    };

    it("an in-flight request that re-saves the session after an admin reset does not revive it", async () => {
      const target = await createUser({ role: "agent" });
      const live = await loginAs(ctx.app, target);
      const saved = await snapshot(target.id);
      expect(saved).toHaveLength(1);
      expect((await adminReset(target.id)).status).toBe(200);
      expect(await sessionCount(target.id)).toBe(0);
      await restore(saved); // what a request that loaded the session earlier does when it saves
      expect(await sessionCount(target.id)).toBe(1);
      const res = await live.get("/api/auth/user");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("session_revoked");
      expect(await sessionCount(target.id)).toBe(0);
    });

    it("a revived session of another device is rejected after a self change, the changer stays signed in", async () => {
      const u = await createUser({ role: "agent" });
      const mine = await loginAs(ctx.app, u);
      const other = await loginAs(ctx.app, u);
      const all = await snapshot(u.id);
      expect(
        (await mine.post("/api/auth/change-password").send({ currentPassword: DEFAULT_PASSWORD, password: "Another-pw-12345!" })).status
      ).toBe(200);
      await restore(all);
      expect((await other.get("/api/auth/user")).status).toBe(401);
      expect((await mine.get("/api/auth/user")).status).toBe(200);
      expect((await mine.get("/api/tasks")).status).toBe(200);
    });

    it("a session created after the change is valid", async () => {
      const target = await createUser({ role: "agent" });
      await adminReset(target.id);
      const row = (await db.select().from(users).where(eq(users.id, target.id)))[0];
      expect(row.passwordChangedAt).toBeInstanceOf(Date);
      // signing in afterwards with the temporary password gives a working session
      const temp = (await adminReset(target.id)).body.tempPassword;
      const fresh = request.agent(ctx.app);
      expect((await fresh.post("/api/auth/login").send({ email: target.email, password: temp })).status).toBe(200);
      expect((await fresh.get("/api/auth/user")).status).toBe(200);
    });

    it("a browser holding a revoked cookie can sign in again; other API routes still refuse it", async () => {
      const target = await createUser({ role: "agent" });
      const stale = await loginAs(ctx.app, target);
      const saved = await snapshot(target.id);
      const reset = await adminReset(target.id);
      await restore(saved);
      expect((await stale.get("/some-page")).status).not.toBe(401);
      const login = await stale
        .post("/api/auth/login")
        .send({ email: target.email, password: reset.body.tempPassword });
      expect(login.status).toBe(200);
      expect((await stale.get("/api/auth/user")).status).toBe(200);
      await adminReset(target.id);
      await restore(saved);
      expect((await stale.get("/api/tasks")).status).toBe(401);
    });

    it("passwordChangedAt is never sent to clients", async () => {
      const u = await createUser({ role: "agent" });
      const a = await loginAs(ctx.app, u);
      await a.post("/api/auth/change-password").send({ currentPassword: DEFAULT_PASSWORD, password: "Another-pw-12345!" });
      const me = await a.get("/api/auth/user");
      expect(JSON.stringify(me.body)).not.toMatch(/passwordChangedAt/i);
    });
  });

  it("anonymous requests create no session rows", async () => {
    const before = (await db.execute(sql`SELECT 1 FROM sessions`)).rows.length;
    await request(ctx.app).get("/api/tasks");
    await request(ctx.app).get("/api/auth/user");
    await request(ctx.app).post("/api/auth/login").send({ email: "nobody@example.test", password: "wrong-wrong-1" });
    expect((await db.execute(sql`SELECT 1 FROM sessions`)).rows.length).toBe(before);
  });
});
