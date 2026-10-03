import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { findSecrets } from "./helpers/noSecrets";
import { db, pool } from "../../storage/db";
import { storage } from "../../storage";
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from "../../services/auth/lockout";

/** R53: the failure counter restarts at 1 once the lockout window has passed since the last failure. */
describe("login lockout decay (R53)", () => {
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
  const minutes = (base: Date, m: number) => new Date(base.getTime() + m * 60 * 1000);

  it("4 misses, then a miss 16 minutes later, is attempt 1 and does not lock", async () => {
    const u = await createUser({ role: "agent" });
    const base = new Date();
    for (let i = 1; i <= 4; i++) expect(await storage.claimLoginAttempt(u.id, base)).toBe(i);
    expect(await storage.claimLoginAttempt(u.id, minutes(base, LOCKOUT_MINUTES + 1))).toBe(1);
    const r = await row(u.id);
    expect(r.failedLoginAttempts).toBe(1);
    expect(r.lockedUntil).toBeNull();
    // and the account still works: the next claims count up from 1
    expect(await storage.claimLoginAttempt(u.id, minutes(base, LOCKOUT_MINUTES + 2))).toBe(2);
  });

  it("5 misses within the window still lock, and the lock refuses the next claim", async () => {
    const u = await createUser({ role: "agent" });
    const base = new Date();
    // spread over 14 minutes: each miss is within 15 minutes of the one before
    for (let i = 1; i <= MAX_FAILED_LOGINS; i++) {
      expect(await storage.claimLoginAttempt(u.id, minutes(base, i * 2.8))).toBe(i);
    }
    expect((await row(u.id)).lockedUntil).not.toBeNull();
    expect(await storage.claimLoginAttempt(u.id, minutes(base, 15))).toBeNull();
  });

  it("a miss exactly one window after the last one restarts the count (boundary)", async () => {
    const u = await createUser({ role: "agent" });
    const base = new Date();
    expect(await storage.claimLoginAttempt(u.id, base)).toBe(1);
    expect(await storage.claimLoginAttempt(u.id, minutes(base, LOCKOUT_MINUTES - 1))).toBe(2);
    expect(await storage.claimLoginAttempt(u.id, minutes(base, LOCKOUT_MINUTES - 1 + LOCKOUT_MINUTES))).toBe(1);
  });

  it("a legacy row (count 4, NULL stamp) counts as before and locks on the next miss", async () => {
    const u = await createUser({ role: "agent" });
    await db.update(users).set({ failedLoginAttempts: 4, lastFailedLoginAt: null }).where(eq(users.id, u.id));
    expect(await storage.claimLoginAttempt(u.id, new Date())).toBe(MAX_FAILED_LOGINS);
    const r = await row(u.id);
    expect(r.lockedUntil).not.toBeNull();
    expect(r.lastFailedLoginAt).not.toBeNull();
  });

  it("every claim stamps last_failed_login_at, and resetFailedLogins clears it", async () => {
    const u = await createUser({ role: "agent" });
    expect((await row(u.id)).lastFailedLoginAt).toBeNull();
    const now = new Date();
    await storage.claimLoginAttempt(u.id, now);
    const stamped = (await row(u.id)).lastFailedLoginAt!;
    expect(Math.abs(stamped.getTime() - now.getTime())).toBeLessThan(2000);
    await storage.resetFailedLogins(u.id);
    const r = await row(u.id);
    expect(r.lastFailedLoginAt).toBeNull();
    expect(r.failedLoginAttempts).toBe(0);
  });

  it("a real wrong-password login stamps it, a right one clears it", async () => {
    const u = await createUser({ role: "agent" });
    const bad = await request(ctx.app).post("/api/auth/login").send({ email: u.email, password: "wrong-password" });
    expect(bad.status).toBe(401);
    expect((await row(u.id)).lastFailedLoginAt).not.toBeNull();
    await loginAs(ctx.app, u, DEFAULT_PASSWORD);
    expect((await row(u.id)).lastFailedLoginAt).toBeNull();
  });

  it("an admin temporary password clears the stamp too", async () => {
    const u = await createUser({ role: "agent" });
    await storage.claimLoginAttempt(u.id, new Date());
    await storage.setTemporaryPassword(u.id, "x-hashed");
    expect((await row(u.id)).lastFailedLoginAt).toBeNull();
  });

  it("the column is never in any response", async () => {
    const admin = await createUser({ role: "admin" });
    const u = await createUser({ role: "agent" });
    await request(ctx.app).post("/api/auth/login").send({ email: u.email, password: "wrong-password" });
    const login = await request(ctx.app).post("/api/auth/login").send({ email: u.email, password: DEFAULT_PASSWORD });
    expect(login.status).toBe(200);
    const agent = await loginAs(ctx.app, admin);
    const bodies = [
      login.body,
      (await agent.get("/api/auth/user")).body,
      (await agent.get("/api/users")).body,
      (await agent.get("/api/admin/users")).body,
    ];
    for (const b of bodies) {
      expect(JSON.stringify(b)).not.toMatch(/lastFailedLoginAt|last_failed_login_at|failedLoginAttempts|lockedUntil/);
      expect(findSecrets(b)).toEqual([]);
    }
  });

  it("migration 0022 applies twice on a pushed database and leaves the column in place", async () => {
    const file = readFileSync(join(__dirname, "../../../migrations/0022_users_last_failed_login.sql"), "utf8");
    await pool.query(file);
    await pool.query(file);
    const cols = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_failed_login_at'`
    );
    expect(cols.rows).toHaveLength(1);
    expect(cols.rows[0].data_type).toBe("timestamp without time zone");
  });
});
