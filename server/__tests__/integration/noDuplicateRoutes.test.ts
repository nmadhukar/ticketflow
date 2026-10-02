/**
 * Express serves the FIRST handler registered for a method + path. A second
 * registration is dead code that silently drifts from the served copy (it once
 * hid a fix), so the real application may never register the same method + path
 * twice. Walks the router stack of the real app built by createTestApp().
 */
import { createTestApp } from "./helpers/testApp";

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
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("registers no method + path twice", () => {
    const registered: string[] = [];
    collect((ctx.app as any)._router.stack, registered);

    // Guard against an empty walk passing vacuously.
    expect(registered.length).toBeGreaterThan(100);
    const seen = new Map<string, number>();
    for (const r of registered) seen.set(r, (seen.get(r) ?? 0) + 1);
    const duplicates = Array.from(seen)
      .filter(([, n]) => n > 1)
      .map(([r, n]) => `${r} x${n}`);
    expect(duplicates).toEqual([]);
  });
});
