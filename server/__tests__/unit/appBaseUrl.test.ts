import { jest } from "@jest/globals";
import { appBaseUrlProblem, configuredBaseUrl, publicBaseUrl } from "../../utils/appBaseUrl";
import { assertStartupConfig, startupConfigProblems } from "../../startup/config";

/** A request whose Host header an attacker chose. */
const evilReq = (protocol = "https") => ({
  protocol,
  get: (name: string) => (name.toLowerCase() === "host" ? "evil.example" : undefined),
});

describe("R34: outbound links come from APP_BASE_URL", () => {
  it("uses APP_BASE_URL (without trailing slashes) whatever the Host header says, in every environment", () => {
    for (const NODE_ENV of ["production", "development", "test"]) {
      const env = { NODE_ENV, APP_BASE_URL: " https://tickets.example.com// " };
      expect(publicBaseUrl(evilReq() as never, env)).toBe("https://tickets.example.com");
    }
  });

  it("production never falls back to the request", () => {
    expect(publicBaseUrl(evilReq() as never, { NODE_ENV: "production" })).toBeNull();
    expect(publicBaseUrl(evilReq() as never, { NODE_ENV: "production", APP_BASE_URL: "javascript:alert(1)" })).toBeNull();
  });

  it("development and test fall back to the request's own origin; no request means no link", () => {
    expect(publicBaseUrl(evilReq("http") as never, { NODE_ENV: "development" })).toBe("http://evil.example");
    expect(publicBaseUrl(evilReq() as never, { NODE_ENV: "test" })).toBe("https://evil.example");
    expect(publicBaseUrl(undefined, { NODE_ENV: "test" })).toBeNull();
    expect(publicBaseUrl(undefined, { NODE_ENV: "test", APP_BASE_URL: "https://a.example" })).toBe("https://a.example");
  });

  it("rejects values that are not a plain http(s) origin", () => {
    for (const bad of ["tickets.example.com", "ftp://x.example", "https://u:p@x.example", "https://x.example/?a=1", "https://x.example/#f"]) {
      expect({ bad, problem: appBaseUrlProblem({ APP_BASE_URL: bad }) }).toEqual({ bad, problem: expect.any(String) });
      expect(configuredBaseUrl({ APP_BASE_URL: bad })).toBeNull();
    }
    expect(appBaseUrlProblem({ APP_BASE_URL: "https://x.example/helpdesk/" })).toBeNull();
    expect(configuredBaseUrl({ APP_BASE_URL: "https://x.example/helpdesk/" })).toBe("https://x.example/helpdesk");
  });
});

const GOOD_SECRETS = {
  SESSION_SECRET: "k3Jx9mQ2vR8sT5wY1zB7nC4dF6gH0aLp",
  JWT_SECRET: "Zp8Qw3Er7Ty1Ui5Op9As2Df6Gh0Jk4Lx",
};

describe("startup configuration check", () => {
  it("production without APP_BASE_URL refuses to boot: one line, exit 1", () => {
    const lines: string[] = [];
    const exit = jest.fn();
    expect(assertStartupConfig({ env: { NODE_ENV: "production" }, log: (l) => lines.push(l), exit })).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Startup refused: APP_BASE_URL must be set in production/);
  });

  it("production with a valid APP_BASE_URL, and development or test without one, start", () => {
    const exit = jest.fn();
    for (const env of [
      { NODE_ENV: "production", APP_BASE_URL: "https://tickets.example.com", ...GOOD_SECRETS },
      { NODE_ENV: "development" },
      { NODE_ENV: "test" },
      {},
    ]) {
      expect(startupConfigProblems(env)).toEqual([]);
      expect(assertStartupConfig({ env, log: () => undefined, exit })).toBe(true);
    }
    expect(exit).not.toHaveBeenCalled();
  });

  it("production without SESSION_SECRET or JWT_SECRET, or with a placeholder one, refuses to boot before any seeder runs", () => {
    const base = { NODE_ENV: "production", APP_BASE_URL: "https://tickets.example.com" };
    expect(startupConfigProblems({ ...base, ...GOOD_SECRETS })).toEqual([]);
    expect(startupConfigProblems({ ...base, JWT_SECRET: GOOD_SECRETS.JWT_SECRET })).toEqual([
      expect.stringMatching(/^SESSION_SECRET must be set/),
    ]);
    for (const placeholder of [
      "your-32-character-random-session-secret-here",
      "your-super-secret-session-key-change-this-in-production",
      "dev-only-session-secret-not-for-production",
      "changeme",
    ]) {
      expect(startupConfigProblems({ ...base, ...GOOD_SECRETS, SESSION_SECRET: placeholder })).toEqual([
        expect.stringMatching(/^SESSION_SECRET is still a placeholder/),
      ]);
    }
    // Development is untouched: the development fallback applies.
    expect(startupConfigProblems({ NODE_ENV: "development", SESSION_SECRET: "your-secret" })).toEqual([]);
  });

  it("a malformed APP_BASE_URL refuses to boot in any environment", () => {
    for (const NODE_ENV of ["production", "development"]) {
      const exit = jest.fn();
      expect(assertStartupConfig({ env: { NODE_ENV, APP_BASE_URL: "not a url" }, log: () => undefined, exit })).toBe(false);
      expect(exit).toHaveBeenCalledWith(1);
    }
  });
});
