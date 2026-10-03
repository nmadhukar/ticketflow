import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { storage } from "../../storage";

/**
 * C03 (A5) and C37 (S1): approve, then log in; deactivate, then re-activate, then log in.
 * R68: an unknown id on approve is 404 user_not_found (it answered 200 with an empty body).
 */
describe("admin: approve and re-activate, then log in", () => {
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

  const login = (email: string) =>
    request(ctx.app).post("/api/auth/login").send({ email, password: DEFAULT_PASSWORD });

  it("a pending user is refused login, an admin approves, and login succeeds", async () => {
    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const pending = await createUser({ role: "agent", isApproved: false });

    const refused = await login(pending.email!);
    expect(refused.status).toBe(401);
    expect(refused.body.message).toMatch(/pending admin approval/i);

    const approved = await admin.post(`/api/admin/users/${pending.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.id).toBe(pending.id);
    expect(approved.body.isApproved).toBe(true);
    expect((await storage.getUser(pending.id))?.isApproved).toBe(true);

    expect((await login(pending.email!)).status).toBe(200);
  });

  it("deactivate refuses login, and re-activating through toggle-status lets the user in again", async () => {
    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const user = await createUser({ role: "agent" });
    expect((await login(user.email!)).status).toBe(200);

    const off = await admin.post(`/api/admin/users/${user.id}/toggle-status`);
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const refused = await login(user.email!);
    expect(refused.status).toBe(401);
    expect(refused.body.message).toMatch(/deactivated/i);

    const on = await admin.post(`/api/admin/users/${user.id}/toggle-status`);
    expect(on.status).toBe(200);
    expect(on.body.isActive).toBe(true);
    expect((await login(user.email!)).status).toBe(200);
  });

  it("an unknown id is 404 user_not_found", async () => {
    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const res = await admin.post("/api/admin/users/no-such-user/approve");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
    expect(typeof res.body.message).toBe("string");
  });

  it("a non-admin is 403, and nothing is approved", async () => {
    const pending = await createUser({ role: "agent", isApproved: false });
    for (const role of ["agent", "manager", "customer"] as const) {
      const caller = await loginAs(ctx.app, await createUser({ role }));
      const res = await caller.post(`/api/admin/users/${pending.id}/approve`);
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
    }
    expect((await storage.getUser(pending.id))?.isApproved).toBe(false);
  });
});
