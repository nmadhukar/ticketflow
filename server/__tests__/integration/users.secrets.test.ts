import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import {
  createUser,
  createTeam,
  createTicketAs,
  loginAs,
} from "./helpers/fixtures";
import { findSecrets } from "./helpers/noSecrets";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { tasks, users } from "@shared/schema";
import { eq } from "drizzle-orm";

describe("users: staff only, and no secrets in any response", () => {
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

  it("forbids customers from listing users", async () => {
    const customer = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, customer);
    const denied = await agent.get("/api/users");
    expect(denied.status).toBe(403);
    // The 403 follows the error contract: a stable code, not just a status.
    expect(denied.body.error).toBe("forbidden");
    expect(typeof denied.body.message).toBe("string");
    const deniedPicker = await agent.get("/api/users?forTeamMemberSelection=true");
    expect(deniedPicker.status).toBe(403);
    expect(deniedPicker.body.error).toBe("forbidden");
  });

  it("still lets every staff role list users, the legacy role 'user' (an agent) included", async () => {
    for (const role of ["admin", "manager", "agent", "user"] as const) {
      const u = await createUser({ role: role === "user" ? "agent" : role });
      if (role === "user") await db.update(users).set({ role: "user" }).where(eq(users.id, u.id));
      const res = await (await loginAs(ctx.app, u)).get("/api/users");
      expect({ role, status: res.status }).toEqual({ role, status: 200 });
      expect(Array.isArray(res.body)).toBe(true);
      expect(findSecrets(res.body)).toEqual([]);
    }
  });

  it("the team-member picker: admins see staff and admins, managers and agents see agents and managers only", async () => {
    const admin = await createUser({ role: "admin" });
    const manager = await createUser({ role: "manager" });
    const agent = await createUser({ role: "agent" });
    const customer = await createUser({ role: "customer" });
    const idsFor = async (viewer: typeof admin) =>
      ((await (await loginAs(ctx.app, viewer)).get("/api/users?forTeamMemberSelection=true")).body as Array<{ id: string }>)
        .map((u) => u.id)
        .sort();
    expect(await idsFor(admin)).toEqual([admin.id, manager.id, agent.id].sort());
    for (const viewer of [manager, agent]) {
      const ids = await idsFor(viewer);
      expect(ids).toEqual([manager.id, agent.id].sort());
      expect(ids).not.toContain(admin.id);
      expect(ids).not.toContain(customer.id);
    }
  });

  it("leaks no secret fields from any user-bearing endpoint", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser({ role: "agent", isApproved: false });
    const team = await createTeam(admin);
    await storage.addTeamMember({
      teamId: team.id,
      userId: target.id,
      role: "member",
    });
    await storage.addTeamAdmin(target.id, team.id, admin.id);
    const agent = await loginAs(ctx.app, admin);

    const ticket = await createTicketAs(agent);
    expect(ticket.status).toBeLessThan(300);
    await storage.addTaskComment({
      taskId: ticket.body.id,
      userId: target.id,
      content: "hello",
    });
    await db
      .update(tasks)
      .set({ assigneeType: "team", assigneeTeamId: team.id })
      .where(eq(tasks.id, ticket.body.id));
    await storage.createTaskAssignment({
      taskId: ticket.body.id,
      teamId: team.id,
      assignedUserId: target.id,
      assignedBy: admin.id,
    });

    const responses: Array<[string, request.Response]> = [
      ["users", await agent.get("/api/users")],
      [
        "users team selection",
        await agent.get("/api/users?forTeamMemberSelection=true"),
      ],
      ["admin users", await agent.get("/api/admin/users")],
      [
        "patch",
        await agent
          .patch(`/api/admin/users/${target.id}`)
          .send({ firstName: "Renamed" }),
      ],
      ["toggle", await agent.post(`/api/admin/users/${target.id}/toggle-status`)],
      ["approve", await agent.post(`/api/admin/users/${target.id}/approve`)],
      ["members", await agent.get(`/api/teams/${team.id}/members`)],
      ["admins", await agent.get(`/api/teams/${team.id}/admins`)],
      ["comments", await agent.get(`/api/tasks/${ticket.body.id}/comments`)],
      [
        "assignments",
        await agent.get(
          `/api/teams/${team.id}/tasks/${ticket.body.id}/assignments`
        ),
      ],
    ];
    for (const [name, res] of responses) {
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
      expect({ name, secrets: findSecrets(res.body) }).toEqual({
        name,
        secrets: [],
      });
    }
    // The comment author is still shown, just without secrets.
    const comments = responses[8][1].body;
    expect(comments[0].user.firstName).toBeDefined();
  });
});
