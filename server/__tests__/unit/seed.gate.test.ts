import { jest } from "@jest/globals";
import { runSeeders, type SeederSet } from "../../seed/runSeeders";

function fakeSeeders() {
  return {
    systemUser: jest.fn(async () => {}),
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
    s.bootstrapAdmin.mockRejectedValueOnce(new Error("no db") as never);
    await expect(runSeeders({}, asSet(s))).rejects.toThrow("no db");
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
