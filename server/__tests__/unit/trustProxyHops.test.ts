import { parseTrustProxyHops } from "../../env";

describe("R49: parseTrustProxyHops", () => {
  const lines = () => {
    const out: string[] = [];
    return { out, warn: (line: string) => void out.push(line) };
  };

  it("unset (or blank) is 1, silently", () => {
    const l = lines();
    expect(parseTrustProxyHops(undefined, l.warn)).toBe(1);
    expect(parseTrustProxyHops("", l.warn)).toBe(1);
    expect(parseTrustProxyHops("  ", l.warn)).toBe(1);
    expect(l.out).toEqual([]);
  });

  it("reads an integer of 0 or more", () => {
    const l = lines();
    expect(parseTrustProxyHops("2", l.warn)).toBe(2);
    expect(parseTrustProxyHops("0", l.warn)).toBe(0);
    expect(parseTrustProxyHops(" 3 ", l.warn)).toBe(3);
    expect(l.out).toEqual([]);
  });

  it.each(["-1", "x", "1.5", "2 hops", "1e1", "NaN", "99999999999999999999"])(
    "%j gives 1 and logs exactly one line",
    (raw) => {
      const l = lines();
      expect(parseTrustProxyHops(raw, l.warn)).toBe(1);
      expect(l.out).toHaveLength(1);
      expect(l.out[0]).toContain("TRUST_PROXY_HOPS");
    }
  );

  it("reads process.env by default", () => {
    const saved = process.env.TRUST_PROXY_HOPS;
    try {
      process.env.TRUST_PROXY_HOPS = "2";
      expect(parseTrustProxyHops()).toBe(2);
      delete process.env.TRUST_PROXY_HOPS;
      expect(parseTrustProxyHops()).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = saved;
    }
  });
});
