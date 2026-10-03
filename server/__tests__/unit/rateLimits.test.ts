import express, { type RequestHandler } from "express";
import request from "supertest";

// The MCP tools reach the database through ticketService; tools/list does not need it.
jest.mock("../../services/tickets/ticketService", () => ({
  createTicket: jest.fn(),
  getTicket: jest.fn(),
  listTickets: jest.fn(),
  updateTicket: jest.fn(),
  closeTicket: jest.fn(),
  reopenTicket: jest.fn(),
  deleteTicket: jest.fn(),
  addComment: jest.fn(),
}));

import {
  createGeneralRateLimit,
  createMcpRateLimit,
  exceptOwnLimiters,
  generalRateLimitConfig,
  rateLimitingEnabled,
} from "../../security/rateLimiting";
import { createMcpRouter, MCP_PERMISSION } from "../../mcp/router";
import { fail } from "../../http/errors";

describe("M4: the general /api limit", () => {
  it("honours RATE_LIMIT_MAX_REQUESTS and RATE_LIMIT_WINDOW_MS, with the old defaults when unset or junk", () => {
    expect(generalRateLimitConfig({})).toEqual({ windowMs: 900000, max: 100 });
    expect(generalRateLimitConfig({ RATE_LIMIT_MAX_REQUESTS: "250", RATE_LIMIT_WINDOW_MS: "60000" })).toEqual({
      windowMs: 60000,
      max: 250,
    });
    for (const junk of ["", "0", "-5", "1.5", "lots"]) {
      expect(generalRateLimitConfig({ RATE_LIMIT_MAX_REQUESTS: junk, RATE_LIMIT_WINDOW_MS: junk })).toEqual({
        windowMs: 900000,
        max: 100,
      });
    }
  });

  it("is on only in production, and RATE_LIMITING_ENABLED=false turns it off there", () => {
    expect(rateLimitingEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(rateLimitingEnabled({ NODE_ENV: "production", RATE_LIMITING_ENABLED: "false" })).toBe(false);
    expect(rateLimitingEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(rateLimitingEnabled({})).toBe(false);
  });

  it("answers the configured limit's next request with 429 in the error contract", async () => {
    const app = express();
    app.use("/api", exceptOwnLimiters(createGeneralRateLimit({ RATE_LIMIT_MAX_REQUESTS: "2", RATE_LIMIT_WINDOW_MS: "60000" })));
    app.get("/api/other", (_req, res) => res.sendStatus(200));
    app.post("/api/mcp", (_req, res) => res.sendStatus(200));
    app.post("/api/email/inbound", (_req, res) => res.sendStatus(200));

    expect((await request(app).get("/api/other")).status).toBe(200);
    expect((await request(app).get("/api/other")).status).toBe(200);
    const limited = await request(app).get("/api/other");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "too_many_requests", message: expect.any(String) });

    // The two endpoints with their own limiter are not counted by, or blocked by, this one.
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post("/api/mcp")).status).toBe(200);
      expect((await request(app).post("/api/MCP/")).status).toBe(200);
      expect((await request(app).post("/api/email/inbound")).status).toBe(200);
    }
  });

  it("a route that answers 429 without a code also gets too_many_requests", async () => {
    const app = express();
    app.get("/x", (_req, res) => fail(res, 429, "Slow down"));
    const res = await request(app).get("/x");
    expect(res.body).toEqual({ error: "too_many_requests", message: "Slow down" });
  });
});

describe("M4: /api/mcp has its own limiter, keyed by API key", () => {
  /** Stands in for the bearer middleware: header x-key-id is the API key id. */
  const fakeKeyAuth: RequestHandler = (req, _res, next) => {
    const id = Number(req.headers["x-key-id"]);
    if (id > 0) {
      req.user = { id: `owner-${id}`, role: "agent" } as Express.User;
      req.authMethod = "api_key";
      req.apiKeyId = id;
      req.apiKeyPermissions = [MCP_PERMISSION];
    }
    next();
  };

  function appWith(limiter: RequestHandler) {
    const app = express();
    app.use(express.json());
    app.use(fakeKeyAuth);
    app.use("/api/mcp", createMcpRouter({ rateLimit: limiter }));
    return app;
  }

  const listTools = (app: express.Express, keyId?: number) => {
    const r = request(app).post("/api/mcp").set("Accept", "application/json, text/event-stream");
    return (keyId ? r.set("x-key-id", String(keyId)) : r).send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  };

  it("one key's budget is its own: the third call from key 1 is 429, key 2 from the same address still works", async () => {
    const app = appWith(createMcpRateLimit({ windowMs: 60000, max: 2 }));
    expect((await listTools(app, 1)).status).toBe(200);
    expect((await listTools(app, 1)).status).toBe(200);
    const limited = await listTools(app, 1);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "too_many_requests", message: expect.stringMatching(/API key/) });
    const other = await listTools(app, 2);
    expect(other.status).toBe(200);
    expect(other.body.result.tools.length).toBe(8);
  });

  it("the default MCP limit is the generous 600 per 15 minutes", async () => {
    const app = appWith(createMcpRateLimit());
    const res = await listTools(app, 7);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.headers)).toMatch(/600/);
  });

  it("a request with no key is keyed by address and still refused 401 by the key check", async () => {
    const app = appWith(createMcpRateLimit({ windowMs: 60000, max: 1 }));
    expect((await listTools(app)).status).toBe(401);
    expect((await listTools(app)).status).toBe(429);
    expect((await listTools(app, 3)).status).toBe(200);
  });
});
