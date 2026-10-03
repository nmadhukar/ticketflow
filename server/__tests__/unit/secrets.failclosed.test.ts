import { jest } from "@jest/globals";
import { randomBytes } from "crypto";
import { execFileSync } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { requireSecret, secretProblem } from "../../security/secrets";

const REPO_ROOT = join(__dirname, "../../..");

/** Tracked docs, examples, compose files and env files (git), or a directory walk when there is no .git. */
function trackedSampleFiles(): string[] {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "-z", "--", "*.md", "*.example", "*docker-compose*.yml", "*.env*"],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const files = out.split("\0").filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // no git (a source tarball, a container without .git): walk instead
  }
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".git", "dist", "coverage"].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(md|example)$|docker-compose.*\.yml$|\.env/.test(entry)) found.push(relative(REPO_ROOT, full));
    }
  };
  walk(REPO_ROOT);
  return found;
}

/**
 * Every `SESSION_SECRET=` / `JWT_SECRET=` (or `:` in YAML) sample value on a line of its own in the
 * repo's tracked docs and examples. A `${...}` reference and an empty value are not samples.
 */
function collectRepoSecretSamples(): Array<{ file: string; line: number; name: "SESSION_SECRET" | "JWT_SECRET"; value: string }> {
  const samples: Array<{ file: string; line: number; name: "SESSION_SECRET" | "JWT_SECRET"; value: string }> = [];
  for (const file of Array.from(new Set(trackedSampleFiles()))) {
    const lines = readFileSync(join(REPO_ROOT, file), "utf8").split(/\r?\n/);
    lines.forEach((text, index) => {
      const m = /^\s*(?:export\s+)?(SESSION_SECRET|JWT_SECRET)\s*[:=]\s*(.*)$/.exec(text);
      if (!m) return;
      const value = m[2].replace(/\s+#.*$/, "").trim().replace(/^["'`]|["'`]$/g, "").trim();
      if (!value || value.includes("${")) return;
      samples.push({ file, line: index + 1, name: m[1] as "SESSION_SECRET" | "JWT_SECRET", value });
    });
  }
  return samples;
}

describe("requireSecret", () => {
  it("throws in production when the secret is unset or blank", () => {
    expect(() =>
      requireSecret("SESSION_SECRET", { env: { NODE_ENV: "production" }, devFallback: "dev" })
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      requireSecret("JWT_SECRET", { env: { NODE_ENV: "production", JWT_SECRET: "  " }, devFallback: "dev" })
    ).toThrow(/JWT_SECRET/);
  });

  it("throws in production for a placeholder from the example files, without printing it", () => {
    const placeholder = "your-super-secret-session-key-change-this-in-production";
    let message = "";
    try {
      requireSecret("SESSION_SECRET", {
        env: { NODE_ENV: "production", SESSION_SECRET: placeholder },
        devFallback: "dev",
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/SESSION_SECRET is still a placeholder/);
    expect(message).not.toContain(placeholder);
    // ...but a placeholder outside production is the developer's own business.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      requireSecret("SESSION_SECRET", {
        env: { NODE_ENV: "development", SESSION_SECRET: placeholder },
        devFallback: "dev",
      })
    ).toBe(placeholder);
    warn.mockRestore();
  });

  it("returns the configured value in production", () => {
    expect(
      requireSecret("JWT_SECRET", {
        env: { NODE_ENV: "production", JWT_SECRET: "s3cr3t-value-of-at-least-32-characters" },
        devFallback: "dev",
      })
    ).toBe("s3cr3t-value-of-at-least-32-characters");
  });

  it("throws in production for a secret shorter than 32 characters", () => {
    expect(() =>
      requireSecret("JWT_SECRET", { env: { NODE_ENV: "production", JWT_SECRET: "short-but-random-x7Qp" }, devFallback: "dev" })
    ).toThrow(/JWT_SECRET is too short/);
  });

  describe("placeholder detection", () => {
    // Every SESSION_SECRET= / JWT_SECRET= sample value found in the repo's docs, env examples and plans.
    const REPO_SAMPLES = [
      "your-super-secret-session-key-change-this-in-production",
      "your-super-secret-jwt-key-change-in-production",
      "your-super-secret-session-key",
      "your-32-character-random-session-secret-here",
      "your-32-character-random-jwt-secret-here",
      "long-random-string-for-session-encryption",
      "replace-with-32b-hex",
      "ticketflow-dev-session-secret-not-for-prod",
      "dev-only-session-secret-not-for-production",
      "dev-only-jwt-secret-not-for-production",
    ];
    it("refuses every sample value in the repo, in production, whatever the case", () => {
      for (const sample of [...REPO_SAMPLES, "CHANGE_ME", "Replace-Me", "TODO", "secret", "Password", "example-key", "placeholder"]) {
        for (const value of [sample, sample.toUpperCase()]) {
          expect({ value, ok: secretProblem("SESSION_SECRET", { NODE_ENV: "production", SESSION_SECRET: value }) }).toEqual({
            value,
            ok: expect.any(String),
          });
        }
      }
    });
    it("refuses every SESSION_SECRET / JWT_SECRET sample found in the repo's tracked docs and examples (R57)", () => {
      const samples = collectRepoSecretSamples();
      // The scan itself must work: the repo's own examples are in there.
      expect(samples.length).toBeGreaterThanOrEqual(5);
      const accepted = samples
        .filter(({ name, value }) =>
          [value, value.toUpperCase()].some(
            (v) => secretProblem(name, { NODE_ENV: "production", [name]: v }) === null
          )
        )
        // The file and line only: never the value, even a sample one.
        .map(({ file, line, name }) => `${file}:${line} (${name})`);
      expect({ acceptedInProduction: accepted }).toEqual({ acceptedInProduction: [] });
    });
    it("accepts 10,000 random base64 and 10,000 random hex secrets (no false positives)", () => {
      for (let i = 0; i < 10000; i++) {
        for (const value of [randomBytes(32).toString("base64"), randomBytes(32).toString("hex")]) {
          expect({ value, problem: secretProblem("SESSION_SECRET", { NODE_ENV: "production", SESSION_SECRET: value }) }).toEqual({
            value,
            problem: null,
          });
        }
      }
    });
    it("does not read digits as word boundaries: a secret containing 'YOUr' in the middle passes", () => {
      expect(
        secretProblem("JWT_SECRET", { NODE_ENV: "production", JWT_SECRET: "Ab3dE6YOUr24xQ9pLm0sT7wZ1kC5vB8nFhJ2" })
      ).toBeNull();
    });
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
    process.env.JWT_SECRET = "k3Jx9mQ2vR8sT5wY1zB7nC4dF6gH0aLp";
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous load
      expect(() => require("../../security/jwt")).not.toThrow();
    });
  });
});
