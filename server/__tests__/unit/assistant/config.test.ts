import {
  assistantConfigProblems,
  DEFAULT_RUN_MAX_SECONDS,
  isAssistantEnabled,
  readAssistantSecrets,
  readRetentionDays,
  readRunMaxSeconds,
} from "../../../assistant/config";
import { startupConfigProblems } from "../../../startup/config";

/** A distinct, non-placeholder secret of 34 characters per n. */
const S = (n: number) => `${n}Kq7v2Zr9Wm4Xp1Ln8Bt5Yc3Hs6Jd0Fg-${n}`;

const GOOD = {
  ASSISTANT_ENABLED: "true",
  ASSISTANT_SESSION_SECRET: S(1),
  ASSISTANT_AGENT_SECRET: S(2),
  SESSION_SECRET: S(3),
  JWT_SECRET: S(4),
};

describe("assistant config", () => {
  it("is off unless ASSISTANT_ENABLED is exactly true, and then has no problems", () => {
    for (const value of [undefined, "", "1", "TRUE", "yes"]) {
      expect(isAssistantEnabled({ ASSISTANT_ENABLED: value })).toBe(false);
      expect(assistantConfigProblems({ ASSISTANT_ENABLED: value })).toEqual([]);
    }
  });

  it("accepts a complete configuration, with or without a rotation in progress", () => {
    expect(assistantConfigProblems(GOOD)).toEqual([]);
    expect(
      assistantConfigProblems({
        ...GOOD,
        ASSISTANT_SESSION_SECRET_PREVIOUS: S(5),
        ASSISTANT_AGENT_SECRET_PREVIOUS: S(6),
      }),
    ).toEqual([]);
  });

  it("requires both secrets when enabled, in every environment", () => {
    for (const NODE_ENV of ["development", "test", "production"]) {
      expect(assistantConfigProblems({ ASSISTANT_ENABLED: "true", NODE_ENV })).toEqual([
        "ASSISTANT_SESSION_SECRET must be set when ASSISTANT_ENABLED=true.",
        "ASSISTANT_AGENT_SECRET must be set when ASSISTANT_ENABLED=true.",
      ]);
    }
  });

  it("refuses a previous secret without a current one", () => {
    const { ASSISTANT_SESSION_SECRET: _omit, ...env } = GOOD;
    expect(assistantConfigProblems({ ...env, ASSISTANT_SESSION_SECRET_PREVIOUS: S(5) })).toContain(
      "ASSISTANT_SESSION_SECRET_PREVIOUS is set without ASSISTANT_SESSION_SECRET.",
    );
  });

  it("refuses placeholder and short secrets without printing them", () => {
    const placeholder = "your-assistant-secret-change-this-in-production";
    const short = "tooShort123";
    const problems = assistantConfigProblems({ ...GOOD, ASSISTANT_SESSION_SECRET: placeholder, ASSISTANT_AGENT_SECRET_PREVIOUS: short });
    expect(problems).toEqual([
      expect.stringMatching(/^ASSISTANT_SESSION_SECRET is still a placeholder/),
      expect.stringMatching(/^ASSISTANT_AGENT_SECRET_PREVIOUS is too short/),
    ]);
    expect(problems.join(" ")).not.toContain(placeholder);
    expect(problems.join(" ")).not.toContain(short);
  });

  it("refuses an assistant secret reused anywhere else", () => {
    expect(assistantConfigProblems({ ...GOOD, ASSISTANT_AGENT_SECRET: GOOD.ASSISTANT_SESSION_SECRET })).toEqual([
      "ASSISTANT_SESSION_SECRET must differ from ASSISTANT_AGENT_SECRET.",
    ]);
    expect(assistantConfigProblems({ ...GOOD, ASSISTANT_SESSION_SECRET_PREVIOUS: GOOD.ASSISTANT_SESSION_SECRET })).toEqual([
      "ASSISTANT_SESSION_SECRET must differ from ASSISTANT_SESSION_SECRET_PREVIOUS.",
    ]);
    expect(assistantConfigProblems({ ...GOOD, ASSISTANT_AGENT_SECRET: GOOD.SESSION_SECRET })).toEqual([
      "ASSISTANT_AGENT_SECRET must differ from SESSION_SECRET.",
    ]);
    expect(assistantConfigProblems({ ...GOOD, ASSISTANT_SESSION_SECRET: GOOD.JWT_SECRET })).toEqual([
      "ASSISTANT_SESSION_SECRET must differ from JWT_SECRET.",
    ]);
  });

  it("validates ASSISTANT_RUN_MAX_SECONDS and defaults it to 15 minutes", () => {
    expect(readRunMaxSeconds({})).toBe(DEFAULT_RUN_MAX_SECONDS);
    expect(readRunMaxSeconds({ ASSISTANT_RUN_MAX_SECONDS: "600" })).toBe(600);
    for (const bad of ["59", "3601", "abc", "-5", "1.5"]) {
      expect(assistantConfigProblems({ ...GOOD, ASSISTANT_RUN_MAX_SECONDS: bad })).toEqual([
        "ASSISTANT_RUN_MAX_SECONDS must be an integer from 60 to 3600.",
      ]);
    }
  });

  it("reads the secrets current-first, and throws instead of returning a bad configuration", () => {
    expect(readAssistantSecrets({ ...GOOD, ASSISTANT_AGENT_SECRET_PREVIOUS: S(6) })).toEqual({
      session: [S(1)],
      agent: [S(2), S(6)],
    });
    expect(() => readAssistantSecrets({})).toThrow(/not enabled/);
    expect(() => readAssistantSecrets({ ASSISTANT_ENABLED: "true" })).toThrow(/ASSISTANT_SESSION_SECRET must be set/);
  });

  it("is part of the startup check", () => {
    const base = { NODE_ENV: "development", ASSISTANT_ENABLED: "true" };
    expect(startupConfigProblems(base)).toEqual([
      "ASSISTANT_SESSION_SECRET must be set when ASSISTANT_ENABLED=true.",
      "ASSISTANT_AGENT_SECRET must be set when ASSISTANT_ENABLED=true.",
    ]);
    expect(startupConfigProblems({ ...GOOD, NODE_ENV: "development" })).toEqual([]);
  });

  it("validates the usage and audit retention periods, with their defaults", () => {
    expect(readRetentionDays("ASSISTANT_USAGE_RETENTION_DAYS", {})).toBe(90);
    expect(readRetentionDays("ASSISTANT_AUDIT_RETENTION_DAYS", {})).toBe(365);
    expect(readRetentionDays("ASSISTANT_AUDIT_RETENTION_DAYS", { ASSISTANT_AUDIT_RETENTION_DAYS: "730" })).toBe(730);
    expect(assistantConfigProblems({ ...GOOD, ASSISTANT_AUDIT_RETENTION_DAYS: "29" })).toEqual(["ASSISTANT_AUDIT_RETENTION_DAYS must be an integer from 30 to 3650."]);
    expect(assistantConfigProblems({ ...GOOD, ASSISTANT_USAGE_RETENTION_DAYS: "0" })).toEqual(["ASSISTANT_USAGE_RETENTION_DAYS must be an integer from 1 to 365."]);
    expect(assistantConfigProblems({ ...GOOD, ASSISTANT_USAGE_RETENTION_DAYS: "abc" })).toHaveLength(1);
  });
});
