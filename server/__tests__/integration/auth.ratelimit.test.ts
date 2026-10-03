import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";

describe("auth rate limit", () => {
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

  it("11 login attempts in a minute from one IP get 429 even when the client spoofs X-Forwarded-For", async () => {
    // trust proxy = 1: req.ip is the LAST X-Forwarded-For entry, the address
    // nginx saw. The attacker controls only the entries before it.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(ctx.app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `203.0.113.${i + 1}, 198.51.100.7`)
        .send({ email: "nobody@example.test", password: "wrong-password" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  // Each test below uses its own last-X-Forwarded-For address (the limiter key)
  // so counters from other tests in this file cannot leak in.
  async function postTimes(method: "post" | "get", path: string, n: number, ip: string) {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) {
      const res = await request(ctx.app)[method](path).set("X-Forwarded-For", `203.0.113.1, ${ip}`).send({
        email: "nobody@example.test",
        password: "wrong-password-long",
        currentPassword: "x",
        newPassword: "another-long-password",
      });
      statuses.push(res.status);
    }
    return statuses;
  }

  it("a case and trailing-slash variant of the login path is limited (the mount matches like the route)", async () => {
    const statuses = await postTimes("post", "/API/Auth/Login/", 11, "198.51.100.21");
    expect(statuses.slice(0, 10)).not.toContain(429);
    expect(statuses[10]).toBe(429);
  });

  it("GET on a limited path is not counted", async () => {
    await postTimes("get", "/api/auth/login", 15, "198.51.100.22");
    const statuses = await postTimes("post", "/api/auth/login", 10, "198.51.100.22");
    expect(statuses).not.toContain(429);
    expect((await postTimes("post", "/api/auth/login", 1, "198.51.100.22"))[0]).toBe(429);
  });

  it("change-password is limited", async () => {
    const statuses = await postTimes("post", "/api/auth/change-password", 11, "198.51.100.23");
    expect(statuses.slice(0, 10)).not.toContain(429);
    expect(statuses[10]).toBe(429);
  });

  it("forgot-password, reset-password and change-password each have their own budget", async () => {
    const ip = "198.51.100.40";
    expect(await postTimes("post", "/api/auth/forgot-password", 10, ip)).not.toContain(429);
    expect((await postTimes("post", "/api/auth/forgot-password", 1, ip))[0]).toBe(429);
    // The other two are untouched by those ten requests.
    expect((await postTimes("post", "/api/auth/reset-password", 1, ip))[0]).not.toBe(429);
    expect((await postTimes("post", "/api/auth/change-password", 1, ip))[0]).not.toBe(429);
  });

  it("forgot-password and reset-password are limited too", async () => {
    for (const path of ["/api/auth/forgot-password", "/api/auth/reset-password"]) {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await request(ctx.app)
          .post(path)
          .set("X-Forwarded-For", `203.0.113.${i + 1}, 198.51.100.${path.endsWith("forgot-password") ? 8 : 9}`)
          .send({ email: "nobody@example.test", token: "x", password: "whatever-long" });
        statuses.push(res.status);
      }
      expect(statuses[10]).toBe(429);
      expect(statuses.slice(0, 10)).not.toContain(429);
    }
  });
});
