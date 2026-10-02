import request from "supertest";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";

describe("login lockout", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const savedMax = process.env.AUTH_RATE_LIMIT_MAX;
  beforeAll(async () => {
    // This file makes many failed logins from one IP; the rate limit has its
    // own test (auth.ratelimit.test.ts).
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

  const login = (email: string, password: string) =>
    request(ctx.app).post("/api/auth/login").send({ email, password });
  const row = async (id: string) =>
    (await db.select().from(users).where(eq(users.id, id)))[0];

  it("locks on the 6th attempt after 5 wrong passwords, even with the right one", async () => {
    const u = await createUser({ role: "agent" });
    for (let i = 0; i < 5; i++) {
      expect((await login(u.email!, "wrong-password")).status).toBe(401);
    }
    const res = await login(u.email!, DEFAULT_PASSWORD);
    expect(res.status).toBe(423);
    expect(res.body.error).toBe("account_locked");
    expect(typeof res.body.message).toBe("string");

    const r = await row(u.id);
    expect(r.failedLoginAttempts).toBe(5);
    const minutes = (r.lockedUntil!.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("lets the user in once lockedUntil has passed and resets the counter", async () => {
    const u = await createUser({ role: "agent" });
    for (let i = 0; i < 5; i++) await login(u.email!, "wrong-password");
    expect((await login(u.email!, DEFAULT_PASSWORD)).status).toBe(423);

    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, u.id));
    const res = await login(u.email!, DEFAULT_PASSWORD);
    expect(res.status).toBe(200);
    const r = await row(u.id);
    expect(r.failedLoginAttempts).toBe(0);
    expect(r.lockedUntil).toBeNull();
  });

  it("a wrong password after the lock expired starts a fresh count", async () => {
    const u = await createUser({ role: "agent" });
    for (let i = 0; i < 5; i++) await login(u.email!, "wrong-password");
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, u.id));
    expect((await login(u.email!, "wrong-password")).status).toBe(401);
    expect((await row(u.id)).failedLoginAttempts).toBe(1);
    expect((await login(u.email!, DEFAULT_PASSWORD)).status).toBe(200);
  });

  it("a successful login resets the failure counter", async () => {
    const u = await createUser({ role: "agent" });
    for (let i = 0; i < 4; i++) await login(u.email!, "wrong-password");
    expect((await row(u.id)).failedLoginAttempts).toBe(4);
    expect((await login(u.email!, DEFAULT_PASSWORD)).status).toBe(200);
    expect((await row(u.id)).failedLoginAttempts).toBe(0);
    // four more wrong ones do not lock: the earlier four were forgiven
    for (let i = 0; i < 4; i++) await login(u.email!, "wrong-password");
    expect((await login(u.email!, DEFAULT_PASSWORD)).status).toBe(200);
  });

  it("never returns the lockout columns", async () => {
    const u = await createUser({ role: "agent" });
    await login(u.email!, "wrong-password");
    const res = await login(u.email!, DEFAULT_PASSWORD);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/failedLoginAttempts|lockedUntil/);
  });
});
