import fs from "fs";
import path from "path";
import type { Express } from "express";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";

/**
 * P3: the documented ticket-endpoint contract matches the running API. The Postman
 * collection and API_ENDPOINTS_REFERENCE.md are read from the repository and replayed
 * against the real application: every documented method + path must be a registered route,
 * and the collection's own create, get, list, update, comment and delete requests (their
 * bodies and queries, as written) must get the statuses the reference documents.
 */
const ROOT = path.resolve(__dirname, "../../..");
const collection = JSON.parse(fs.readFileSync(path.join(ROOT, "TicketFlow_API_Collection.postman_collection.json"), "utf8"));
const reference = fs.readFileSync(path.join(ROOT, "API_ENDPOINTS_REFERENCE.md"), "utf8");

type PostmanItem = { name: string; item?: PostmanItem[]; request?: { method: string; url: { raw: string }; body?: { raw?: string } } };
function flatten(items: PostmanItem[], out: PostmanItem[] = []): PostmanItem[] {
  for (const i of items) {
    if (i.item) flatten(i.item, out);
    else out.push(i);
  }
  return out;
}
const requests = flatten(collection.item);
const byName = (name: string) => {
  const found = requests.find((r) => r.name === name);
  if (!found?.request) throw new Error(`Postman request "${name}" not found`);
  return found.request;
};

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; name?: string; handle?: { stack?: Layer[] } };
function registeredRoutes(app: Express): Array<{ method: string; segments: string[] }> {
  const out: Array<{ method: string; segments: string[] }> = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), segments: p.split("/") });
      } else if (layer.name === "router" && layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk((app as any)._router.stack);
  return out;
}

