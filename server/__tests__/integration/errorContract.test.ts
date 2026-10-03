import express from "express";
import request from "supertest";
import { z } from "zod";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { HttpError, asyncHandler } from "../../http/errors";
import { installErrorHandling } from "../../http/install";

describe("error contract on the real app", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx.close(); });
  beforeEach(async () => { await resetDb(); });

  it("unknown /api path is a 404 JSON, not HTML", async () => {
    const res = await request(ctx.app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.error).toBe("not_found");
  });

  it("unknown /API path (case-insensitive mount) is also 404 JSON", async () => {
    const res = await request(ctx.app).post("/API/Nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("malformed JSON body is 400 JSON without a stack", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_json");
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|\bat \w+/);
  });

  it("known routes still respond normally", async () => {
    const agent = await loginAs(ctx.app, await createUser({ role: "admin" }));
    expect((await agent.get("/api/tasks")).status).toBe(200);
  });
});

describe("errorMiddleware", () => {
  const app = express();
  app.get("/boom", (_req, _res) => { throw new Error("secret internals"); });
  app.get("/async-boom", asyncHandler(async () => { throw new Error("async secret"); }));
  app.get("/http", asyncHandler(async () => { throw new HttpError(409, "invalid_state", "nope", { a: 1 }); }));
  app.get("/zod", asyncHandler(async () => { z.object({ n: z.number() }).parse({ n: "x" }); }));
  installErrorHandling(app);

  it("500 JSON hides the message and the stack", async () => {
    for (const p of ["/boom", "/async-boom"]) {
      const res = await request(app).get(p);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "internal_error", message: "Internal server error" });
      expect(res.text).not.toMatch(/stack|secret/);
    }
  });

  it("M7: logs an unhandled error by type and code only, in one line, never the object or its message", async () => {
    const pgLike = Object.assign(new Error("duplicate key: email=alice@example.test token=tfk_live_secret"), {
      name: "DatabaseError",
      code: "23505",
      detail: "Key (email)=(alice@example.test)",
    });
    const local = express();
    local.get("/pg", () => {
      throw pgLike;
    });
    installErrorHandling(local);
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    spy.mockClear(); // console.error is already a mock (setup.ts) holding earlier tests' calls
    try {
      expect((await request(local).get("/pg")).status).toBe(500);
      expect((await request(app).get("/boom")).status).toBe(500);
      expect(spy.mock.calls).toEqual([["Unhandled error [DatabaseError 23505]"], ["Unhandled error [Error]"]]);
      const logged = JSON.stringify(spy.mock.calls);
      for (const secret of ["alice@example.test", "tfk_live_secret", "secret internals"]) expect(logged).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });

  it("HttpError keeps status, code and details", async () => {
    const res = await request(app).get("/http");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "invalid_state", message: "nope", details: { a: 1 } });
  });

  it("zod failure is 400 with field details", async () => {
    const res = await request(app).get("/zod");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.details.fieldErrors.n).toBeDefined();
  });
});
