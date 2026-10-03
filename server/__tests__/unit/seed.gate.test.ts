import { jest } from "@jest/globals";
import { runSeeders, startupFailureLine, StartupStepError, type SeederSet } from "../../seed/runSeeders";

function fakeSeeders() {
  return {
    systemUser: jest.fn(async () => {}),
    aiSystemUser: jest.fn(async () => null),
    deactivateDemoAccounts: jest.fn(async (_env: NodeJS.ProcessEnv) => []),
    bootstrapAdmin: jest.fn(async (_env: NodeJS.ProcessEnv) => {}),
    emailTemplates: jest.fn(async () => {}),
    demoUsers: jest.fn(async () => {}),
    departments: jest.fn(async () => {}),
    teams: jest.fn(async () => {}),
    tickets: jest.fn(async () => {}),
    knowledge: jest.fn(async () => {}),
    helpAndDocs: jest.fn(async () => {}),
    knowledgeLearning: jest.fn(async () => {}),
  };
}
const asSet = (s: ReturnType<typeof fakeSeeders>) => s as unknown as SeederSet;
const DEMO = [
  "demoUsers",
  "departments",
  "teams",
  "tickets",
  "knowledge",
  "helpAndDocs",
  "knowledgeLearning",
] as const;

describe("seeding gate", () => {
  it("production without SEED_DEMO_DATA seeds no demo data", async () => {
    const s = fakeSeeders();
    await runSeeders({ NODE_ENV: "production" }, asSet(s));
    for (const k of DEMO) expect(s[k]).not.toHaveBeenCalled();
    expect(s.systemUser).toHaveBeenCalled();
    expect(s.emailTemplates).toHaveBeenCalled();
  });

  it("the AI system user step runs with SEED_DEMO_DATA unset, false and true", async () => {
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "production", SEED_DEMO_DATA: "false" },
      { NODE_ENV: "development", SEED_DEMO_DATA: "true" },
    ]) {
      const s = fakeSeeders();
      await runSeeders(env, asSet(s));
      expect(s.aiSystemUser).toHaveBeenCalledTimes(1);
    }
  });

  it("no environment seeds demo data unless SEED_DEMO_DATA is exactly 'true'", async () => {
    for (const env of [
      { NODE_ENV: "development" },
      { NODE_ENV: "production", SEED_DEMO_DATA: "false" },
      { NODE_ENV: "production", SEED_DEMO_DATA: "1" },
      { NODE_ENV: "production", SEED_DEMO_DATA: "" },
    ]) {
      const s = fakeSeeders();
      await runSeeders(env, asSet(s));
      for (const k of DEMO) expect(s[k]).not.toHaveBeenCalled();
    }
  });

  it("SEED_DEMO_DATA=true seeds the demo set", async () => {
    const s = fakeSeeders();
    await runSeeders({ NODE_ENV: "development", SEED_DEMO_DATA: "true" }, asSet(s));
    for (const k of DEMO) expect(s[k]).toHaveBeenCalledTimes(1);
  });

  it("the bootstrap admin step always runs and receives the env", async () => {
    const s = fakeSeeders();
    const env = { NODE_ENV: "production", ADMIN_EMAIL: "a@b.test" };
    await runSeeders(env, asSet(s));
    expect(s.bootstrapAdmin).toHaveBeenCalledWith(env);
  });

  it("a failing demo seeder is reported and does not stop the others", async () => {
    const s = fakeSeeders();
    s.teams.mockRejectedValueOnce(new Error("boom") as never);
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await runSeeders({ SEED_DEMO_DATA: "true" }, asSet(s));
    expect(s.tickets).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("a failing bootstrap step propagates (startup must not continue without its admin)", async () => {
    const s = fakeSeeders();
    const cause = new Error("no db");
    s.bootstrapAdmin.mockRejectedValueOnce(cause as never);
    const err = (await runSeeders({}, asSet(s)).catch((e: unknown) => e)) as StartupStepError;
    expect(err).toBeInstanceOf(StartupStepError);
    expect(err.step).toBe("bootstrap admin");
    expect(err.cause).toBe(cause);
  });
});

describe("M8: order and fail-fast", () => {
  function recording() {
    const order: string[] = [];
    const s = fakeSeeders();
    const steps = {
      ...s,
      migrateLegacyRoles: jest.fn(async () => {}),
      migrateAssigneeTypes: jest.fn(async () => {}),
      deactivateLegacyApiKeys: jest.fn(async () => {}),
    };
    for (const [name, fn] of Object.entries(steps)) {
      (fn as jest.Mock).mockImplementation(async () => {
        order.push(name);
      });
    }
    return { order, steps };
  }

  it("demo-login deactivation runs first, then the fix-ups, the system users, templates and the admin", async () => {
    const { order, steps } = recording();
    await runSeeders({ NODE_ENV: "production" }, steps as unknown as SeederSet);
    expect(order).toEqual([
      "deactivateDemoAccounts",
      "migrateLegacyRoles",
      "migrateAssigneeTypes",
      "deactivateLegacyApiKeys",
      "systemUser",
      "aiSystemUser",
      "emailTemplates",
      "bootstrapAdmin",
    ]);
  });

  for (const [step, label] of [
    ["deactivateDemoAccounts", "demo account deactivation"],
    ["migrateLegacyRoles", "legacy role fix-up"],
    ["deactivateLegacyApiKeys", "legacy API key fix-up"],
    ["aiSystemUser", "AI system user"],
  ] as const) {
    it(`a failing security step (${step}) stops startup with one line naming it; nothing after it runs`, async () => {
      const { order, steps } = recording();
      (steps[step] as jest.Mock).mockImplementation(async () => {
        order.push(step);
        throw Object.assign(new Error("connection to postgres://u:secret@db failed"), { code: "ECONNREFUSED" });
      });
      const err = await runSeeders({}, steps as unknown as SeederSet).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StartupStepError);
      const line = startupFailureLine(err);
      expect(line).toBe(`Startup refused: required step "${label}" failed [Error ECONNREFUSED]`);
      expect(line).not.toContain("secret");
      expect(line).not.toContain("\n");
      expect(order[order.length - 1]).toBe(step);
      expect(order).not.toContain("bootstrapAdmin");
    });
  }

  it("the default email templates are best effort: a failure is one logged line and startup continues", async () => {
    const { order, steps } = recording();
    (steps.emailTemplates as jest.Mock).mockImplementation(async () => {
      throw new Error("template table locked");
    });
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await runSeeders({}, steps as unknown as SeederSet);
    expect(order).toContain("bootstrapAdmin");
    expect(errSpy).toHaveBeenCalledWith('Startup step "default email templates" failed; continuing without it [Error]');
    errSpy.mockRestore();
  });

  it("anything else thrown while seeding is also one line, by type only", () => {
    expect(startupFailureLine(Object.assign(new TypeError("boom secret"), { code: 42 }))).toBe(
      "Startup refused: seeding failed [TypeError 42]"
    );
  });
});

describe("leftover demo logins", () => {
  it("are deactivated before the bootstrap admin check, with the env", async () => {
    const order: string[] = [];
    const s = fakeSeeders();
    s.deactivateDemoAccounts.mockImplementation(async () => {
      order.push("deactivate");
      return [];
    });
    s.bootstrapAdmin.mockImplementation(async () => {
      order.push("bootstrap");
    });
    const env = { NODE_ENV: "production" };
    await runSeeders(env, asSet(s));
    expect(order).toEqual(["deactivate", "bootstrap"]);
    expect(s.deactivateDemoAccounts).toHaveBeenCalledWith(env);
  });
});
