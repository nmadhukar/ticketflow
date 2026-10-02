import { jest } from "@jest/globals";
import request from "supertest";
import { eq } from "drizzle-orm";
import { apiKeys, users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { AI_SYSTEM_USER_ID } from "../../utils/aiSystemUserId";
import { SYSTEM_USER_ID, SYSTEM_USER_EMAIL } from "../../utils/systemUser";
import { deactivateLegacyApiKeys } from "../../seed/legacyApiKeyFixup";
import { runSeeders, type SeederSet } from "../../seed/runSeeders";
import {
  API_KEY_PERMISSIONS,
  findActiveKey,
  generateApiKey,
  hashApiKey,
} from "../../services/auth/apiKeys";

const DAY = 24 * 60 * 60 * 1000;

function loggedText(): string {
  const parts: string[] = [];
  for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
    const mock = console[fn] as unknown as jest.Mock;
    for (const call of mock.mock?.calls ?? []) parts.push(call.map(String).join(" "));
  }
  return parts.join("\n");
}

/** Stores a key row directly, bypassing the route, and returns the plaintext. */
async function seedKey(
  userId: string,
  over: Partial<typeof apiKeys.$inferInsert> = {}
): Promise<string> {
  const { plaintext, hash } = generateApiKey();
  await db.insert(apiKeys).values({
    userId,
    name: "seeded",
    keyHash: hash,
    keyPrefix: plaintext.slice(0, 8),
    permissions: [...API_KEY_PERMISSIONS],
    expiresAt: new Date(Date.now() + 30 * DAY),
    isActive: true,
    ...over,
  });
  return plaintext;
}

// One app (and one connection pool) for the whole file.
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

describe("generateApiKey / hashApiKey", () => {
  it("makes a tfk_ plaintext and a sha256: hash of it, and never repeats", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).toMatch(/^tfk_[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashApiKey(a.plaintext));
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toContain(a.plaintext);
  });
});

