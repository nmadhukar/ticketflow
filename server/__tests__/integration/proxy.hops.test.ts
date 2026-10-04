import express from "express";
import type { IncomingMessage } from "http";
import request from "supertest";
import { parseTrustProxyHops } from "../../env";
import { attachRealtime, originAllowed } from "../../realtime/ws";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";

/** An express app set up exactly as server/index.ts does it, answering with req.ip. */
function ipProbe(hops: string | undefined) {
  const app = express();
  app.set("trust proxy", parseTrustProxyHops(hops, () => {}));
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe("R49: TRUST_PROXY_HOPS decides which X-Forwarded-For entry is the client", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    ctx.app.set("trust proxy", 1);
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  const XFF = "203.0.113.9, 198.51.100.50, 10.0.0.1";

  it("1 (the default): req.ip is the LAST entry", async () => {
    const res = await request(ipProbe(undefined)).get("/ip").set("X-Forwarded-For", XFF);
    expect(res.body.ip).toBe("10.0.0.1");
  });

  it("2: req.ip is the second-to-last entry", async () => {
    const res = await request(ipProbe("2")).get("/ip").set("X-Forwarded-For", XFF);
    expect(res.body.ip).toBe("198.51.100.50");
  });

  it("0: X-Forwarded-For is ignored and req.ip is the socket address", async () => {
    const res = await request(ipProbe("0")).get("/ip").set("X-Forwarded-For", XFF);
    expect(res.body.ip).toMatch(/127\.0\.0\.1$|::1$/);
  });

  it("with 2, the auth limiter keys on the second-to-last entry", async () => {
    ctx.app.set("trust proxy", parseTrustProxyHops("2", () => {}));
    const statuses: number[] = [];
    // The first and the last entries change on every request; only the second-to-last is constant.
    for (let i = 0; i < 11; i++) {
      const res = await request(ctx.app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `203.0.113.${i + 1}, 198.51.100.77, 10.0.0.${i + 1}`)
        .send({ email: "nobody@example.test", password: "wrong-password" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("with 2, requests that differ only in the second-to-last entry are different clients (no 429)", async () => {
    ctx.app.set("trust proxy", parseTrustProxyHops("2", () => {}));
    for (let i = 0; i < 12; i++) {
      const res = await request(ctx.app)
        .post("/api/auth/reset-password")
        .set("X-Forwarded-For", `203.0.113.9, 198.51.100.${100 + i}, 10.0.0.1`)
        .send({ email: "nobody@example.test", token: "x", password: "whatever-long" });
      expect(res.status).not.toBe(429);
    }
  });

  it("with 0, the auth limiter ignores X-Forwarded-For and keys on the connection", async () => {
    ctx.app.set("trust proxy", parseTrustProxyHops("0", () => {}));
    const statuses: number[] = [];
    // Every request claims a different client; with no proxy trusted they are all one address.
    for (let i = 0; i < 11; i++) {
      const res = await request(ctx.app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", `203.0.113.${i + 1}`)
        .send({ email: "nobody@example.test" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10)).not.toContain(429);
    expect(statuses[10]).toBe(429);
  });

  it("with 0, the WebSocket origin check does not trust x-forwarded-host (and with a proxy it does)", () => {
    const upgrade = {
      headers: { origin: "https://tickets.example.test", host: "app:5000", "x-forwarded-host": "tickets.example.test" },
    } as unknown as IncomingMessage;
    const noServer = { on() {}, off() {} } as never;
    // routes/index.ts passes Boolean(app.get("trust proxy")).
    const trusting = express();
    trusting.set("trust proxy", parseTrustProxyHops("2", () => {}));
    attachRealtime(noServer, { trustProxy: Boolean(trusting.get("trust proxy")) })();
    expect(originAllowed(upgrade)).toBe(true);

    const direct = express();
    direct.set("trust proxy", parseTrustProxyHops("0", () => {}));
    attachRealtime(noServer, { trustProxy: Boolean(direct.get("trust proxy")) })();
    expect(originAllowed(upgrade)).toBe(false);
  });
});
