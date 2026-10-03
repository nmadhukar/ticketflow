import express from "express";
import request from "supertest";
import { securityAuditLog } from "../../security/middleware";
import { createCustomRateLimit } from "../../security/rateLimiting";

/** Stands in for the session/bearer middleware: header x-uid is the user row's id. */
const asSessionUser: express.RequestHandler = (req, _res, next) => {
  const id = req.headers["x-uid"];
  if (typeof id === "string") (req as any).user = { id, role: "admin" };
  next();
};

function captureLog(): string[] {
  const lines: string[] = [];
  jest.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
  return lines;
}

const entry = (lines: string[], prefix: string) => {
  const line = lines.find((l) => l.startsWith(prefix));
  expect(line).toBeDefined();
  return JSON.parse(line!.slice(prefix.length));
};

describe("R56: audit log and custom limiter read the session user's id", () => {
  afterEach(() => jest.restoreAllMocks());

  it("the SECURITY_ACCESS and SECURITY_RESPONSE lines for a session admin carry the admin's id", async () => {
    const lines = captureLog();
    const app = express();
    app.use(asSessionUser, securityAuditLog as express.RequestHandler);
    app.get("/api/admin/x", (_req, res) => res.sendStatus(200));
    await request(app).get("/api/admin/x").set("x-uid", "admin-42");
    expect(entry(lines, "SECURITY_ACCESS:").userId).toBe("admin-42");
    expect(entry(lines, "SECURITY_RESPONSE:").userId).toBe("admin-42");
  });

  it("a JWT-payload user (userId only) is still logged", async () => {
    const lines = captureLog();
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { userId: "jwt-7", role: "agent" };
      next();
    }, securityAuditLog as express.RequestHandler);
    app.get("/api/users", (_req, res) => res.sendStatus(200));
    await request(app).get("/api/users");
    expect(entry(lines, "SECURITY_ACCESS:").userId).toBe("jwt-7");
  });

  it("an anonymous request is keyed by IP (IPv6 addresses by their /56 prefix)", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(createCustomRateLimit({ windowMs: 60000, max: 1 }));
    app.get("/x", (_req, res) => res.sendStatus(200));
    const hit = (ip: string) => request(app).get("/x").set("X-Forwarded-For", ip);
    expect((await hit("2001:db8:1:1::1")).status).toBe(200);
    expect((await hit("2001:db8:1:1::ffff")).status).toBe(429); // same /56
    expect((await hit("203.0.113.5")).status).toBe(200);
  });

  it("a custom limiter with no keyGenerator keys two session users on one IP separately", async () => {
    const app = express();
    app.use(asSessionUser, createCustomRateLimit({ windowMs: 60000, max: 1 }));
    app.get("/x", (_req, res) => res.sendStatus(200));
    expect((await request(app).get("/x").set("x-uid", "u1")).status).toBe(200);
    expect((await request(app).get("/x").set("x-uid", "u2")).status).toBe(200);
    expect((await request(app).get("/x").set("x-uid", "u1")).status).toBe(429);
  });
});
