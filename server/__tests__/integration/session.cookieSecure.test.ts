import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, DEFAULT_PASSWORD } from "./helpers/fixtures";

/**
 * Y9: the session cookie is Secure when the deploy sets COOKIE_SECURE=true
 * (docker-compose passes it through). setupAuth reads the variable while the app is
 * built, so this file sets it before createTestApp and the default-environment file
 * (session.logout.test.ts) proves the opposite.
 */
describe("Y9: COOKIE_SECURE=true marks the session cookie Secure", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let previous: string | undefined;
  beforeAll(async () => {
    previous = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = "true";
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
    if (previous === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previous;
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("login over https sets httpOnly; Secure; SameSite=Lax", async () => {
    const user = await createUser({ role: "agent" });
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    const raw = res.headers["set-cookie"] as unknown as string[];
    const cookie = raw.find((c) => c.startsWith("connect.sid="))!;
    const attrs = cookie.split(";").map((a) => a.trim().toLowerCase());
    expect(attrs).toEqual(expect.arrayContaining(["httponly", "secure", "samesite=lax"]));
  });
});
