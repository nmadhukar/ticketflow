import { createSidecarHistoryStatus } from "../../../assistant/sidecarStatus";

const ready = (history: string, extra: Record<string, unknown> = {}, status = 200) =>
  new Response(JSON.stringify({ status: status === 200 ? "ready" : "not_ready", checks: { history }, ...extra }), { status });

describe("sidecar history status", () => {
  it("is on only when the sidecar reports history ok, with its retention", async () => {
    expect(await createSidecarHistoryStatus("http://agents:4111", { fetch: async () => ready("ok", { historyRetentionDays: 14 }) })()).toEqual({ on: true, retentionDays: 14 });
    for (const history of ["off", "unreachable"]) {
      expect(await createSidecarHistoryStatus("http://agents:4111", { fetch: async () => ready(history) })()).toEqual({ on: false, retentionDays: null });
    }
    expect(await createSidecarHistoryStatus("http://agents:4111", { fetch: async () => ready("ok", {}, 503) })()).toEqual({ on: false, retentionDays: null });
    const down = createSidecarHistoryStatus("http://agents:4111", { fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(await down()).toEqual({ on: false, retentionDays: null });
  });

  it("asks once per minute, and sooner again after a failure", async () => {
    let now = 0;
    let calls = 0;
    let fail = false;
    const status = createSidecarHistoryStatus("http://agents:4111", {
      now: () => now,
      fetch: async () => {
        calls++;
        if (fail) throw new Error("down");
        return ready("ok");
      },
    });
    await Promise.all([status(), status(), status()]);
    expect(calls).toBe(1);
    now = 59_000;
    await status();
    expect(calls).toBe(1);
    now = 61_000;
    fail = true;
    expect((await status()).on).toBe(false);
    expect(calls).toBe(2);
    now = 72_000;
    fail = false;
    expect((await status()).on).toBe(true);
    expect(calls).toBe(3);
  });
});
