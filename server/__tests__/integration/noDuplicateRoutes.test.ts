/**
 * Express serves the FIRST handler registered for a method + path. A second
 * registration is dead code that silently drifts from the served copy (it once
 * hid a fix), so the real application may never register the same method + path
 * twice. Builds the real app with the production registerRoutes.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://test:test@localhost:55433/ticketflow_test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "unit-duplicate-route-secret";

import express from "express";

type Layer = {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: Layer[] };
};

function collect(stack: Layer[], out: string[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        for (const m of Object.keys(layer.route.methods)) {
          out.push(`${m.toUpperCase()} ${p}`);
        }
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      collect(layer.handle.stack, out);
    }
  }
}

describe("route table", () => {
  it("registers no method + path twice", async () => {
    const { registerRoutes } = await import("../../routes/index");
    const { closeAuth } = await import("../../services/auth");
    const { pool } = await import("../../storage/db");

    const app = express();
    const realSetInterval = global.setInterval;
    global.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const timer = realSetInterval(...args);
      timer.unref?.();
      return timer;
    }) as typeof setInterval;
    let server;
    try {
      server = await registerRoutes(app);
    } finally {
      global.setInterval = realSetInterval;
    }

    const registered: string[] = [];
    collect((app as any)._router.stack, registered);
    server.close();
    await closeAuth();
    await pool.end();

    expect(registered.length).toBeGreaterThan(100);
    const seen = new Map<string, number>();
    for (const r of registered) seen.set(r, (seen.get(r) ?? 0) + 1);
    const duplicates = Array.from(seen).filter(([, n]) => n > 1).map(([r, n]) => `${r} x${n}`);
    expect(duplicates).toEqual([]);
  });
});
