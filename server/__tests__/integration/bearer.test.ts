import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { apiKeys, sessions, users } from "@shared/schema";
import { JWT_AUDIENCE, JWT_ISSUER } from "../../security/jwt";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs, createTicketAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import type { Request, Response } from "express";
import {
  API_KEY_PERMISSIONS,
  generateApiKey,
  issueApiKey,
} from "../../services/auth/apiKeys";
import { bearerAuth, markSessionAuth } from "../../services/auth/bearer";

const DAY = 24 * 60 * 60 * 1000;
const JWT_SECRET_VALUE = randomBytes(24).toString("hex");

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let ipCounter = 10;
/** Every request gets its own limiter key, so failures in one test never throttle another. */
const freshIp = () => `198.51.100.${++ipCounter}`;

function get(path: string, bearer?: string, ip = freshIp()) {
  const r = request(ctx.app).get(path).set("X-Forwarded-For", ip);
  return bearer === undefined ? r : r.set("Authorization", `Bearer ${bearer}`);
}

function signJwt(
  claims: Record<string, unknown>,
  opts: jwt.SignOptions = {},
  secret = JWT_SECRET_VALUE
) {
  return jwt.sign(claims, secret, {
    algorithm: "HS256",
    expiresIn: "1h",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    ...opts,
  });
}

function enableJwt() {
  process.env.JWT_SECRET = JWT_SECRET_VALUE;
  process.env.BEARER_JWT_ENABLED = "true";
}

async function sessionCount(): Promise<number> {
  const rows = await db.select().from(sessions);
  return rows.length;
}

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  delete process.env.JWT_SECRET;
  delete process.env.BEARER_JWT_ENABLED;
  await resetDb();
});
afterEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.BEARER_JWT_ENABLED;
});

describe("bearer API keys", () => {
  it("a valid key is its owner on /api/auth/user, with no cookie set and no secrets in the body", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const res = await get("/api/auth/user", plaintext);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(owner.id);
    expect(res.body.role).toBe("customer");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/"password"|passwordHash|passwordReset|keyHash|failedLogin|lockedUntil/i);
  });

  it("GET /api/tasks through a key is scoped to the owner, not the caller's broader reach", async () => {
    const admin = await createUser({ role: "admin" });
    const adminAgent = await loginAs(ctx.app, admin);
    const customerA = await createUser({ role: "customer" });
    const customerB = await createUser({ role: "customer" });
    const a = await loginAs(ctx.app, customerA);
    const b = await loginAs(ctx.app, customerB);
    const mine = await createTicketAs(a, { title: "mine-ticket" });
    const theirs = await createTicketAs(b, { title: "theirs-ticket" });
    await createTicketAs(adminAgent, { title: "admin-ticket" });
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);

    const { plaintext } = await issueApiKey({ userId: customerA.id, name: "k" });
    const res = await get("/api/tasks", plaintext);
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.tasks ?? res.body.tickets;
    const titles = (list as { title: string }[]).map((t) => t.title);
    expect(titles).toContain("mine-ticket");
    expect(titles).not.toContain("theirs-ticket");
    expect(titles).not.toContain("admin-ticket");
  });

  it("garbage, wrong-prefix and unknown keys are 401 JSON", async () => {
    for (const token of ["garbage", "tfk_short", generateApiKey().plaintext]) {
      const res = await get("/api/auth/user", token);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("invalid_token");
      expect(res.body.message).toEqual(expect.any(String));
    }
  });

  it("an expired key is 401", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    await db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - DAY) })
      .where(eq(apiKeys.userId, owner.id));
    expect((await get("/api/auth/user", plaintext)).status).toBe(401);
  });

  it("a revoked key is 401", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.userId, owner.id));
    expect((await get("/api/auth/user", plaintext)).status).toBe(401);
  });

  it("a key whose owner was deactivated is 401", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    expect((await get("/api/auth/user", plaintext)).status).toBe(200);
    await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));
    expect((await get("/api/auth/user", plaintext)).status).toBe(401);
  });

  it("a present-but-invalid bearer is 401 even with a valid session cookie", async () => {
    const owner = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, owner);
    expect((await agent.get("/api/auth/user")).status).toBe(200);
    const res = await agent
      .get("/api/auth/user")
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  it("an empty bearer value is 401, a non-Bearer scheme is ignored", async () => {
    const owner = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, owner);
    const empty = await agent
      .get("/api/auth/user")
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", "Bearer ");
    expect(empty.status).toBe(401);
    const basic = await agent
      .get("/api/auth/user")
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", "Basic abc");
    expect(basic.status).toBe(200);
  });

  it("a bearer wins over a cookie for a different user", async () => {
    const cookieUser = await createUser({ role: "admin" });
    const keyOwner = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, cookieUser);
    const { plaintext } = await issueApiKey({ userId: keyOwner.id, name: "k" });
    const res = await agent
      .get("/api/auth/user")
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", `Bearer ${plaintext}`);
    expect(res.body.id).toBe(keyOwner.id);
  });

  it("is refused outright for a user who must change their password", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, owner.id));
    const res = await get("/api/auth/user", plaintext);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("password_change_required");
    expect((await get("/api/tasks", plaintext)).status).toBe(403);
  });

  it("a password change after the key was issued does not revoke the key, and is not treated as a revoked session", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    await db
      .update(users)
      .set({ passwordChangedAt: new Date() })
      .where(eq(users.id, owner.id));
    const res = await get("/api/auth/user", plaintext);
    expect(res.status).toBe(200);
  });

  it("exposes the method and key permissions on the request (for MCP)", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const req = {
      headers: { authorization: `Bearer ${plaintext}` },
      path: "/api/tasks",
      ip: freshIp(),
    } as unknown as Request;
    const res = { locals: {} } as unknown as Response;
    await new Promise<void>((resolve, reject) => {
      bearerAuth(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
    });
    const r = req as unknown as {
      user?: { id: string };
      authMethod?: unknown;
      apiKeyPermissions?: unknown;
    };
    expect(r.user?.id).toBe(owner.id);
    expect(r.authMethod).toBe("api_key");
    expect(r.apiKeyPermissions).toEqual([...API_KEY_PERMISSIONS]);
  });
});

