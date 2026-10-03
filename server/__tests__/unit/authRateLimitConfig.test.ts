import { authRateLimitMax, authRateLimitWindowMs } from "../../security/rateLimiting";

describe("auth rate limit overrides", () => {
  it("are honoured only when NODE_ENV=test", () => {
    const o = { AUTH_RATE_LIMIT_MAX: "1000", AUTH_RATE_LIMIT_WINDOW_MS: "5" };
    expect(authRateLimitMax({ ...o, NODE_ENV: "test" })).toBe(1000);
    expect(authRateLimitWindowMs({ ...o, NODE_ENV: "test" })).toBe(5);
  });
  it("are ignored in production and development: fixed at 10 per minute", () => {
    const o = { AUTH_RATE_LIMIT_MAX: "1000", AUTH_RATE_LIMIT_WINDOW_MS: "5" };
    for (const NODE_ENV of ["production", "development", undefined]) {
      expect(authRateLimitMax({ ...o, NODE_ENV })).toBe(10);
      expect(authRateLimitWindowMs({ ...o, NODE_ENV })).toBe(60000);
    }
  });
  it("default to 10 per minute", () => {
    expect(authRateLimitMax({ NODE_ENV: "test" })).toBe(10);
    expect(authRateLimitWindowMs({ NODE_ENV: "test" })).toBe(60000);
  });
});
