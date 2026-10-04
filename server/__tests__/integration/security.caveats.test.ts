import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";

/** Y1: anonymous calls are each 401 in the error contract. Y8: security headers and the health shape. */
describe("anonymous access and security headers (Y1, Y8)", () => {
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

  it.each([
    ["/api/teams"],
    ["/api/admin/users"],
    ["/api/knowledge/search?query=printer"],
  ])("Y1: anonymous GET %s is 401 in the error contract", async (path) => {
    const res = await request(ctx.app).get(path);
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: "unauthorized", message: expect.any(String) });
  });

  it("Y1: the same three paths answer a signed-in admin, so the 401 is the missing session and nothing else", async () => {
    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    for (const path of ["/api/teams", "/api/admin/users", "/api/knowledge/search?query=printer"]) {
      expect([path, (await admin.get(path)).status]).toEqual([path, 200]);
    }
  });

  it("Y8: every response, API or not, carries nosniff and X-Frame-Options DENY", async () => {
    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const responses = [
      await request(ctx.app).get("/api/security/health"),
      await request(ctx.app).get("/health"),
      await request(ctx.app).get("/api/tasks"), // a 401
      await request(ctx.app).get("/api/no-such-route"), // a 404
      await admin.get("/api/tasks"),
    ];
    for (const res of responses) {
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
    }
  });

  it("Y8: GET /api/security/health answers { healthy, checks, timestamp } with its five boolean checks", async () => {
    const res = await request(ctx.app).get("/api/security/health");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["checks", "healthy", "timestamp"]);
    expect(typeof res.body.healthy).toBe("boolean");
    expect(Object.keys(res.body.checks).sort()).toEqual([
      "awsCredentials",
      "httpsRedirect",
      "inputValidation",
      "jwtSecret",
      "rateLimiting",
    ]);
    for (const value of Object.values(res.body.checks)) expect(typeof value).toBe("boolean");
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    // healthy is exactly "every check passes".
    expect(res.body.healthy).toBe(Object.values(res.body.checks).every(Boolean));
  });
});
