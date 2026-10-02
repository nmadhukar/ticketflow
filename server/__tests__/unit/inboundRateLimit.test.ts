import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";
import { exceptInboundEmail, inboundEmailRateLimit } from "../../security/rateLimiting";

describe("rate limiting of POST /api/email/inbound", () => {
  it("the general /api limiter does not count the inbound endpoint, and still limits everything else", async () => {
    const app = express();
    const tiny = rateLimit({ windowMs: 60_000, max: 2, standardHeaders: false, legacyHeaders: false });
    app.use("/api", exceptInboundEmail(tiny));
    app.post("/api/email/inbound", (_req, res) => res.sendStatus(200));
    app.get("/api/other", (_req, res) => res.sendStatus(200));

    for (let i = 0; i < 10; i++) {
      expect((await request(app).post("/api/email/inbound")).status).toBe(200);
    }
    expect((await request(app).get("/api/other")).status).toBe(200);
    expect((await request(app).get("/api/other")).status).toBe(200);
    expect((await request(app).get("/api/other")).status).toBe(429);
  });

  it("the inbound limiter is its own, generous, per-IP limiter", async () => {
    const app = express();
    app.post("/api/email/inbound", inboundEmailRateLimit, (_req, res) => res.sendStatus(200));
    const res = await request(app).post("/api/email/inbound");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.headers)).toMatch(/600/); // the limit, in whichever RateLimit header draft is in use
  });
});
