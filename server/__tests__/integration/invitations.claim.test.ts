import { jest } from "@jest/globals";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { users, userInvitations } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";

describe("invitation claim is atomic and expiry is bounded", () => {
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

  const invite = async (email: string, role = "manager", expiresAt = new Date(Date.now() + 86400000)) => {
    const admin = await createUser({ role: "admin" });
    return storage.createUserInvitation({
      email,
      role,
      invitedBy: admin.id,
      status: "pending",
      expiresAt: expiresAt as any,
    } as any);
  };
  const register = (body: Record<string, unknown>) =>
    request(ctx.app)
      .post("/api/auth/register")
      .send({ password: "Sup3rSecret!pw", firstName: "New", lastName: "Person", ...body });

  it("two concurrent registrations with the same token (case-variant emails): exactly one succeeds", async () => {
    const inv = await invite("race@example.test", "admin");
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        register({
          email: i % 2 === 0 ? "race@example.test" : "RACE@Example.test",
          inviteToken: inv.invitationToken,
        })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 201)) {
      expect(r.status).toBe(400);
    }
    const created = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = 'race@example.test'`);
    expect(created).toHaveLength(1);
    expect(created[0].role).toBe("admin");
  });

  it("a claim that fails creates no user and leaves a decision in the response", async () => {
    const inv = await invite("late@example.test");
    // The invitation is consumed between the pre-check and the claim.
    await db
      .update(userInvitations)
      .set({ status: "cancelled" })
      .where(eq(userInvitations.id, inv.id));
    const res = await register({ email: "late@example.test", inviteToken: inv.invitationToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_invitation");
    expect(await storage.getUserByEmail("late@example.test")).toBeUndefined();
  });

  it("a claim lost AFTER the pre-check passed (the transactional claim itself) creates no user", async () => {
    const inv = await invite("lost@example.test");
    // The route's pre-check reads the invitation as still pending ...
    const pending = (await storage.getUserInvitationByToken(inv.invitationToken))!;
    expect(pending.status).toBe("pending");
    // ... but another request has already consumed it, so the conditional UPDATE matches nothing.
    await db.update(userInvitations).set({ status: "accepted" }).where(eq(userInvitations.id, inv.id));
    const stale = jest.spyOn(storage, "getUserInvitationByToken").mockResolvedValueOnce(pending);
    const claim = jest.spyOn(storage, "createUserClaimingInvitation");
    const res = await register({ email: "lost@example.test", inviteToken: inv.invitationToken });
    stale.mockRestore();
    // Proof it was the claim, not the pre-check, that refused: the claim ran and returned null.
    expect(claim).toHaveBeenCalledTimes(1);
    await expect(claim.mock.results[0].value).resolves.toBeNull();
    claim.mockRestore();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_invitation");
    expect(await storage.getUserByEmail("lost@example.test")).toBeUndefined();
  });

  it("the claim itself refuses an expired invitation (storage level, no pre-check)", async () => {
    const inv = await invite("exp@example.test", "manager", new Date(Date.now() - 1000));
    const created = await storage.createUserClaimingInvitation(
      {
        id: "claim-exp-1",
        email: "exp@example.test",
        role: "manager",
        isActive: true,
        isApproved: true,
      } as any,
      inv.id
    );
    expect(created).toBeNull();
    expect(await storage.getUserByEmail("exp@example.test")).toBeUndefined();
    expect((await storage.getUserInvitationById(inv.id))?.status).toBe("pending");
  });

  it("accept path: two concurrent accepts by the signed-in user promote once", async () => {
    const inv = await invite("acc@example.test", "manager");
    const u = await createUser({ role: "customer", email: "acc@example.test" });
    const a = await loginAs(ctx.app, u);
    const [r1, r2] = await Promise.all([
      a.post(`/api/invitations/${inv.invitationToken}/accept`),
      a.post(`/api/invitations/${inv.invitationToken}/accept`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    expect((await storage.getUser(u.id))?.role).toBe("manager");
  });

  describe("create route expiry", () => {
    const create = async (body: Record<string, unknown>) => {
      const admin = await createUser({ role: "admin" });
      const a = await loginAs(ctx.app, admin);
      return a
        .post("/api/admin/invitations")
        .send({ email: `exp-${Math.random().toString(36).slice(2, 8)}@example.test`, role: "agent", ...body });
    };

    it("rejects a past expiry with 400 invalid_expiry", async () => {
      const res = await create({ expiresAt: new Date(Date.now() - 60000).toISOString() });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_expiry");
    });

    it("rejects 45 days ahead with 400 invalid_expiry", async () => {
      const res = await create({ expiresAt: new Date(Date.now() + 45 * 86400000).toISOString() });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_expiry");
    });

    it("accepts 29 days ahead and defaults to about 7 days", async () => {
      const ok = await create({ expiresAt: new Date(Date.now() + 29 * 86400000).toISOString() });
      expect(ok.status).toBeLessThan(300);
      const def = await create({});
      expect(def.status).toBeLessThan(300);
      const rows = await db.select().from(userInvitations).orderBy(userInvitations.id);
      const days = (d: Date) => (new Date(d).getTime() - Date.now()) / 86400000;
      expect(days(rows[0].expiresAt)).toBeGreaterThan(28);
      expect(days(rows[1].expiresAt)).toBeGreaterThan(6.9);
      expect(days(rows[1].expiresAt)).toBeLessThan(7.1);
    });
  });
});
