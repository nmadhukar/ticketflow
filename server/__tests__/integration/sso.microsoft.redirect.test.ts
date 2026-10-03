import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";

/**
 * A9: with Microsoft SSO configured (here through the environment, which the
 * route reads at startup) GET /api/auth/microsoft redirects to the Microsoft
 * login host. The callback itself is external (Microsoft calls it) and is not
 * exercised here.
 */
describe("GET /api/auth/microsoft when configured", () => {
  const saved = { ...process.env };
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    await resetDb();
    process.env.MICROSOFT_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
    process.env.MICROSOFT_CLIENT_SECRET = "generated-test-secret";
    process.env.MICROSOFT_TENANT_ID = "00000000-0000-0000-0000-000000000002";
    ctx = await createTestApp();
  });
  afterAll(async () => {
    process.env = saved;
    await ctx.close();
  });

  it("redirects to login.microsoftonline.com and keeps the secret out of the URL", async () => {
    const res = await request(ctx.app).get("/api/auth/microsoft").redirects(0);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.host).toBe("login.microsoftonline.com");
    expect(location.pathname).toContain("00000000-0000-0000-0000-000000000002");
    expect(res.headers.location).not.toContain("generated-test-secret");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("never logs the authorize URL: it carries the CSRF state", async () => {
    const res = await request(ctx.app).get("/api/auth/microsoft").redirects(0);
    const state = new URL(res.headers.location).searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(10);
    const logged = (["log", "info", "warn", "error"] as const)
      .flatMap((fn) => ((console[fn] as unknown as jest.Mock).mock?.calls ?? []) as unknown[][])
      .map((call) => call.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      .join("\n");
    expect(logged).toContain("Redirecting to Microsoft login");
    expect(logged).not.toContain(state);
    expect(logged).not.toContain("login.microsoftonline.com/00000000-0000-0000-0000-000000000002/oauth2");
  });

  it("R34: the redirect URI is APP_BASE_URL's callback, not the request's Host", async () => {
    process.env.APP_BASE_URL = "https://tickets.example.test";
    try {
      const res = await request(ctx.app).get("/api/auth/microsoft").set("Host", "evil.example").redirects(0);
      expect(res.status).toBe(302);
      const redirectUri = new URL(res.headers.location).searchParams.get("redirect_uri");
      expect(redirectUri).toBe("https://tickets.example.test/api/auth/microsoft/callback");
    } finally {
      delete process.env.APP_BASE_URL;
    }
  });
});
