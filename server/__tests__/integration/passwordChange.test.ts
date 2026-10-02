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

  it("admin reset refuses password-less accounts (SSO and system) with 409 no_local_password", async () => {
    const id = randomUUID();
    await db.insert(users).values({ id, email: "sso2@example.test", role: "agent", isActive: true, isApproved: true });
    await db
      .insert(users)
      .values({ id: "system", email: "system@ticketflow.local", role: "admin", isActive: true, isApproved: true });
    for (const target of [id, "system"]) {
      const res = await adminReset(target);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("no_local_password");
    }
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
});
