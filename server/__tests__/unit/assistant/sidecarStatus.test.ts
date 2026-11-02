import { createSidecarHistoryStatus } from "../../../assistant/sidecarStatus";

const ready = (history: unknown, extra: Record<string, unknown> = {}, status = 200) =>
  new Response(JSON.stringify({ checks: { history }, ...extra }), { status });

function probe(responses: Array<Response | Error>, start = 0) {
  let now = start;
  const status = createSidecarHistoryStatus("http://agents:4111", {
    now: () => now,
    fetch: async () => {
      const next = responses.shift() ?? new Error("no more");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { status, advance: (ms: number) => (now += ms) };
}

describe("sidecar history status", () => {
  it("history ok is on, with its retention; off is off; both are definitive", async () => {
    expect(await probe([ready("ok", { historyRetentionDays: 14 })]).status()).toEqual({ state: "on", memory: true, retentionDays: 14 });
    expect(await probe([ready("off")]).status()).toEqual({ state: "off", memory: false, retentionDays: null });
  });

  it("the history check decides, not the overall status: a 503 from an MCP blip with history ok is still on", async () => {
    expect((await probe([ready("ok", {}, 503)]).status()).state).toBe("on");
  });

  it("anything else is unknown, and keeps the last definitive answer for how runs are built", async () => {
    const { status, advance } = probe([ready("ok"), new TypeError("fetch failed"), ready("unreachable", {}, 503), ready("off")]);
    expect(await status()).toMatchObject({ state: "on", memory: true });
    advance(61_000);
    expect(await status()).toMatchObject({ state: "unknown", memory: true, retentionDays: null });
    advance(11_000);
    expect(await status()).toMatchObject({ state: "unknown", memory: true });
    advance(11_000);
    expect(await status()).toMatchObject({ state: "off", memory: false });
  });

  it("before any definitive answer, memory is unknown (null)", async () => {
    expect(await probe([new TypeError("down")]).status()).toEqual({ state: "unknown", memory: null, retentionDays: null });
    expect(await probe([new Response("not json", { status: 502 })]).status()).toMatchObject({ state: "unknown", memory: null });
  });

  it("caches a definitive answer for a minute and an unknown one for 10 s; one probe at a time", async () => {
    const calls: number[] = [];
    let now = 0;
    const status = createSidecarHistoryStatus("http://agents:4111", {
      now: () => now,
      fetch: async () => {
        calls.push(now);
        return ready("ok");
      },
    });
    await Promise.all([status(), status(), status()]);
    expect(calls).toHaveLength(1);
    now = 59_000;
    await status();
    expect(calls).toHaveLength(1);
    now = 61_000;
    await status();
    expect(calls).toHaveLength(2);
  });
});
