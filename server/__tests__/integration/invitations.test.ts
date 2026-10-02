import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

describe("invitations, registration and SSO accounts", () => {
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

  const invite = async (
    email: string,
    opts: { role?: string; expiresAt?: Date } = {}
  ) => {
    const admin = await createUser({ role: "admin" });
    return storage.createUserInvitation({
      email,
      role: opts.role ?? "manager",
      invitedBy: admin.id,
      status: "pending",
      expiresAt: (opts.expiresAt ?? new Date(Date.now() + 86400000)) as any,
    } as any);
  };

  const register = (body: Record<string, unknown>) =>
    request(ctx.app)
      .post("/api/auth/register")
      .send({
        password: "Sup3rSecret!pw",
        firstName: "New",
        lastName: "Person",
        ...body,
      });

  it("(a) registering with an invited email but no token gives an unapproved customer", async () => {
    await invite("a@example.test");
    const res = await register({ email: "a@example.test" });
    expect(res.status).toBe(201);
    const u = await storage.getUserByEmail("a@example.test");
    expect(u?.role).toBe("customer");
    expect(u?.isApproved).toBe(false);
  });

  it("(b) the right token and email gives the invited role, approved, invitation accepted", async () => {
    const inv = await invite("b@example.test", { role: "manager" });
    const res = await register({
      email: "b@example.test",
      inviteToken: inv.invitationToken,
    });
    expect(res.status).toBe(201);
    const u = await storage.getUserByEmail("b@example.test");
    expect(u?.role).toBe("manager");
    expect(u?.isApproved).toBe(true);
    expect((await storage.getUserInvitationById(inv.id))?.status).toBe(
      "accepted"
    );
  });

  it("(c) a token issued for another email is refused", async () => {
    const inv = await invite("owner@example.test");
    const res = await register({
      email: "thief@example.test",
      inviteToken: inv.invitationToken,
    });
    expect(res.status).toBe(400);
    expect(await storage.getUserByEmail("thief@example.test")).toBeUndefined();
    expect((await storage.getUserInvitationById(inv.id))?.status).toBe(
      "pending"
    );
  });

  it("(d) a cancelled token: GET 404, accept 400, register 400", async () => {
    const inv = await invite("d@example.test");
    await storage.cancelUserInvitation(inv.id);
    expect(
      (await request(ctx.app).get(`/api/invitations/${inv.invitationToken}`))
        .status
    ).toBe(404);
    expect(
      (
        await request(ctx.app).post(
          `/api/invitations/${inv.invitationToken}/accept`
        )
      ).status
    ).toBe(400);
    expect(
      (
        await register({
          email: "d@example.test",
          inviteToken: inv.invitationToken,
        })
      ).status
    ).toBe(400);
  });

  it("(e) an expired token is refused everywhere", async () => {
    const inv = await invite("e@example.test", {
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      (await request(ctx.app).get(`/api/invitations/${inv.invitationToken}`))
        .status
    ).toBe(400);
    expect(
      (
        await request(ctx.app).post(
          `/api/invitations/${inv.invitationToken}/accept`
        )
      ).status
    ).toBe(400);
    expect(
      (
        await register({
          email: "e@example.test",
          inviteToken: inv.invitationToken,
        })
      ).status
    ).toBe(400);
  });

  it("(e2) a logged-in user whose email matches accepts: role applied, invitation accepted", async () => {
    const existing = await createUser({
      role: "customer",
      email: "e2@example.test",
      isApproved: true,
    });
    const inv = await invite("e2@example.test", { role: "manager" });
    const agent = await loginAs(ctx.app, existing);
    const res = await agent.post(
      `/api/invitations/${inv.invitationToken}/accept`
    );
    expect(res.status).toBe(200);
    expect((await storage.getUser(existing.id))?.role).toBe("manager");
    expect((await storage.getUserInvitationById(inv.id))?.status).toBe(
      "accepted"
    );
  });

  it("(e2) accept never leaves an accepted invitation without a user", async () => {
    const inv = await invite("nobody@example.test");
    const res = await request(ctx.app).post(
      `/api/invitations/${inv.invitationToken}/accept`
    );
    expect(res.status).toBe(200);
    expect(res.body.registrationRequired).toBe(true);
    expect((await storage.getUserInvitationById(inv.id))?.status).toBe(
      "pending"
    );
    // a logged-in user with a different email is refused
    const other = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, other);
    const r2 = await agent.post(
      `/api/invitations/${inv.invitationToken}/accept`
    );
    expect(r2.status).toBe(403);
    expect((await storage.getUser(other.id))?.role).toBe("customer");
  });

  it("(f) admin create defaults expiry to 7 days and rejects a garbage expiresAt", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const before = Date.now();
    const ok = await agent
      .post("/api/admin/invitations")
      .send({ email: "f@example.test", role: "agent" });
    expect(ok.status).toBe(201);
    const exp = new Date(ok.body.expiresAt).getTime();
    const week = 7 * 24 * 3600 * 1000;
    expect(exp).toBeGreaterThanOrEqual(before + week - 5000);
    expect(exp).toBeLessThanOrEqual(Date.now() + week + 5000);

    const bad = await agent
      .post("/api/admin/invitations")
      .send({ email: "f2@example.test", role: "agent", expiresAt: "garbage" });
    expect(bad.status).toBe(400);
  });

  it("(g) tokens are 32 random bytes in base64url", async () => {
    const a = await invite("g1@example.test");
    expect(a.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const res = await agent
      .post("/api/admin/invitations")
      .send({ email: "g2@example.test", role: "agent" });
    expect(res.body.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.invitationToken).not.toBe(a.invitationToken);
  });

  it("(h) registering over an SSO account (no password) is refused like any taken email (400) and changes nothing", async () => {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      email: "sso@example.test",
      firstName: "Sso",
      lastName: "User",
      role: "customer",
      isApproved: false,
      isActive: true,
    } as any);
    const inv = await invite("sso@example.test", { role: "admin" });
    for (const body of [
      { email: "sso@example.test" },
      { email: "sso@example.test", inviteToken: inv.invitationToken },
    ]) {
      const res = await register(body);
      // Same status and message as a password account: it must not reveal
      // that this one signs in with single sign-on (Task 13).
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email already registered");
    }
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row.password).toBeNull();
    expect(row.role).toBe("customer");
    expect(row.isApproved).toBe(false);
    expect(row.firstName).toBe("Sso");
    expect((await storage.getUserInvitationById(inv.id))?.status).toBe(
      "pending"
    );
  });
});
