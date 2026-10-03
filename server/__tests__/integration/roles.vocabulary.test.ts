import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { users, userInvitations } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { hashPassword } from "../../services/auth";
import { migrateLegacyRoles } from "../../seed/legacyRoleFixup";
import { runSeeders, type SeederSet } from "../../seed/runSeeders";

const noop = async () => {};

describe("role vocabulary: user means agent", () => {
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

  async function legacyUser() {
    const id = randomUUID();
    const email = `legacy-${id.slice(0, 8)}@example.test`;
    await db.insert(users).values({
      id,
      email,
      password: await hashPassword(DEFAULT_PASSWORD),
      role: "user",
      isActive: true,
      isApproved: true,
    });
    return { id, email };
  }
  const roleOf = async (id: string) =>
    (await db.select().from(users).where(eq(users.id, id)))[0].role;

  it("the startup fix-up converts legacy user rows to agent, idempotently, touching nothing else", async () => {
    const legacy = await legacyUser();
    const admin = await createUser({ role: "admin" });
    const customer = await createUser({ role: "customer" });
    expect(await migrateLegacyRoles()).toBe(1);
    expect(await migrateLegacyRoles()).toBe(0);
    expect(await roleOf(legacy.id)).toBe("agent");
    expect(await roleOf(admin.id)).toBe("admin");
    expect(await roleOf(customer.id)).toBe("customer");
  });

  it("runSeeders runs the fix-up before the other seeders", async () => {
    const legacy = await legacyUser();
    let roleSeenBySystemUser: string | undefined;
    const seeders = {
      migrateLegacyRoles,
      systemUser: async () => {
        roleSeenBySystemUser = await roleOf(legacy.id);
      },
      aiSystemUser: noop,
      emailTemplates: noop,
      deactivateDemoAccounts: noop,
      bootstrapAdmin: noop,
    } as unknown as SeederSet;
    await runSeeders({ NODE_ENV: "production" }, seeders);
    expect(roleSeenBySystemUser).toBe("agent");
    expect(await roleOf(legacy.id)).toBe("agent");
  });

  it("a converted legacy account keeps agent rights (staff-only /api/users)", async () => {
    const legacy = await legacyUser();
    await migrateLegacyRoles();
    const [row] = await db.select().from(users).where(eq(users.id, legacy.id));
    const agent = await loginAs(ctx.app, row as any);
    expect((await agent.get("/api/users")).status).toBe(200);
    const me = await agent.get("/api/auth/user");
    expect(me.body.role).toBe("agent");
  });

  it("even before the fix-up ran, a legacy user row is treated as agent, not locked out or promoted", async () => {
    const legacy = await legacyUser();
    const [row] = await db.select().from(users).where(eq(users.id, legacy.id));
    const agent = await loginAs(ctx.app, row as any);
    expect((await agent.get("/api/users")).status).toBe(200);
    expect((await agent.get("/api/auth/user")).body.role).toBe("agent");
    const adminOnly = await agent.post(`/api/admin/users/${legacy.id}/reset-password`);
    expect(adminOnly.status).toBe(403);
  });

  it("a user with an unknown role is refused on the next request (fail closed)", async () => {
    const u = await createUser({ role: "agent" });
    const agent = await loginAs(ctx.app, u);
    await db.update(users).set({ role: "superuser" }).where(eq(users.id, u.id));
    expect((await agent.get("/api/users")).status).toBe(401);
  });

  it("self-registration defaults to customer", async () => {
    const res = await request(ctx.app).post("/api/auth/register").send({
      email: "selfreg@example.test",
      password: "Sup3rSecret!pw",
      firstName: "Self",
      lastName: "Reg",
    });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(users).where(eq(users.email, "selfreg@example.test"));
    expect(row.role).toBe("customer");
  });

  describe("invitation creation whitelists the role", () => {
    const send = async (body: Record<string, unknown>) => {
      const admin = await createUser({ role: "admin" });
      const agent = await loginAs(ctx.app, admin);
      return agent.post("/api/admin/invitations").send({ email: `i-${randomUUID().slice(0, 6)}@example.test`, ...body });
    };

    it.each(["agent", "manager", "admin", "customer"])("accepts %s", async (role) => {
      const res = await send({ role });
      expect(res.status).toBeLessThan(300);
    });

    it.each(["user", "superuser", "", undefined])("rejects %p with 400 invalid_role", async (role) => {
      const res = await send({ role });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_role");
      expect(await db.select().from(userInvitations)).toHaveLength(0);
    });
  });
});
