import { jest } from "@jest/globals";
import request from "supertest";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";

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

  it("10 parallel wrong logins (different IPs) allow at most 5 password comparisons and leave the account locked", async () => {
    const u = await createUser({ role: "agent" });
    const claim = jest.spyOn(storage, "claimLoginAttempt");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(ctx.app)
          .post("/api/auth/login")
          .set("X-Forwarded-For", `192.0.2.${i + 1}`)
          .send({ email: u.email, password: "wrong-password" })
      )
    );
    const claimed = await Promise.all(claim.mock.results.map((r) => r.value));
    claim.mockRestore();
    // A comparison happens only after a successful claim.
    expect(claimed.filter((a) => a !== null).length).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(results.filter((r) => r.status === 423)).toHaveLength(5);
    const r = await row(u.id);
    expect(r.failedLoginAttempts).toBe(5);
    expect(r.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // and the right password is refused while locked
    expect((await login(u.email!, DEFAULT_PASSWORD)).status).toBe(423);
  });

  it("a token password reset clears the lock so the user can sign in with the new password", async () => {
    const u = await createUser({ role: "agent" });
    for (let i = 0; i < 5; i++) await login(u.email!, "wrong-password");
    expect((await login(u.email!, DEFAULT_PASSWORD)).status).toBe(423);

    await storage.setPasswordResetToken(u.id, "reset-token-for-test", new Date(Date.now() + 3600000));
    const reset = await request(ctx.app)
      .post("/api/auth/reset-password")
      .send({ token: "reset-token-for-test", password: "Brand-new-pw-77!" });
    expect(reset.status).toBe(200);

    const r = await row(u.id);
    expect(r.failedLoginAttempts).toBe(0);
    expect(r.lockedUntil).toBeNull();
    expect((await login(u.email!, "Brand-new-pw-77!")).status).toBe(200);
  });
});
