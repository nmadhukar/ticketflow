import {
  BEARER_FAILURES_MAX,
  bearerFailureEntryCount,
  bearerRetryAfterSeconds,
  recordBearerFailure,
} from "../../security/rateLimiting";

describe("bearer failure table", () => {
  const ipOf = (n: number) => ({ ip: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}` });

  it("never holds more than BEARER_FAILURES_MAX addresses, however many distinct ones fail", () => {
    for (let i = 0; i < BEARER_FAILURES_MAX + 500; i++) recordBearerFailure(ipOf(i));
    expect(bearerFailureEntryCount()).toBeLessThanOrEqual(BEARER_FAILURES_MAX);
  });

  it("the newest address is still counted and throttled after the cap was hit", () => {
    const newest = ipOf(BEARER_FAILURES_MAX + 1000);
    for (let i = 0; i < 10; i++) recordBearerFailure(newest);
    expect(bearerRetryAfterSeconds(newest)).toBeGreaterThan(0);
    expect(bearerFailureEntryCount()).toBeLessThanOrEqual(BEARER_FAILURES_MAX);
  });
});
