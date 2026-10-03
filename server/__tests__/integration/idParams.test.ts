import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";

/**
 * Every parameterised route in server/routes/{index,teams}.ts. Numeric params
 * (id, taskId, teamId, assignmentId) must be rejected with 400 invalid_id before
 * any handler runs. String params (userId is a varchar, sessionId, token, name,
 * adminId, type, referenceId) are NOT validated as numbers.
 * Keep in sync with: grep -n '"/api[^"]*:[a-zA-Z]' server/routes/*.ts
 */
const ROUTES: Array<[string, string]> = [
  ["delete", "/api/user/sessions/:sessionId"],
  ["get", "/api/tasks/:id"],
  ["get", "/api/tickets/:id/meta"],
  ["patch", "/api/tasks/:id"],
  ["delete", "/api/tasks/:id"],
  ["get", "/api/tasks/:id/comments"],
  ["post", "/api/tasks/:id/comments"],
  ["patch", "/api/admin/users/:userId"],
  ["post", "/api/admin/users/:userId/toggle-status"],
  ["post", "/api/admin/users/:userId/approve"],
  ["post", "/api/admin/users/:userId/assign-team"],
  ["delete", "/api/admin/users/:userId/remove-team/:teamId"],
  ["post", "/api/admin/users/:userId/reset-password"],
  ["get", "/api/tasks/:id/attachments"],
  ["post", "/api/tasks/:id/attachments"],
  ["get", "/api/attachments/:id/download"],
  ["delete", "/api/attachments/:id"],
  ["delete", "/api/api-keys/:id"],
  ["put", "/api/email-templates/:name"],
  ["patch", "/api/notifications/:id/read"],
  ["get", "/api/help/:id"],
  ["put", "/api/admin/help/:id"],
  ["delete", "/api/admin/help/:id"],
  ["get", "/api/guides/:id"],
  ["put", "/api/admin/guide-categories/:id"],
  ["delete", "/api/admin/guide-categories/:id"],
  ["put", "/api/admin/guides/:id"],
  ["delete", "/api/admin/guides/:id"],
  ["get", "/api/chat/:sessionId"],
  ["get", "/api/ai/chat/history/:sessionId"],
  ["get", "/api/company-policies/:id"],
  ["put", "/api/admin/company-policies/:id"],
  ["delete", "/api/admin/company-policies/:id"],
  ["post", "/api/admin/company-policies/:id/toggle"],
  ["get", "/api/company-policies/:id/download"],
  ["delete", "/api/admin/invitations/:id"],
  ["post", "/api/admin/invitations/:id/resend"],
  ["get", "/api/departments/:id"],
  ["put", "/api/admin/departments/:id"],
  ["delete", "/api/admin/departments/:id"],
  ["get", "/api/departments/:id/teams"],
  ["get", "/api/departments/:id/stats"],
  ["get", "/api/invitations/:token"],
  ["post", "/api/invitations/:token/accept"],
  ["get", "/api/tasks/:id/auto-response"],
  ["post", "/api/tasks/:id/auto-response/generate"],
  ["post", "/api/tasks/:id/auto-response/feedback"],
  ["put", "/api/admin/knowledge/:id"],
  ["delete", "/api/admin/knowledge/:id"],
  ["patch", "/api/admin/knowledge/:id/publish"],
  ["post", "/api/knowledge/:id/feedback"],
  ["put", "/api/admin/escalation-rules/:id"],
  ["delete", "/api/admin/escalation-rules/:id"],
  ["get", "/api/ai-feedback/:type/:referenceId"],
  ["post", "/api/tasks/:id/add-to-learning"],
  ["get", "/api/admin/knowledge/:id"],
  ["patch", "/api/admin/knowledge/:id/unpublish"],
  ["patch", "/api/admin/knowledge/:id/archive"],
  ["patch", "/api/admin/knowledge/:id/unarchive"],
  ["post", "/api/knowledge/articles/:id/view"],
  ["post", "/api/knowledge/:id/track-usage"],
  ["post", "/api/knowledge/:id/rate"],
  ["get", "/api/teams/:id"],
  ["get", "/api/teams/:id/members"],
  ["get", "/api/teams/:id/admins"],
  ["post", "/api/teams/:id/admins"],
  ["delete", "/api/teams/:id/admins/:adminId"],
  ["get", "/api/teams/:id/permissions"],
  ["get", "/api/teams/:id/tasks"],
  ["get", "/api/teams/:id/tasks/:taskId/assignments"],
  ["post", "/api/teams/:id/tasks/:taskId/assignments"],
  ["patch", "/api/teams/:id/tasks/:taskId/assignments/:assignmentId"],
  ["delete", "/api/teams/:id/tasks/:taskId/assignments/:assignmentId"],
  ["patch", "/api/teams/:teamId/members/:userId"],
];

const NUMERIC = ["id", "taskId", "teamId", "assignmentId"];
const BAD = ["abc", "-1", "0", "1.5"];

function fill(path: string, bad: string | null, target: string | null) {
  return path.replace(/:([a-zA-Z]+)/g, (_m, name: string) =>
    name === target && bad !== null ? encodeURIComponent(bad) : NUMERIC.includes(name) ? "1" : "x",
  );
}

describe("numeric id params", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let agent: Awaited<ReturnType<typeof loginAs>>;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx.close(); });
  beforeEach(async () => {
    await resetDb();
    agent = await loginAs(ctx.app, await createUser({ role: "admin" }));
  });

  it("covers a non-trivial number of routes", () => {
    expect(ROUTES.length).toBeGreaterThan(60);
  });

  const cases: Array<[string, string, string, string]> = [];
  for (const [method, path] of ROUTES) {
    for (const name of NUMERIC) {
      if (!path.includes(":" + name)) continue;
      for (const bad of BAD) cases.push([method, path, name, bad]);
    }
  }

  it.each(cases)("%s %s with %s=%s -> 400 invalid_id", async (method, path, name, bad) => {
    const url = fill(path, bad, name);
    const res = await (agent as any)[method](url).send({});
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.error).toBe("invalid_id");
    expect(typeof res.body.message).toBe("string");
  });

  it("does not apply the numeric check to string params", async () => {
    const res = await agent.delete("/api/user/sessions/not-a-number");
    expect(res.body.error).not.toBe("invalid_id");
    expect(res.status).toBeLessThan(500);
    // A user id that names nobody is the user's own 404, not a numeric-format 400.
    const res2 = await agent.patch("/api/admin/users/abc").send({ firstName: "x" });
    expect(res2.status).toBe(404);
    expect(res2.body.error).toBe("user_not_found");
  });

  const STRING_PARAMS = ["userId", "sessionId", "token", "name", "adminId", "type", "referenceId"];
  const stringCases: Array<[string, string, string]> = [];
  for (const [method, path] of ROUTES) {
    // /api/ai-feedback/:type/:referenceId validates both itself (a ticket id and a closed type set).
    if (path.startsWith("/api/ai-feedback/")) continue;
    for (const name of STRING_PARAMS) if (path.includes(":" + name)) stringCases.push([method, path, name]);
  }

  it.each(stringCases)("%s %s with a non-numeric %s is never answered invalid_id", async (method, path, name) => {
    const res = await (agent as any)[method](fill(path, "not-a-number", name)).send({});
    expect(res.body.error).not.toBe("invalid_id");
    expect(res.status).not.toBe(500);
  });
});
