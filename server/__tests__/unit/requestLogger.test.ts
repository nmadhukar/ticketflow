import express from "express";
import request from "supertest";
import { requestLogger, redactLogPath, maskSecrets } from "../../utils/requestLogger";

describe("redactLogPath", () => {
  it("hides the invitation token but keeps the shape of the route", () => {
    expect(redactLogPath("/api/invitations/abc123")).toBe("/api/invitations/[redacted]");
    expect(redactLogPath("/api/invitations/abc123/accept")).toBe(
      "/api/invitations/[redacted]/accept"
    );
  });
  it("leaves ordinary paths alone", () => {
    expect(redactLogPath("/api/tasks/5")).toBe("/api/tasks/5");
    expect(redactLogPath("/api/invitations")).toBe("/api/invitations");
  });
});

describe("requestLogger", () => {
  const TOKEN = "SECRETTOKEN-abc123";
  const lines: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(requestLogger((l) => lines.push(l)));
  app.get("/api/invitations/:token", (req, res) => res.json({ token: req.params.token }));
  app.post("/api/auth/login", (_req, res) => res.json({ accessToken: TOKEN }));
  app.post("/api/auth/reset-password", (_req, res) => res.json({ token: TOKEN }));
  app.get("/api/ok", (_req, res) => res.json({ a: 1 }));
  app.get("/api/leaky", (_req, res) =>
    res.json({ a: 1, password: TOKEN, plainKey: TOKEN, keyHash: TOKEN, nested: { apiKey: TOKEN, clientSecret: TOKEN } })
  );

  beforeEach(() => {
    lines.length = 0;
  });
  const flush = () => new Promise((r) => setImmediate(r));

  it("never writes an invitation token path or body to the log", async () => {
    await request(app).get(`/api/invitations/${TOKEN}`);
    await flush();
    expect(lines).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines[0]).toContain("/api/invitations/[redacted]");
  });

  it("does not log response bodies of /api/auth routes", async () => {
    await request(app).post("/api/auth/login").send({});
    await request(app).post("/api/auth/reset-password").send({});
    await flush();
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines[0]).toMatch(/POST \/api\/auth\/login 200/);
  });

  it("still logs ordinary bodies, with secret-looking keys masked", async () => {
    await request(app).get("/api/ok");
    await request(app).get("/api/leaky");
    await flush();
    expect(lines[0]).toContain('{"a":1}');
    expect(lines[1]).not.toContain(TOKEN);
    expect(lines[1]).toContain("[redacted]");
  });
});

describe("maskSecrets", () => {
  it("masks key-bearing field names, including plainKey from POST /api/api-keys", () => {
    const out = JSON.parse(
      JSON.stringify(
        { plainKey: "k1", apiKey: "k2", keyHash: "k3", token: "k4", secret: "k5", accessToken: "k6", password: "k7", name: "ok" },
        maskSecrets
      )
    );
    expect(out.name).toBe("ok");
    for (const k of ["plainKey", "apiKey", "keyHash", "token", "secret", "accessToken", "password"]) {
      expect(out[k]).toBe("[redacted]");
    }
  });
});
