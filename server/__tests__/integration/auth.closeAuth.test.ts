import express from "express";

// A fake session store: each `new` is recorded, and `close` is a spy. The real
// store opens its own database pool, which is exactly what closeAuth must release.
const mockStores: Array<{ close: jest.Mock }> = [];
jest.mock("connect-pg-simple", () => {
  const { Store } = jest.requireActual<typeof import("express-session")>("express-session");
  return () =>
    class FakePgStore extends Store {
      close = jest.fn(async () => undefined);
      get(_sid: string, cb: (err?: unknown, session?: null) => void) {
        cb(undefined, null);
      }
      set(_sid: string, _session: unknown, cb?: (err?: unknown) => void) {
        cb?.();
      }
      destroy(_sid: string, cb?: (err?: unknown) => void) {
        cb?.();
      }
      constructor() {
        super();
        mockStores.push(this as unknown as { close: jest.Mock });
      }
    };
});

import { setupAuth, closeAuth } from "../../services/auth";

/** R55: setupAuth tracks every store it creates and closeAuth closes all of them. */
describe("closeAuth", () => {
  beforeEach(() => {
    mockStores.length = 0;
  });

  it("closes the stores of two setupAuth calls, then forgets them", async () => {
    setupAuth(express());
    setupAuth(express());
    expect(mockStores).toHaveLength(2);
    await closeAuth();
    expect(mockStores[0].close).toHaveBeenCalledTimes(1);
    expect(mockStores[1].close).toHaveBeenCalledTimes(1);
    // closeAuth cleared its list: a second call closes nothing again.
    await closeAuth();
    expect(mockStores[0].close).toHaveBeenCalledTimes(1);
    expect(mockStores[1].close).toHaveBeenCalledTimes(1);
  });

  it("does nothing when setupAuth never ran", async () => {
    await expect(closeAuth()).resolves.toBeUndefined();
  });
});
