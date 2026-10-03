import { mapLimit } from "../../utils/concurrency";

describe("mapLimit", () => {
  it("never runs more than `limit` at once, runs them all, and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(peak).toBe(3);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  it("one rejection does not stop the others", async () => {
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(out.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("handles an empty list and a nonsense limit", async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
    const out = await mapLimit([1, 2], 0, async (n) => n);
    expect(out).toHaveLength(2);
  });
});
