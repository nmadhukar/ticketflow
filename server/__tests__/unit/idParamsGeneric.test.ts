import express from "express";
import request from "supertest";
import { installErrorHandling, registerIdParams } from "../../http/install";

/**
 * Task 7 follow-ups: a param named `id` or `...Id` is validated as a number even when nobody
 * listed it (read from the route table), and another middleware's 4xx keeps its status and code.
 */
function buildApp() {
  const app = express();
  registerIdParams(app);
  const ok: express.RequestHandler = (req, res) => res.json({ ok: true, params: req.params });
  app.get("/api/articles/:articleId", ok);
  app.get("/api/shops/:shopId/items/:itemId", ok);
  app.get("/api/people/:userId/notes/:slug", ok);
  app.get("/api/sessions/:sessionId", ok);
  const nested = express.Router();
  nested.get("/:widgetId", ok);
  app.use("/api/widgets", nested);
  const status = (code: number): express.RequestHandler => (_req, _res, next) =>
    next(Object.assign(new Error("middleware says no"), { status: code }));
  app.get("/api/mw/401", status(401));
  app.get("/api/mw/403", status(403));
  app.get("/api/mw/404", status(404));
  app.get("/api/mw/405", status(405));
  app.get("/api/mw/418", status(418));
  installErrorHandling(app);
  return app;
}

describe("generic id param validation", () => {
  const app = buildApp();

  it.each([
    "/api/articles/abc",
    "/api/articles/0",
    "/api/articles/-4",
    "/api/articles/1.5",
    "/api/shops/abc/items/1",
    "/api/shops/1/items/abc",
    "/api/widgets/abc",
  ])("%s -> 400 invalid_id, though no one listed the param", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_id");
  });

  it.each(["/api/articles/7", "/api/shops/1/items/2", "/api/widgets/3"])("%s -> reaches the handler", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("string params stay strings", async () => {
    for (const url of ["/api/people/not-a-number/notes/some-slug", "/api/sessions/abc-def"]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
    }
  });
});

describe("generic 4xx from other middleware", () => {
  const app = buildApp();

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [405, "bad_request"],
    [418, "bad_request"],
  ])("status %i keeps its status with code %s and no internals", async (status, code) => {
    const res = await request(app).get(`/api/mw/${status}`);
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(code);
    expect(typeof res.body.message).toBe("string");
    expect(JSON.stringify(res.body)).not.toContain("middleware says no");
  });
});
