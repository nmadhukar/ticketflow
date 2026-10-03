import { jest } from "@jest/globals";
import request from "supertest";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { seedBootstrapAdmin } from "../../seed/bootstrapAdmin";

const PW = "Bootstrap-Pw-9271!";

function loggedText(): string {
  const parts: string[] = [];
  for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
    const mock = console[fn] as unknown as jest.Mock;
    for (const call of mock.mock?.calls ?? []) parts.push(call.map(String).join(" "));
  }
  return parts.join("\n");
}

describe("bootstrap admin", () => {
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

  it("creates the first admin from ADMIN_EMAIL and ADMIN_PASSWORD, who can log in, and never logs the password", async () => {
    await seedBootstrapAdmin({ ADMIN_EMAIL: "root@example.test", ADMIN_PASSWORD: PW });
    const [row] = await db.select().from(users).where(eq(users.email, "root@example.test"));
    expect(row.role).toBe("admin");
    expect(row.isActive).toBe(true);
    expect(row.isApproved).toBe(true);
    expect(row.password).not.toContain(PW);
    expect(loggedText()).not.toContain(PW);

    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "root@example.test", password: PW });
    expect(res.status).toBe(200);
  });

  it("creates nothing when ADMIN_EMAIL or ADMIN_PASSWORD is missing", async () => {
    await seedBootstrapAdmin({ ADMIN_EMAIL: "root@example.test" });
    await seedBootstrapAdmin({ ADMIN_PASSWORD: PW });
    await seedBootstrapAdmin({});
    expect(await db.select().from(users)).toHaveLength(0);
    expect(loggedText()).not.toContain(PW);
  });

  it("creates nothing when an admin already exists", async () => {
    await createUser({ role: "admin" });
    await seedBootstrapAdmin({ ADMIN_EMAIL: "root@example.test", ADMIN_PASSWORD: PW });
    const all = await db.select().from(users);
    expect(all).toHaveLength(1);
  });

  it("a passwordless system admin row does not count as an admin", async () => {
    await db.insert(users).values({
      id: "system",
      email: "system@ticketflow.local",
      role: "admin",
      isActive: true,
      isApproved: true,
    });
    await seedBootstrapAdmin({ ADMIN_EMAIL: "root@example.test", ADMIN_PASSWORD: PW });
    const [row] = await db.select().from(users).where(eq(users.email, "root@example.test"));
    expect(row).toBeDefined();
  });
  it("when ADMIN_EMAIL already belongs to a non-admin account, warns clearly, changes nothing and does not throw", async () => {
    const u = await createUser({ role: "agent", email: "root@example.test" });
    const warn = console.warn as unknown as jest.Mock;
    warn.mockClear();
    await expect(
      seedBootstrapAdmin({ ADMIN_EMAIL: "Root@Example.test", ADMIN_PASSWORD: PW })
    ).resolves.toBeUndefined();
    const all = await db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0].role).toBe("agent");
    expect(all[0].password).toBe(u.password);
    const text = warn.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(text).toMatch(/ADMIN_EMAIL/);
    expect(text).toContain("root@example.test");
    expect(text).not.toContain(PW);
  });
});