/** "/api/tasks/{{taskId}}/x?y=1", ":id" and "<id>" all become a parameter marker. */
function documentedSegments(rawPath: string): string[] {
  return rawPath
    .replace(/^\{\{baseUrl\}\}/, "")
    .replace(/[?[].*$/, "")
    .split("/")
    .map((s) => (/^(\{\{.*\}\}|:.+|<.+>)$/.test(s) ? ":param" : s));
}
function isRegistered(routes: ReturnType<typeof registeredRoutes>, method: string, documented: string[]): boolean {
  // Two documented routes are not in the router stack the walk reads: the MCP endpoint is a
  // router mounted with app.use (probed over HTTP below), and the health probe is added by
  // server/index.ts after registerRoutes (checked in its source below).
  if (method === "POST" && documented.join("/") === "/api/mcp") return true;
  if (method === "GET" && documented.join("/") === "/api/security/health") return true;
  return routes.some(
    (r) =>
      r.method === method &&
      r.segments.length === documented.length &&
      r.segments.every((seg, i) => (seg.startsWith(":") ? true : seg === documented[i]))
  );
}

describe("documented contract vs the running API (P3)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  describe("every documented route exists", () => {
    it("every request in the Postman collection is a registered method + path", () => {
      const routes = registeredRoutes(ctx.app);
      expect(routes.length).toBeGreaterThan(100);
      expect(requests.length).toBeGreaterThan(50); // the walk found the collection
      const missing = requests
        .map((r) => ({ name: r.name, method: r.request!.method.toUpperCase(), segs: documentedSegments(r.request!.url.raw) }))
        .filter((r) => !isRegistered(routes, r.method, r.segs))
        .map((r) => `${r.method} ${r.segs.join("/")} (${r.name})`);
      expect(missing).toEqual([]);
    });

    it("the two routes the walk cannot see are real: POST /api/mcp answers 401 without a key, and GET /api/security/health answers 200", async () => {
      const request = (await import("supertest")).default;
      const mcp = await request(ctx.app).post("/api/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(mcp.status).toBe(401); // a mounted route that needs credentials, not a 404
      const health = await request(ctx.app).get("/api/security/health"); // registered by createTestApp, as in server/index.ts
      expect(health.status).toBe(200);
    });

    it("every METHOD /api/path in API_ENDPOINTS_REFERENCE.md is a registered method + path", () => {
      const routes = registeredRoutes(ctx.app);
      const found = new Set<string>();
      const pattern = /(?:^###\s+|`)(GET|POST|PUT|PATCH|DELETE) (\/api\/[A-Za-z0-9_\-/:<>[\]?=.{}]*)/gm;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(reference)) !== null) found.add(`${m[1]} ${m[2]}`);
      expect(found.size).toBeGreaterThan(30); // the scan found the reference's routes
      const missing = Array.from(found).filter((entry) => {
        const [method, p] = entry.split(" ");
        return !isRegistered(routes, method, documentedSegments(p));
      });
      expect(missing).toEqual([]);
    });
  });

  describe("the collection's ticket requests, replayed as written", () => {
    type Agent = Awaited<ReturnType<typeof loginAs>>;
    const fill = (text: string, vars: Record<string, string | number>) =>
      text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? `{{${name}}}`));
    async function replay(agent: Agent, name: string, vars: Record<string, string | number> = {}) {
      const req = byName(name);
      const url = fill(req.url.raw, vars).replace(/^\{\{baseUrl\}\}/, "");
      const method = req.method.toLowerCase() as "get" | "post" | "patch" | "delete";
      const call = agent[method](url);
      return req.body?.raw ? call.send(JSON.parse(fill(req.body.raw, vars))) : call;
    }

    it("create, get, list, update, close, reopen, comment, history, delete give the documented statuses and shapes", async () => {
      const admin = await createUser({ role: "admin" });
      const agent = await loginAs(ctx.app, admin);

      // POST /api/tasks: 201, status open, createdBy the caller, number PREFIX-YYYY-NNNN, strict body accepted as written.
      const created = await replay(agent, "Create Task");
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ title: "Database connection timeout", status: "open", priority: "high", category: "support", createdBy: admin.id });
      expect(created.body.ticketNumber).toMatch(/^[A-Za-z0-9]{1,6}-\d{4}-\d{4,}$/);
      expect(created.body.tags).toEqual(["database"]);
      const vars = { taskId: created.body.id as number, userId: admin.id };

      // GET /api/tasks/:id
      const got = await replay(agent, "Get Task by ID", vars);
      expect(got.status).toBe(200);
      expect(got.body.id).toBe(vars.taskId);

      // GET /api/tasks: a bare array; the collection's own filtered query is valid and the plain one lists the ticket.
      const filtered = await replay(agent, "Get All Tasks", vars);
      expect(filtered.status).toBe(200);
      expect(Array.isArray(filtered.body)).toBe(true);
      const plain = await agent.get("/api/tasks");
      expect(plain.status).toBe(200);
      expect(Array.isArray(plain.body)).toBe(true);
      expect(plain.body.map((t: any) => t.id)).toContain(vars.taskId);
      const mine = await replay(agent, "Get My Tasks", vars);
      expect(mine.status).toBe(200);
      expect((await replay(agent, "Get My Group Tasks", vars)).status).toBe(200);

      // PATCH /api/tasks/:id (documented: (PUT is not a route)).
      const updated = await replay(agent, "Update Task", vars);
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ priority: "urgent", notes: "Escalated by the customer" });
      expect((await agent.put(`/api/tasks/${vars.taskId}`).send({ priority: "low" })).status).toBe(404);

      // Status workflow: close from open, reopen from closed, resolvedAt/closedAt stamped and cleared.
      const closed = await replay(agent, "Close Task (staff)", vars);
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe("closed");
      expect(closed.body.closedAt).not.toBeNull();
      const reopened = await replay(agent, "Reopen Task (staff or creating customer)", vars);
      expect(reopened.status).toBe(200);
      expect(reopened.body.status).toBe("open");
      expect(reopened.body.closedAt).toBeNull();

      // Comments: 201 with the comment, then listed oldest first.
      const commented = await replay(agent, "Add Task Comment", vars);
      expect(commented.status).toBe(201);
      expect(commented.body).toMatchObject({ content: "Found the root cause.", taskId: vars.taskId, userId: admin.id });
      const comments = await replay(agent, "Get Task Comments", vars);
      expect(comments.status).toBe(200);
      expect(comments.body.map((c: any) => c.content)).toEqual(["Found the root cause."]);

      // History: oldest first, structured entries.
      const history = await replay(agent, "Get Task History", vars);
      expect(history.status).toBe(200);
      expect(history.body[0].action).toBe("created");
      expect(history.body[0]).toEqual(expect.objectContaining({ id: expect.any(Number), taskId: vars.taskId, userId: admin.id }));

      // Meta for the create form and for this ticket.
      expect((await replay(agent, "Get Ticket Meta (create form)", vars)).status).toBe(200);
      expect((await replay(agent, "Get Ticket Meta (one ticket)", vars)).status).toBe(200);

      // DELETE /api/tasks/:id: 204 no content, then 404.
      const deleted = await replay(agent, "Delete Task", vars);
      expect(deleted.status).toBe(204);
      expect(deleted.text).toBe("");
      expect((await replay(agent, "Get Task by ID", vars)).status).toBe(404);
      expect((await replay(agent, "Delete Task", vars)).status).toBe(404);
    });

    it("the documented refusals hold: an unknown field on create is 400, a non-admin delete is 403, an invalid filter is 400", async () => {
      const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
      const agentUser = await loginAs(ctx.app, await createUser({ role: "agent" }));

      // The body is strict: server-owned fields are 400.
      const strict = await admin.post("/api/tasks").send({ ...JSON.parse(byName("Create Task").body!.raw!), status: "closed" });
      expect(strict.status).toBe(400);

      const t = await replay(admin, "Create Task");
      expect(t.status).toBe(201);
      const del = await agentUser.delete(`/api/tasks/${t.body.id}`);
      expect(del.status).toBe(403);

      for (const q of ["status=nope", "priority=nope", "limit=0", "limit=abc", "offset=-1"]) {
        const res = await admin.get(`/api/tasks?${q}`);
        expect([q, res.status, res.body.error]).toEqual([q, 400, "validation_failed"]);
      }
      expect((await admin.get("/api/tasks/abc")).status).toBe(400);
      expect((await admin.get("/api/tasks/999999")).status).toBe(404);
    });
  });
});