describe("bearer JWT", () => {
  it("is ignored (401) when JWT_SECRET is not set, even for a token signed with the dev fallback", async () => {
    const owner = await createUser({ role: "customer" });
    const token = signJwt({ userId: owner.id }, {}, "dev-only-jwt-secret-not-for-production");
    expect((await get("/api/auth/user", token)).status).toBe(401);
    const token2 = signJwt({ userId: owner.id });
    expect((await get("/api/auth/user", token2)).status).toBe(401);
  });

  it("a valid token authenticates the user reloaded by id", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    const res = await get("/api/auth/user", signJwt({ userId: owner.id }));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(owner.id);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("accepts the standard sub claim as the user id", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    const res = await get("/api/auth/user", signJwt({}, { subject: owner.id }));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(owner.id);
  });

  it("a forged role:admin claim for a customer is still customer scope", async () => {
    enableJwt();
    const customer = await createUser({ role: "customer" });
    const other = await createUser({ role: "customer" });
    const otherAgent = await loginAs(ctx.app, other);
    await createTicketAs(otherAgent, { title: "someone-elses" });
    const token = signJwt({ userId: customer.id, role: "admin", email: "admin@example.test" });

    const me = await get("/api/auth/user", token);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("customer");
    expect(me.body.id).toBe(customer.id);

    const list = await get("/api/tasks", token);
    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : list.body.tasks ?? list.body.tickets;
    expect((rows as unknown[]).length).toBe(0);
    expect((await get("/api/users", token)).status).toBe(403);
  });

  it("rejects bad signature, expired, alg none, wrong algorithm, refresh type and unknown user", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    const wrongSecret = signJwt({ userId: owner.id }, {}, randomBytes(24).toString("hex"));
    const expired = signJwt({ userId: owner.id }, { expiresIn: -60 });
    const none = jwt.sign({ userId: owner.id }, "", { algorithm: "none" });
    const hs512 = signJwt({ userId: owner.id }, { algorithm: "HS512" });
    const refresh = signJwt({ userId: owner.id, type: "refresh" });
    const unknown = signJwt({ userId: "no-such-user" });
    const noSubject = signJwt({ role: "admin" });
    const noExp = jwt.sign({ userId: owner.id }, JWT_SECRET_VALUE, { algorithm: "HS256" });
    for (const token of [wrongSecret, expired, none, hs512, refresh, unknown, noSubject, noExp]) {
      const res = await get("/api/auth/user", token);
      expect(res.status).toBe(401);
    }
  });

  it("a token for a deactivated user is 401", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }))).status).toBe(401);
  });

  it("a token issued before the last password change is 401", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    await db
      .update(users)
      .set({ passwordChangedAt: new Date(Date.now() - 2 * 3600 * 1000) })
      .where(eq(users.id, owner.id));
    const iat = Math.floor(Date.now() / 1000) - 3600;
    const token = signJwt({ userId: owner.id, iat }, { expiresIn: "2h" });
    expect((await get("/api/auth/user", token)).status).toBe(200);
    await db.update(users).set({ passwordChangedAt: new Date() }).where(eq(users.id, owner.id));
    expect((await get("/api/auth/user", token)).status).toBe(401);
  });

  it("is refused for a user who must change their password", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, owner.id));
    const res = await get("/api/auth/user", signJwt({ userId: owner.id }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("password_change_required");
  });
});

