import { jest } from "@jest/globals";
import { requireSecret } from "../../security/secrets";

describe("requireSecret", () => {
  it("throws in production when the secret is unset or blank", () => {
    expect(() =>
      requireSecret("SESSION_SECRET", { env: { NODE_ENV: "production" }, devFallback: "dev" })
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      requireSecret("JWT_SECRET", { env: { NODE_ENV: "production", JWT_SECRET: "  " }, devFallback: "dev" })
    ).toThrow(/JWT_SECRET/);
  });

  it("returns the configured value in production", () => {
    expect(
      requireSecret("JWT_SECRET", {
        env: { NODE_ENV: "production", JWT_SECRET: "s3cr3t-value" },
        devFallback: "dev",
      })
    ).toBe("s3cr3t-value");
  });

  it("outside production falls back and warns without printing any secret", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const value = requireSecret("SESSION_SECRET", {
      env: { NODE_ENV: "development" },
      devFallback: "the-dev-fallback-literal",
    });
    expect(value).toBe("the-dev-fallback-literal");
    expect(warn).toHaveBeenCalled();
    const text = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text).toMatch(/SESSION_SECRET/);
    expect(text).not.toContain("the-dev-fallback-literal");
    warn.mockRestore();
  });
});

describe("secrets fail closed at startup", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  it("the JWT module refuses to load in production without JWT_SECRET", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous load
      expect(() => require("../../security/jwt")).toThrow(/JWT_SECRET/);
    });
  });

  it("the JWT module loads in production with JWT_SECRET set", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "configured-secret";
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous load
      expect(() => require("../../security/jwt")).not.toThrow();
    });
  });
});
