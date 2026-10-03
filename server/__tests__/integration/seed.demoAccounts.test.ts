import { jest } from "@jest/globals";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { runSeeders, type SeederSet } from "../../seed/runSeeders";
import { deactivateDemoAccounts } from "../../seed/deactivateDemoAccounts";
import { seedBootstrapAdmin } from "../../seed/bootstrapAdmin";
import { DEMO_ADMIN_PASSWORD, DEMO_PASSWORD } from "../../seed/demoAccounts";

const noop = async () => {};
const seeders = {
  systemUser: noop,
  aiSystemUser: noop,
  emailTemplates: noop,
  demoUsers: noop,
  departments: noop,
  teams: noop,
  tickets: noop,
  knowledge: noop,
  helpAndDocs: noop,
  knowledgeLearning: noop,
  deactivateDemoAccounts,
  bootstrapAdmin: seedBootstrapAdmin,
} as SeederSet;

async function insertDemo(email: string, password: string, role: "admin" | "agent") {
  await createUser({ role, email, password });
}
const active = async (email: string) =>
  (await db.select().from(users).where(eq(users.email, email)))[0]?.isActive;

describe("leftover demo accounts on an existing deployment", () => {
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

  it("deactivates demo accounts that still have the published password, leaves changed ones, deletes nothing", async () => {
    await insertDemo("admin@ticketflow.local", DEMO_ADMIN_PASSWORD, "admin");
    await insertDemo("agent1@ticketflow.local", DEMO_PASSWORD, "agent");
    await insertDemo("agent2@ticketflow.local", "A-changed-password-1!", "agent");
    await createUser({ role: "agent", email: "real.person@example.test", password: DEMO_PASSWORD });

    await runSeeders({ NODE_ENV: "production" }, seeders);

    expect(await active("admin@ticketflow.local")).toBe(false);
    expect(await active("agent1@ticketflow.local")).toBe(false);
    expect(await active("agent2@ticketflow.local")).toBe(true);
    expect(await active("real.person@example.test")).toBe(true);
    expect(await db.select().from(users)).toHaveLength(4);
  });

  it("checks every case-variant row of a demo email, not just one", async () => {
    await insertDemo("admin@ticketflow.local", "A-changed-password-1!", "admin");
    await insertDemo("Admin@Ticketflow.local", DEMO_ADMIN_PASSWORD, "admin");
    await deactivateDemoAccounts({});
    expect(await active("admin@ticketflow.local")).toBe(true);
    expect(await active("Admin@Ticketflow.local")).toBe(false);
  });

  it("is idempotent and logs emails, never passwords", async () => {
    await insertDemo("admin@ticketflow.local", DEMO_ADMIN_PASSWORD, "admin");
    const warn = console.warn as unknown as jest.Mock;
    warn.mockClear();
    expect(await deactivateDemoAccounts({})).toEqual(["admin@ticketflow.local"]);
    expect(await deactivateDemoAccounts({})).toEqual([]);
    const text = warn.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(text).toContain("admin@ticketflow.local");
    expect(text).not.toContain(DEMO_ADMIN_PASSWORD);
    expect(text).not.toContain(DEMO_PASSWORD);
  });

  it("SEED_DEMO_DATA=true leaves demo accounts alone", async () => {
    await insertDemo("admin@ticketflow.local", DEMO_ADMIN_PASSWORD, "admin");
    await runSeeders({ NODE_ENV: "development", SEED_DEMO_DATA: "true" }, seeders);
    expect(await active("admin@ticketflow.local")).toBe(true);
  });

  it("then the env admin is created, because the demo admin no longer counts", async () => {
    await insertDemo("admin@ticketflow.local", DEMO_ADMIN_PASSWORD, "admin");
    await runSeeders(
      { NODE_ENV: "production", ADMIN_EMAIL: "root@example.test", ADMIN_PASSWORD: "Env-Admin-Pw-5521!" },
      seeders
    );
    const [root] = await db.select().from(users).where(eq(users.email, "root@example.test"));
    expect(root.role).toBe("admin");
    expect(root.isActive).toBe(true);
  });
  it("a malformed stored hash on one demo row is logged and skipped; the rest still deactivate", async () => {
    await insertDemo("admin@ticketflow.local", DEMO_ADMIN_PASSWORD, "admin");
    await insertDemo("agent1@ticketflow.local", DEMO_PASSWORD, "agent");
    await insertDemo("agent2@ticketflow.local", DEMO_PASSWORD, "agent");
    await db.update(users).set({ password: "not-a-valid-hash" }).where(eq(users.email, "admin@ticketflow.local"));
    const error = console.error as unknown as jest.Mock;
    error.mockClear();
    const done = await deactivateDemoAccounts({});
    expect(done.sort()).toEqual(["agent1@ticketflow.local", "agent2@ticketflow.local"]);
    expect(await active("admin@ticketflow.local")).toBe(true);
    expect(await active("agent1@ticketflow.local")).toBe(false);
    expect(await active("agent2@ticketflow.local")).toBe(false);
    const text = error.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");
    expect(text).toContain("admin@ticketflow.local");
    expect(text).not.toContain("not-a-valid-hash");
  });

  it("a failed lookup for one account does not abort the loop, and then fails the step (M8)", async () => {
    await insertDemo("agent1@ticketflow.local", DEMO_PASSWORD, "agent");
    const realSelect = db.select.bind(db);
    let calls = 0;
    const spy = jest.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
      calls += 1;
      if (calls === 1) throw new Error("lookup failed");
      return (realSelect as any)(...args);
    }) as any);
    try {
      // The first account (admin@ticketflow.local) could not be checked: it may still be live.
      await expect(deactivateDemoAccounts({})).rejects.toThrow(
        "Demo account check failed for 1 account(s): admin@ticketflow.local"
      );
      // ...but every other account was still checked and switched off.
      expect(await active("agent1@ticketflow.local")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("M8: a failed demo check stops runSeeders before anything else runs", async () => {
    const steps: string[] = [];
    const failing = {
      ...seeders,
      deactivateDemoAccounts: async () => {
        throw new Error("db down: postgres://user:secret@host/db");
      },
      migrateLegacyRoles: async () => {
        steps.push("roles");
      },
      bootstrapAdmin: async () => {
        steps.push("admin");
      },
    } as SeederSet;
    const err = (await runSeeders({}, failing).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Startup refused: required step "demo account deactivation" failed [Error]');
    expect(err.message).not.toContain("secret");
    expect(steps).toEqual([]);
  });
});