describe("API keys: admin-issued and hashed", () => {

  it("answers 401 to an anonymous caller and 403 to every non-admin role", async () => {
    const target = await createUser({ role: "customer" });
    const anon = await request(ctx.app).post("/api/api-keys").send({ userId: target.id, name: "x" });
    expect(anon.status).toBe(401);
    for (const role of ["customer", "agent", "manager"] as const) {
      const caller = await createUser({ role });
      const agent = await loginAs(ctx.app, caller);
      const res = await agent.post("/api/api-keys").send({ userId: target.id, name: "x" });
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
      expect(res.body.error).toBe("forbidden");
      expect((await agent.get("/api/api-keys")).status).toBe(403);
    }
    expect(await db.select().from(apiKeys)).toHaveLength(0);
  });

  it("issues a key for a chosen customer: plaintext once, only the hash stored, server-set permissions and 90-day expiry", async () => {
    const admin = await createUser({ role: "admin" });
    const c1 = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, admin);

    const before = Date.now();
    const res = await agent.post("/api/api-keys").send({
      userId: c1.id,
      name: "CI pipeline",
      permissions: ["admin:everything"],
      expiresAt: "2999-01-01T00:00:00.000Z",
      keyHash: "sha256:attacker",
      isActive: false,
    });
    expect(res.status).toBe(201);
    const { plainKey } = res.body;
    expect(plainKey).toMatch(/^tfk_[A-Za-z0-9_-]{43}$/);
    expect(res.body.keyHash).toBeUndefined();
    expect(res.body.userId).toBe(c1.id);
    expect(res.body.name).toBe("CI pipeline");

    const rows = await db.select().from(apiKeys);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.keyHash).toBe(hashApiKey(plainKey));
    expect(row.keyHash.startsWith("sha256:")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(plainKey);
    expect(row.userId).toBe(c1.id);
    expect(row.permissions).toEqual(["mcp:tickets"]);
    expect(row.isActive).toBe(true);
    expect(row.keyPrefix).toBe(plainKey.slice(0, 8));
    const days = (row.expiresAt!.getTime() - before) / DAY;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);

    // The key works once, and neither the plaintext nor the hash reached a log.
    const found = await findActiveKey(plainKey);
    expect(found?.user.id).toBe(c1.id);
    const logs = loggedText();
    expect(logs).not.toContain(plainKey);
    expect(logs).not.toContain(row.keyHash);
    expect(logs).not.toContain(row.keyHash.slice(7, 27));
  });

  it("lets the admin choose an expiry in days, within bounds", async () => {
    const admin = await createUser({ role: "admin" });
    const c1 = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, admin);
    const ok = await agent.post("/api/api-keys").send({ userId: c1.id, name: "short", expiresInDays: 7 });
    expect(ok.status).toBe(201);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, ok.body.id));
    expect((row.expiresAt!.getTime() - Date.now()) / DAY).toBeLessThan(7.1);
    for (const bad of [0, -1, 1.5, 4000, "soon"]) {
      const res = await agent.post("/api/api-keys").send({ userId: c1.id, name: "x", expiresInDays: bad });
      expect({ bad, status: res.status }).toEqual({ bad, status: 400 });
    }
  });

  it("rejects bad input and owners that may not hold a key", async () => {
    const admin = await createUser({ role: "admin" });
    const inactive = await createUser({ role: "customer", isActive: false });
    const pending = await createUser({ role: "customer", isApproved: false });
    await ensureAiSystemUser();
    const agent = await loginAs(ctx.app, admin);
    const post = (body: unknown) => agent.post("/api/api-keys").send(body as object);

    expect((await post({ name: "no user" })).status).toBe(400);
    expect((await post({ userId: admin.id })).status).toBe(400);
    expect((await post({ userId: admin.id, name: "" })).status).toBe(400);
    expect((await post({ userId: admin.id, name: "x".repeat(300) })).status).toBe(400);
    expect((await post({ userId: "no-such-user", name: "x" })).status).toBe(404);
    expect((await post({ userId: inactive.id, name: "x" })).status).toBe(400);
    expect((await post({ userId: pending.id, name: "x" })).status).toBe(400);
    const ai = await post({ userId: AI_SYSTEM_USER_ID, name: "x" });
    expect(ai.status).toBe(400);
    expect(ai.body.error).toBe("system_account");

    // The legacy "system" user, made active and approved so only the system-account rule can refuse it.
    await db.insert(users).values({
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      role: "admin",
      isActive: true,
      isApproved: true,
    });
    const sys = await post({ userId: SYSTEM_USER_ID, name: "x" });
    expect(sys.status).toBe(400);
    expect(sys.body.error).toBe("system_account");
    expect(await db.select().from(apiKeys)).toHaveLength(0);
  });

  it("marks expired keys in the listing", async () => {
    const admin = await createUser({ role: "admin" });
    const c1 = await createUser({ role: "customer" });
    await seedKey(c1.id, { name: "old", expiresAt: new Date(Date.now() - DAY) });
    await seedKey(c1.id, { name: "fresh" });
    await seedKey(c1.id, { name: "never", expiresAt: null });
    const res = await (await loginAs(ctx.app, admin)).get("/api/api-keys");
    const by = Object.fromEntries(res.body.map((k: { name: string; expired: boolean }) => [k.name, k.expired]));
    expect(by).toEqual({ old: true, fresh: false, never: false });
  });

  it("lists keys without plaintext or hash, and revokes one", async () => {
    const admin = await createUser({ role: "admin" });
    const c1 = await createUser({ role: "customer" });
    const c2 = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, admin);
    const k1 = await agent.post("/api/api-keys").send({ userId: c1.id, name: "one" });
    await agent.post("/api/api-keys").send({ userId: c2.id, name: "two" });

    const all = await agent.get("/api/api-keys");
    expect(all.status).toBe(200);
    expect(all.body.map((k: { name: string }) => k.name).sort()).toEqual(["one", "two"]);
    const mine = await agent.get(`/api/api-keys?userId=${c1.id}`);
    expect(mine.body.map((k: { name: string }) => k.name)).toEqual(["one"]);
    const text = JSON.stringify(all.body);
    expect(text).not.toContain(k1.body.plainKey);
    expect(text).not.toContain("sha256:");
    for (const k of all.body) {
      expect(k.keyHash).toBeUndefined();
      expect(k.plainKey).toBeUndefined();
      expect(k.keyPrefix).toMatch(/^tfk_/);
    }

    const stranger = await loginAs(ctx.app, await createUser({ role: "agent" }));
    expect((await stranger.delete(`/api/api-keys/${k1.body.id}`)).status).toBe(403);
    expect(await findActiveKey(k1.body.plainKey)).not.toBeNull();

    expect((await agent.delete(`/api/api-keys/${k1.body.id}`)).status).toBe(204);
    expect(await findActiveKey(k1.body.plainKey)).toBeNull();
    expect((await agent.delete(`/api/api-keys/${k1.body.id}`)).status).toBe(404);
    expect((await agent.delete("/api/api-keys/999999")).status).toBe(404);
  });

  it("no longer serves the old Perplexity key routes, which stored a third-party key in key_hash", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const res = await agent.post("/api/api-keys/perplexity").send({ apiKey: "pplx-secret" });
    expect(res.status).toBe(404);
    expect(await db.select().from(apiKeys)).toHaveLength(0);
  });
});

