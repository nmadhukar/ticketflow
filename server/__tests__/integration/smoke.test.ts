import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";

describe("integration harness", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx.close(); });
  beforeEach(async () => { await resetDb(); });

  it("rejects an anonymous ticket list with 401 JSON", async () => {
    const res = await request(ctx.app).get("/api/tasks");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/json/);
  });

  it("logs a seeded admin in and lists tickets", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const res = await agent.get("/api/tasks");
    expect(res.status).toBe(200);
  });
});