describe("bearer failures are rate limited per IP", () => {
  it("the 11th bad bearer from one IP is 429, even a valid key then", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await get("/api/auth/user", `guess-${i}`, ip)).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await get("/api/auth/user", plaintext, ip)).status).toBe(429);
  });

  it("valid bearers never consume the budget: 30 concurrent valid-key requests all get 200", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const ip = freshIp();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => get("/api/auth/user", plaintext, ip))
    );
    expect(results.map((r) => r.status)).toEqual(Array(30).fill(200));
    // and the budget is still whole: a bad bearer is 401, not 429
    expect((await get("/api/auth/user", "bad", ip)).status).toBe(401);
  });
});

describe("a bearer request never touches a session", () => {
  async function expectNoSession(
    method: "get" | "post",
    path: string,
    token: string
  ) {
    const before = await sessionCount();
    const call = request(ctx.app)[method](path);
    const res = await call
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await sessionCount()).toBe(before);
    return res;
  }

  it("GET /api/tasks (registered after session tracking) sends no cookie and adds no row", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const res = await expectNoSession("get", "/api/tasks", plaintext);
    expect(res.status).toBe(200);
  });

  it("a route registered late (/api/admin/ai-analytics) sends no cookie and adds no row", async () => {
    const admin = await createUser({ role: "admin" });
    const { plaintext } = await issueApiKey({ userId: admin.id, name: "k" });
    await expectNoSession("get", "/api/admin/ai-analytics", plaintext);
  });

  it("POST /api/auth/logout is refused and touches no session", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: owner.id, name: "k" });
    const res = await expectNoSession("post", "/api/auth/logout", plaintext);
    expect(res.status).toBe(403);
  });

  it("a cookie request is tagged authMethod session", async () => {
    const req = { user: { id: "u" } } as unknown as Request;
    markSessionAuth(req, {} as Response, () => undefined);
    expect(req.authMethod).toBe("session");
  });
});

