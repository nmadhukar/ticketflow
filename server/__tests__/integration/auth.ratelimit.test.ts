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
