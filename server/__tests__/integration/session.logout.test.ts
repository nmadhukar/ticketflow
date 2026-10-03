import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, DEFAULT_PASSWORD } from "./helpers/fixtures";

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** The `Set-Cookie` header of the login response, as a list. */
function setCookies(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

describe("sessions: logout (A4) and cookie hardening (Y9)", () => {
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

  async function login() {
    const user = await createUser({ role: "agent" });
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    const cookie = setCookies(res).find((c) => c.startsWith("connect.sid="));
    expect(cookie).toBeDefined();
    return { user, cookie: cookie!.split(";")[0], res };
  }

  it("A4: after POST /api/auth/logout the old cookie is 401 on /api/auth/user and on /api/tasks", async () => {
    const { user, cookie } = await login();

    // The cookie works before logout.
    const before = await request(ctx.app).get("/api/auth/user").set("Cookie", cookie);
    expect(before.status).toBe(200);
    expect(before.body.id).toBe(user.id);
    expect((await request(ctx.app).get("/api/tasks").set("Cookie", cookie)).status).toBe(200);

    const out = await request(ctx.app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(200);

    // The very same cookie, replayed, is no longer a session.
    const afterUser = await request(ctx.app).get("/api/auth/user").set("Cookie", cookie);
    expect(afterUser.status).toBe(401);
    expect(afterUser.body.error).toBeDefined();
    const afterTasks = await request(ctx.app).get("/api/tasks").set("Cookie", cookie);
    expect(afterTasks.status).toBe(401);
  });

  it("A4: logging out one browser leaves another session of the same user alive", async () => {
    const user = await createUser({ role: "agent" });
    const first = await request(ctx.app).post("/api/auth/login").send({ email: user.email, password: DEFAULT_PASSWORD });
    const second = await request(ctx.app).post("/api/auth/login").send({ email: user.email, password: DEFAULT_PASSWORD });
    const c1 = setCookies(first).find((c) => c.startsWith("connect.sid="))!.split(";")[0];
    const c2 = setCookies(second).find((c) => c.startsWith("connect.sid="))!.split(";")[0];
    expect(c1).not.toBe(c2);

    await request(ctx.app).post("/api/auth/logout").set("Cookie", c1).expect(200);
    expect((await request(ctx.app).get("/api/auth/user").set("Cookie", c1)).status).toBe(401);
    expect((await request(ctx.app).get("/api/auth/user").set("Cookie", c2)).status).toBe(200);
  });

  it("Y9: the session cookie is httpOnly, SameSite=Lax and lives 7 days", async () => {
    const { res } = await login();
    const cookie = setCookies(res).find((c) => c.startsWith("connect.sid="))!;
    const attrs = cookie.split(";").map((a) => a.trim().toLowerCase());
    expect(attrs).toContain("httponly");
    expect(attrs).toContain("samesite=lax");
    expect(attrs).toContain("path=/");
    // Secure is a deploy input (COOKIE_SECURE=true); it is proved in session.cookieSecure.test.ts.
    expect(attrs).not.toContain("secure");

    // express-session turns maxAge into an Expires date: exactly one week from now.
    const expires = cookie.split(";").map((a) => a.trim()).find((a) => /^expires=/i.test(a))!;
    const ms = new Date(expires.slice("expires=".length)).getTime() - Date.now();
    expect(ms).toBeGreaterThan((WEEK_SECONDS - 120) * 1000);
    expect(ms).toBeLessThanOrEqual((WEEK_SECONDS + 5) * 1000);
  });
});