describe("R28: credential management is session-only", () => {
  async function expectSessionRequired(
    method: "get" | "post" | "delete" | "patch",
    path: string,
    token: string
  ) {
    const call = request(ctx.app)[method](path);
    const res = await call
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("session_required");
  }

  it("refuses an admin key on every credential family, and a session admin still reaches them", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser({ role: "customer" });
    const { plaintext } = await issueApiKey({ userId: admin.id, name: "k" });
    await expectSessionRequired("get", "/api/api-keys", plaintext);
    await expectSessionRequired("post", "/api/api-keys", plaintext);
    await expectSessionRequired("delete", "/api/api-keys/1", plaintext);
    await expectSessionRequired("post", "/api/auth/change-password", plaintext);
    await expectSessionRequired("post", "/api/auth/logout", plaintext);
    await expectSessionRequired("get", "/api/logout", plaintext);
    await expectSessionRequired("post", `/api/admin/users/${target.id}/reset-password`, plaintext);
    await expectSessionRequired("post", "/api/sso/config", plaintext);
    await expectSessionRequired("patch", "/api/company-settings/email/settings", plaintext);
    await expectSessionRequired("post", "/api/company-settings/email", plaintext);

    // the same admin with a cookie is not blocked by this gate
    const agent = await loginAs(ctx.app, admin);
    const ok = await agent.get("/api/api-keys");
    expect(ok.status).toBe(200);
  });

  it("refuses a JWT bearer too", async () => {
    enableJwt();
    const admin = await createUser({ role: "admin" });
    await expectSessionRequired("post", "/api/auth/change-password", signJwt({ userId: admin.id }));
  });
});

describe("R29: JWT bearer is opt-in and strict", () => {
  it("a valid token is 401 when BEARER_JWT_ENABLED is not true", async () => {
    const owner = await createUser({ role: "customer" });
    process.env.JWT_SECRET = JWT_SECRET_VALUE;
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }))).status).toBe(401);
    process.env.BEARER_JWT_ENABLED = "1";
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }))).status).toBe(401);
    enableJwt();
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }))).status).toBe(200);
  });

  it("wrong issuer or audience is 401", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }, { issuer: "other" }))).status).toBe(401);
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }, { audience: "other" }))).status).toBe(401);
  });

  it("missing or future iat is 401, small skew is allowed", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    const now = Math.floor(Date.now() / 1000);
    const noIat = jwt.sign({ userId: owner.id, exp: now + 3600 }, JWT_SECRET_VALUE, {
      algorithm: "HS256",
      noTimestamp: true,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect((await get("/api/auth/user", noIat)).status).toBe(401);
    const future = signJwt({ userId: owner.id, iat: now + 600 }, { expiresIn: "1h" });
    expect((await get("/api/auth/user", future)).status).toBe(401);
    const skewed = signJwt({ userId: owner.id, iat: now + 30 }, { expiresIn: "1h" });
    expect((await get("/api/auth/user", skewed)).status).toBe(200);
  });

  it("a lifetime over 24 hours is 401, exactly 24 hours is fine", async () => {
    enableJwt();
    const owner = await createUser({ role: "customer" });
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }, { expiresIn: "25h" }))).status).toBe(401);
    expect((await get("/api/auth/user", signJwt({ userId: owner.id }, { expiresIn: "24h" }))).status).toBe(200);
  });
});

describe("bearer is an /api concern", () => {
  it("a non-API path carrying a junk bearer does not get the JSON 401", async () => {
    const res = await request(ctx.app)
      .get("/some-page")
      .set("X-Forwarded-For", freshIp())
      .set("Authorization", "Bearer junk");
    expect(res.body?.error).not.toBe("invalid_token");
    expect(res.status).not.toBe(401);
  });
});

describe("role gates apply to bearer users", () => {
  it("GET /api/users: customer key 403, admin key 200", async () => {
    const customer = await createUser({ role: "customer" });
    const admin = await createUser({ role: "admin" });
    const c = await issueApiKey({ userId: customer.id, name: "k" });
    const a = await issueApiKey({ userId: admin.id, name: "k" });
    expect((await get("/api/users", c.plaintext)).status).toBe(403);
    expect((await get("/api/users", a.plaintext)).status).toBe(200);
  });
});

describe("cookie sessions are unchanged", () => {
  it("a cookie user still works, and a revoked session is still session_revoked", async () => {
    const owner = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, owner);
    expect((await agent.get("/api/auth/user")).status).toBe(200);
    await db
      .update(users)
      .set({ passwordChangedAt: new Date(Date.now() + 60_000) })
      .where(eq(users.id, owner.id));
    const res = await agent.get("/api/auth/user");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_revoked");
  });

  it("a cookie user who must change their password is still gated", async () => {
    const owner = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, owner);
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, owner.id));
    const res = await agent.get("/api/tasks");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("password_change_required");
  });
});