describe("findActiveKey", () => {

  it("returns the owner for a live key and stamps lastUsedAt", async () => {
    const owner = await createUser({ role: "customer" });
    const plaintext = await seedKey(owner.id);
    const found = await findActiveKey(plaintext);
    expect(found?.user.id).toBe(owner.id);
    expect(typeof found?.keyId).toBe("number");
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, found!.keyId));
    expect(row.lastUsedAt).toBeInstanceOf(Date);
  });

  it("still accepts a valid key when the lastUsedAt write fails, logging one fixed line", async () => {
    const owner = await createUser({ role: "customer" });
    const plaintext = await seedKey(owner.id);
    const spy = jest
      .spyOn(storage, "updateApiKeyLastUsed")
      .mockRejectedValue(new Error(`boom ${plaintext}`));
    try {
      const found = await findActiveKey(plaintext);
      expect(found?.user.id).toBe(owner.id);
      expect(spy).toHaveBeenCalled();
      const logs = loggedText();
      expect(logs).toContain("lastUsedAt update failed");
      expect(logs).not.toContain(plaintext);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns null for junk, an unknown key, and a never-hashed key", async () => {
    const owner = await createUser({ role: "customer" });
    await seedKey(owner.id);
    for (const junk of ["", "tfk_", "nope", `tfk_${"A".repeat(43)}`, `tfk_${"A".repeat(500)}`, null, undefined, 42]) {
      expect(await findActiveKey(junk as never)).toBeNull();
    }
    // A legacy row whose key_hash is the plaintext itself cannot be presented.
    const legacy = generateApiKey();
    await db.insert(apiKeys).values({
      userId: owner.id,
      name: "legacy",
      keyHash: legacy.plaintext,
      keyPrefix: legacy.plaintext.slice(0, 8),
      isActive: true,
    });
    expect(await findActiveKey(legacy.plaintext)).toBeNull();
  });

  it("refuses revoked and expired keys", async () => {
    const owner = await createUser({ role: "customer" });
    const revoked = await seedKey(owner.id, { isActive: false });
    const expired = await seedKey(owner.id, { expiresAt: new Date(Date.now() - 1000) });
    const noExpiry = await seedKey(owner.id, { expiresAt: null });
    expect(await findActiveKey(revoked)).toBeNull();
    expect(await findActiveKey(expired)).toBeNull();
    expect(await findActiveKey(noExpiry)).not.toBeNull();
  });

  it("refuses a key whose owner is inactive or not approved", async () => {
    const inactive = await createUser({ role: "customer" });
    const pending = await createUser({ role: "customer" });
    const k1 = await seedKey(inactive.id);
    const k2 = await seedKey(pending.id);
    expect(await findActiveKey(k1)).not.toBeNull();
    await db.update(users).set({ isActive: false }).where(eq(users.id, inactive.id));
    await db.update(users).set({ isApproved: false }).where(eq(users.id, pending.id));
    expect(await findActiveKey(k1)).toBeNull();
    expect(await findActiveKey(k2)).toBeNull();
  });

  it("refuses the AI system user and the legacy system user even when they look active", async () => {
    await ensureAiSystemUser();
    await db.update(users).set({ isActive: true, isApproved: true }).where(eq(users.id, AI_SYSTEM_USER_ID));
    await db.insert(users).values({
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      role: "admin",
      isActive: true,
      isApproved: true,
    });
    const ai = await seedKey(AI_SYSTEM_USER_ID);
    const sys = await seedKey(SYSTEM_USER_ID);
    expect(await findActiveKey(ai)).toBeNull();
    expect(await findActiveKey(sys)).toBeNull();
  });

  it("makes a stored hash unique, so two rows can never share one", async () => {
    const owner = await createUser({ role: "customer" });
    const { plaintext, hash } = generateApiKey();
    const row = { userId: owner.id, name: "a", keyHash: hash, keyPrefix: plaintext.slice(0, 8) };
    await db.insert(apiKeys).values(row);
    await expect(db.insert(apiKeys).values(row)).rejects.toThrow();
  });
});

