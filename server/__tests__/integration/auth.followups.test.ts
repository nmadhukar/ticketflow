import { jest } from "@jest/globals";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { hashPassword, isSessionRevoked } from "../../services/auth";
import { extractBearer } from "../../services/auth/bearer";
import { seedSystemUser } from "../../seed/seedUsers";

/**
 * FU2: the security-sensitive authentication follow-ups. Each test here failed
 * before its fix (see the task report for the recorded run).
 */
describe("authentication follow-ups", () => {
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
  });

  const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
  const change = (agent: ReturnType<typeof request.agent>, currentPassword: string, password = "Another-pw-12345!") =>
    agent.post("/api/auth/change-password").send({ currentPassword, password });

  describe("change-password counts toward the lockout", () => {
    it("5 wrong current passwords lock the account; the 6th is 423 and the right password no longer signs in", async () => {
      const u = await createUser({ role: "agent" });
      const a = await loginAs(ctx.app, u);
      for (let i = 0; i < 5; i++) {
        const res = await change(a, "wrong-password-1");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_current_password");
      }
      const locked = await change(a, DEFAULT_PASSWORD);
      expect(locked.status).toBe(423);
      expect(locked.body.error).toBe("account_locked");
      const r = await row(u.id);
      expect(r.failedLoginAttempts).toBe(5);
      expect(r.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      const login = await request(ctx.app).post("/api/auth/login").send({ email: u.email, password: DEFAULT_PASSWORD });
      expect(login.status).toBe(423);
    });

    it("a correct change forgives earlier wrong guesses", async () => {
      const u = await createUser({ role: "agent" });
      const a = await loginAs(ctx.app, u);
      for (let i = 0; i < 3; i++) await change(a, "wrong-password-1");
      expect((await row(u.id)).failedLoginAttempts).toBe(3);
      expect((await change(a, DEFAULT_PASSWORD)).status).toBe(200);
      expect((await row(u.id)).failedLoginAttempts).toBe(0);
    });

    it("wrong guesses here and wrong logins share one budget", async () => {
      const u = await createUser({ role: "agent" });
      const a = await loginAs(ctx.app, u);
      for (let i = 0; i < 3; i++) await change(a, "wrong-password-1");
      for (let i = 0; i < 2; i++) {
        await request(ctx.app).post("/api/auth/login").send({ email: u.email, password: "wrong-password-2" });
      }
      expect((await change(a, DEFAULT_PASSWORD)).status).toBe(423);
    });
  });

  describe("a revoked session cookie is cleared", () => {
    it("the session_revoked answer expires connect.sid", async () => {
      const u = await createUser({ role: "agent" });
      const stale = await loginAs(ctx.app, u);
      const saved = (await db.execute(sql`SELECT sid, sess, expire FROM sessions WHERE sess->'passport'->>'user' = ${u.id}`))
        .rows as any[];
      const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
      expect((await admin.post(`/api/admin/users/${u.id}/reset-password`)).status).toBe(200);
      for (const r of saved) {
        await db.execute(
          sql`INSERT INTO sessions (sid, sess, expire) VALUES (${r.sid}, ${JSON.stringify(r.sess)}::jsonb, ${r.expire}) ON CONFLICT (sid) DO NOTHING`
        );
      }
      const res = await stale.get("/api/tasks");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("session_revoked");
      const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
      const cleared = cookies.find((c) => c.startsWith("connect.sid=;"));
      expect(cleared).toBeDefined();
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(cleared).toMatch(/HttpOnly/i);
    });
  });

  describe("authAt residual race: the session remembers the row that was verified", () => {
    it("a login that verified a row from before the password change is revoked, even though authAt is later", async () => {
      const u = await createUser({ role: "agent" });
      // The login reads the row (old password) ...
      const stale = await storage.getUserByEmail(u.email!);
      expect(stale?.passwordChangedAt).toBeNull();
      // ... a reset commits with a timestamp taken BEFORE the login started ...
      const changedAt = new Date(Date.now() - 5000);
      await db
        .update(users)
        .set({ password: await hashPassword("Replaced-by-reset-1!"), passwordChangedAt: changedAt })
        .where(eq(users.id, u.id));
      const spy = jest.spyOn(storage, "getUserByEmail").mockResolvedValueOnce(stale);
      const agent = request.agent(ctx.app);
      const login = await agent.post("/api/auth/login").send({ email: u.email, password: DEFAULT_PASSWORD });
      spy.mockRestore();
      expect(login.status).toBe(200);
      // ... so the session must not be honoured.
      const me = await agent.get("/api/auth/user");
      expect(me.status).toBe(401);
    });

    it("a normal login after a change keeps working", async () => {
      const u = await createUser({ role: "agent" });
      await db.update(users).set({ passwordChangedAt: new Date(Date.now() - 5000) }).where(eq(users.id, u.id));
      const a = await loginAs(ctx.app, u);
      expect((await a.get("/api/auth/user")).status).toBe(200);
      expect((await change(a, DEFAULT_PASSWORD)).status).toBe(200);
      expect((await a.get("/api/auth/user")).status).toBe(200);
    });

    it("isSessionRevoked: pwdAt older than the change revokes, equal does not, a session without pwdAt falls back to authAt", () => {
      const changedAt = new Date("2026-01-01T00:00:10.000Z");
      const t = changedAt.getTime();
      const user = { passwordChangedAt: changedAt };
      expect(isSessionRevoked(user, { authAt: t + 5000, pwdAt: 0 })).toBe(true);
      expect(isSessionRevoked(user, { authAt: t + 5000, pwdAt: t - 1 })).toBe(true);
      expect(isSessionRevoked(user, { authAt: t + 5000, pwdAt: t })).toBe(false);
      expect(isSessionRevoked(user, { authAt: t + 5000 })).toBe(false);
      expect(isSessionRevoked(user, { authAt: t - 1 })).toBe(true);
      expect(isSessionRevoked(user, {})).toBe(true);
      expect(isSessionRevoked({ passwordChangedAt: null }, { authAt: 1, pwdAt: 0 })).toBe(false);
    });
  });

  describe("bearer extraction only reads the /api prefix at a segment boundary", () => {
    const header = { authorization: "Bearer tfk_abc" };
    it("matches /api and /api/..., any case", () => {
      expect(extractBearer({ headers: header, path: "/api" } as any)).toBe("tfk_abc");
      expect(extractBearer({ headers: header, path: "/api/tasks" } as any)).toBe("tfk_abc");
      expect(extractBearer({ headers: header, path: "/API/Tasks" } as any)).toBe("tfk_abc");
    });
    it("does not match /apixyz or /api-docs", () => {
      expect(extractBearer({ headers: header, path: "/apixyz" } as any)).toBeNull();
      expect(extractBearer({ headers: header, path: "/api-docs" } as any)).toBeNull();
    });
  });

  describe("the security audit line names the signed-in actor", () => {
    it("an admin password reset is logged with the admin's id, not 'anonymous'", async () => {
      const admin = await createUser({ role: "admin" });
      const target = await createUser({ role: "agent" });
      const a = await loginAs(ctx.app, admin);
      (console.log as unknown as jest.Mock).mockClear();
      expect((await a.post(`/api/admin/users/${target.id}/reset-password`)).status).toBe(200);
      const lines = ((console.log as unknown as jest.Mock).mock.calls as unknown[][])
        .filter((c) => c[0] === "SECURITY_AUDIT:")
        .map((c) => JSON.parse(String(c[1])));
      const entry = lines.find((l) => l.action === "admin_reset_password");
      expect(entry).toBeDefined();
      expect(entry.userId).toBe(admin.id);
      expect(entry.userRole).toBe("admin");
    });
  });

  describe("the legacy system user email clash (M8)", () => {
    it("another account holding system@ticketflow.local does not stop the seeder or get touched", async () => {
      const other = await createUser({ role: "agent", email: "system@ticketflow.local" });
      await expect(seedSystemUser()).resolves.toBeUndefined();
      expect((await db.select().from(users).where(eq(users.id, "system"))).length).toBe(0);
      expect((await row(other.id)).role).toBe("agent");
    });
    it("creates the system user when the email is free, and is idempotent", async () => {
      await seedSystemUser();
      await seedSystemUser();
      expect((await db.select().from(users).where(eq(users.id, "system"))).length).toBe(1);
    });
  });
});
