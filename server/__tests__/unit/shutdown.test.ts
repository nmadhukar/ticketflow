import { createShutdown } from "../../shutdown";

/**
 * With `exec node` as PID 1 (R66) node itself receives `docker stop`'s SIGTERM, and a PID-1 process
 * with no handler ignores it: the container then waits out the grace period and is killed. The
 * handler closes the sockets, the HTTP server, the session stores and the pool, in that order, and
 * exits 0; a timer exits 1 if any step hangs.
 */
function fakes(over: Partial<Record<"closeRealtime" | "closeAuth" | "closePool" | "closeServer", () => Promise<void>>> = {}) {
  const order: string[] = [];
  const logs: string[] = [];
  const exits: number[] = [];
  const step = (name: string, fn?: () => Promise<void>) => async () => {
    order.push(name);
    if (fn) await fn();
  };
  const deps = {
    server: {
      close: (cb: (err?: Error) => void) => {
        order.push("server.close");
        void (over.closeServer ? over.closeServer() : Promise.resolve()).then(() => cb(), (e) => cb(e));
      },
      closeIdleConnections: () => void order.push("closeIdleConnections"),
    },
    closeRealtime: step("closeRealtime", over.closeRealtime),
    closeAuth: step("closeAuth", over.closeAuth),
    closePool: step("closePool", over.closePool),
    exit: (code: number) => void exits.push(code),
    log: (line: string) => void logs.push(line),
  };
  return { deps, order, logs, exits };
}

describe("graceful shutdown", () => {
  it("closes sockets, the HTTP server, the session stores and the pool in that order, then exits 0", async () => {
    const f = fakes();
    await createShutdown({ ...f.deps, timeoutMs: 50 })("SIGTERM");
    expect(f.order).toEqual(["closeRealtime", "server.close", "closeIdleConnections", "closeAuth", "closePool"]);
    expect(f.exits).toEqual([0]);
    expect(f.logs.join("\n")).toContain("SIGTERM");
  });

  it("runs once: a second signal while shutting down does nothing", async () => {
    const f = fakes();
    const shutdown = createShutdown({ ...f.deps, timeoutMs: 50 });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(f.order.filter((s) => s === "closePool")).toHaveLength(1);
    expect(f.exits).toEqual([0]);
  });

  it("a failing step is logged by type only, the later steps still run, and the exit code is 1", async () => {
    const f = fakes({
      closeAuth: async () => {
        throw new TypeError("secret connection text");
      },
    });
    await createShutdown({ ...f.deps, timeoutMs: 50 })("SIGTERM");
    expect(f.order).toContain("closePool");
    expect(f.exits).toEqual([1]);
    const text = f.logs.join("\n");
    expect(text).toContain("TypeError");
    expect(text).not.toContain("secret connection text");
  });

  it("a hung step is cut off by the hard timer: exit 1 after timeoutMs, never later than that", async () => {
    jest.useFakeTimers();
    try {
      const f = fakes({ closeServer: () => new Promise<void>(() => undefined) });
      void createShutdown({ ...f.deps, timeoutMs: 10_000 })("SIGTERM");
      await jest.advanceTimersByTimeAsync(9_999);
      expect(f.exits).toEqual([]);
      await jest.advanceTimersByTimeAsync(2);
      expect(f.exits).toEqual([1]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("the hard timer does not keep the process alive on its own (unref)", async () => {
    const unref = jest.fn();
    const spy = jest.spyOn(global, "setTimeout").mockImplementation((() => ({ unref })) as never);
    try {
      const f = fakes();
      await createShutdown({ ...f.deps })("SIGTERM");
      expect(unref).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
