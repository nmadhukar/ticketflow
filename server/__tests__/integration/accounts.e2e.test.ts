import request from "supertest";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { comparePasswords } from "../../services/auth";

/**
 * A1 end to end: one test registers, is refused before approval, is approved by an admin and
 * logs in. Y5: the stored password is the scrypt `hash.salt` the code writes.
 */
describe("registration, approval and login in one flow (A1) and the stored hash (Y5)", () => {
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

  const PASSWORD = "Sup3rSecret!pw";
  const register = (email: string) =>
    request(ctx.app).post("/api/auth/register").send({ email, password: PASSWORD, firstName: "New", lastName: "Person" });
  const login = (email: string, password = PASSWORD) =>
    request(ctx.app).post("/api/auth/login").send({ email, password });

  it("A1: register -> refused before approval -> admin approves -> login succeeds with a session", async () => {
    const email = "newcomer@example.test";
    const reg = await register(email);
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email, role: "customer", isApproved: false });

    // Before approval: the right password is refused, and nothing is signed in.
    const refused = await login(email);
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe("invalid_credentials");
    expect(refused.body.message).toMatch(/pending admin approval/i);
    expect(refused.headers["set-cookie"]).toBeUndefined();

    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const approved = await admin.post(`/api/admin/users/${reg.body.user.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.isApproved).toBe(true);

    const agent = request.agent(ctx.app);
    const ok = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ email, role: "customer" });
    const me = await agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    // A wrong password is still refused after approval.
    expect((await login(email, "not-the-password-1")).status).toBe(401);
  });

  it("Y5: a registered and a seeded password are scrypt 'hash.salt' (128 + 32 hex), never bcrypt or plaintext", async () => {
    const reg = await register("hash@example.test");
    expect(reg.status).toBe(201);
    const seeded = await createUser({ role: "agent" });
    const rows = [
      ...(await db.select().from(users).where(eq(users.id, reg.body.user.id))),
      ...(await db.select().from(users).where(eq(users.id, seeded.id))),
    ];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const stored = row.password as string;
      expect(stored).toMatch(/^[0-9a-f]{128}\.[0-9a-f]{32}$/); // scrypt, 64-byte key, 16-byte salt
      expect(stored).not.toMatch(/^\$2[abxy]?\$/); // not bcrypt
      expect(stored).not.toBe(PASSWORD);
      expect(stored).not.toContain(PASSWORD);
    }
    expect(await comparePasswords(PASSWORD, rows[0].password as string)).toBe(true);
    expect(await comparePasswords("wrong-password-1", rows[0].password as string)).toBe(false);
    // Same password, different salt: two accounts never share a hash.
    const again = await register("hash2@example.test");
    const [second] = await db.select().from(users).where(eq(users.id, again.body.user.id));
    expect(second.password).not.toBe(rows[0].password);
  });
});