describe("legacy API key fix-up", () => {

  it("deactivates every row that is not a sha256 hash, keeps the rest, and is idempotent", async () => {
    const owner = await createUser({ role: "customer" });
    const good = await seedKey(owner.id);
    const dupA = { userId: owner.id, keyPrefix: "tfk_legc", isActive: true } as const;
    // Two legacy rows may even share a value: only sha256: rows are unique.
    await db.insert(apiKeys).values([
      { ...dupA, name: "legacy-1", keyHash: "tfk_plaintextvalue" },
      { ...dupA, name: "legacy-2", keyHash: "tfk_plaintextvalue" },
      { ...dupA, name: "perplexity", keyHash: "pplx-third-party-key", isActive: true },
    ]);

    expect(await deactivateLegacyApiKeys()).toBe(3);
    const rows = await db.select().from(apiKeys);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["legacy-1"].isActive).toBe(false);
    expect(byName["legacy-2"].isActive).toBe(false);
    expect(byName["perplexity"].isActive).toBe(false);
    expect(byName["seeded"].isActive).toBe(true);
    expect(rows).toHaveLength(4); // nothing deleted
    expect(await findActiveKey(good)).not.toBeNull();

    expect(await deactivateLegacyApiKeys()).toBe(0);
  });

  it("runs on every startup, right after the other data fix-ups and before anything serves keys", async () => {
    const order: string[] = [];
    const step = (name: string) => async () => {
      order.push(name);
    };
    const seeders = {
      migrateLegacyRoles: step("roles"),
      migrateAssigneeTypes: step("assignees"),
      deactivateLegacyApiKeys: step("apiKeys"),
      systemUser: step("systemUser"),
      aiSystemUser: step("aiSystemUser"),
      deactivateDemoAccounts: step("demo"),
      bootstrapAdmin: step("admin"),
      emailTemplates: step("templates"),
    } as unknown as SeederSet;
    await runSeeders({} as NodeJS.ProcessEnv, seeders);
    expect(order.slice(0, 3)).toEqual(["roles", "assignees", "apiKeys"]);
    expect(order).toContain("apiKeys");
  });
});
