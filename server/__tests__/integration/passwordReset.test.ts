import { jest } from "@jest/globals";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { users, emailTemplates, emailProviders } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";

const mockSent: Array<{ to: string; variables: Record<string, string> }> = [];
jest.mock("../../services/mailtrap", () => ({
  sendEmailWithTemplate: async (opts: any) => {
    mockSent.push({ to: opts.to, variables: opts.variables });
    return true;
  },
}));

function loggedText(): string {
  const parts: string[] = [];
  for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
    const mock = console[fn] as unknown as jest.Mock;
    for (const call of mock.mock?.calls ?? []) parts.push(call.map(String).join(" "));
  }
  return parts.join("\n");
}

describe("password reset tokens and admin reset", () => {
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
    mockSent.length = 0;
    for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
      (console[fn] as unknown as jest.Mock).mockClear?.();
    }
    await db.insert(emailTemplates).values({
      name: "password_reset",
      subject: "Reset",
      body: "{{resetUrl}} {{resetCode}}",
    });
    await db.insert(emailProviders).values({ provider: "mailtrap", fromEmail: "no-reply@example.test" });
  });

  const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
  const forgot = (email: string) => request(ctx.app).post("/api/auth/forgot-password").send({ email });
  const tokenFromEmail = () => {
    const url = mockSent[mockSent.length - 1].variables.resetUrl;
    return new URL(url).searchParams.get("token")!;
  };

  it("stores only a sha256 hash; the emailed token resets the password", async () => {
    const u = await createUser({ role: "agent" });
    expect((await forgot(u.email!)).status).toBe(200);
    expect(mockSent).toHaveLength(1);
    const token = tokenFromEmail();
    const stored = (await row(u.id)).passwordResetToken!;
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);

    // The stored hash is not itself a usable token.
    const bad = await request(ctx.app)
      .post("/api/auth/reset-password")
      .send({ token: stored, password: "Another-pw-12345!" });
    expect(bad.status).toBe(400);

    const ok = await request(ctx.app)
      .post("/api/auth/reset-password")
      .send({ token, password: "Another-pw-12345!" });
    expect(ok.status).toBe(200);
    expect((await row(u.id)).passwordResetToken).toBeNull();
    const login = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: u.email, password: "Another-pw-12345!" });
    expect(login.status).toBe(200);
    // single use
    const again = await request(ctx.app)
      .post("/api/auth/reset-password")
      .send({ token, password: "Third-pw-123456!" });
    expect(again.status).toBe(400);
  });

  it("never logs the token or the reset URL, with or without an email provider", async () => {
    const u = await createUser({ role: "agent" });
    await forgot(u.email!);
    const token = tokenFromEmail();
    expect(loggedText()).not.toContain(token);
    expect(loggedText()).not.toContain("mode=reset");

    // No template configured: the old code logged the token here.
    await db.delete(emailTemplates);
    await forgot(u.email!);
    const hash = (await row(u.id)).passwordResetToken!;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const text = loggedText();
    expect(text).not.toMatch(/Password reset token/i);
    expect(text).not.toContain(hash);
    // no secret-looking string (43-char base64url token, 64-hex hash) was printed at all
    expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });

  it("a password-less (SSO) account gets no token, no email, and the same answer as an unknown email", async () => {
    const id = randomUUID();
    await db
      .insert(users)
      .values({ id, email: "sso@example.test", role: "agent", isActive: true, isApproved: true });
    const sso = await forgot("sso@example.test");
    const unknown = await forgot("nobody@example.test");
    expect(sso.status).toBe(200);
    expect(sso.body).toEqual(unknown.body);
    expect(mockSent).toHaveLength(0);
    const r = await row(id);
    expect(r.passwordResetToken).toBeNull();
    expect(r.passwordResetExpires).toBeNull();
  });

  describe("admin reset-password", () => {
    it("returns a temporary password once; it logs in, the old one does not, and the user must change it", async () => {
      const admin = await createUser({ role: "admin" });
      const target = await createUser({ role: "agent" });
      const adminAgent = await loginAs(ctx.app, admin);
      const res = await adminAgent.post(`/api/admin/users/${target.id}/reset-password`);
      expect(res.status).toBe(200);
      const temp: string = res.body.tempPassword;
      expect(temp.length).toBeGreaterThanOrEqual(16);
      expect(temp).not.toBe(DEFAULT_PASSWORD);

      const stored = await row(target.id);
      expect(stored.password).not.toContain(temp);
      expect(stored.mustChangePassword).toBe(true);

      const old = await request(ctx.app)
        .post("/api/auth/login")
        .send({ email: target.email, password: DEFAULT_PASSWORD });
      expect(old.status).toBe(401);
      const agent = request.agent(ctx.app);
      const login = await agent.post("/api/auth/login").send({ email: target.email, password: temp });
      expect(login.status).toBe(200);
      expect(login.body.mustChangePassword).toBe(true);
      expect((await agent.get("/api/auth/user")).body.mustChangePassword).toBe(true);

      // A self password change (token reset) clears the flag.
      await forgot(target.email!);
      const token = tokenFromEmail();
      const change = await request(ctx.app)
        .post("/api/auth/reset-password")
        .send({ token, password: "Chosen-by-user-77!" });
      expect(change.status).toBe(200);
      expect((await row(target.id)).mustChangePassword).toBe(false);
      const l2 = await request
        .agent(ctx.app)
        .post("/api/auth/login")
        .send({ email: target.email, password: "Chosen-by-user-77!" });
      expect(l2.body.mustChangePassword).toBe(false);
    });

    it("two resets give different passwords", async () => {
      const admin = await createUser({ role: "admin" });
      const target = await createUser({ role: "agent" });
      const a = await loginAs(ctx.app, admin);
      const r1 = await a.post(`/api/admin/users/${target.id}/reset-password`);
      const r2 = await a.post(`/api/admin/users/${target.id}/reset-password`);
      expect(r1.body.tempPassword).not.toBe(r2.body.tempPassword);
    });

    it("is admin only (403) and 404 for an unknown user", async () => {
      const target = await createUser({ role: "agent" });
      for (const role of ["agent", "manager", "customer"] as const) {
        const u = await createUser({ role });
        const a = await loginAs(ctx.app, u);
        expect((await a.post(`/api/admin/users/${target.id}/reset-password`)).status).toBe(403);
      }
      expect((await row(target.id)).mustChangePassword).toBe(false);
      const admin = await createUser({ role: "admin" });
      const a = await loginAs(ctx.app, admin);
      expect((await a.post(`/api/admin/users/${randomUUID()}/reset-password`)).status).toBe(404);
    });

    it("also clears a lockout so the user can use the temporary password", async () => {
      const admin = await createUser({ role: "admin" });
      const target = await createUser({ role: "agent" });
      for (let i = 0; i < 5; i++) {
        await request(ctx.app).post("/api/auth/login").send({ email: target.email, password: "wrong-pw" });
      }
      const a = await loginAs(ctx.app, admin);
      const res = await a.post(`/api/admin/users/${target.id}/reset-password`);
      const login = await request(ctx.app)
        .post("/api/auth/login")
        .send({ email: target.email, password: res.body.tempPassword });
      expect(login.status).toBe(200);
    });
  });
});
