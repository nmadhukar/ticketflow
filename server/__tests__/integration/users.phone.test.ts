import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, createTeam, loginAs } from "./helpers/fixtures";
import { mcpFor } from "./helpers/mcpClient";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { tasks, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { User } from "@shared/schema";

/**
 * R41: a user's phone is visible to admins, managers and the user themself.
 * Agents and customers never see another user's phone. Every response that
 * carries another user goes through projectUserForViewer.
 */
describe("users: phone visibility (R41)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let admin: User;
  let manager: User;
  let agent: User;
  let otherAgent: User;
  let customer: User;
  let teamId: number;
  let ticketId: number;
  let phones: Map<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    admin = await createUser({ role: "admin" });
    manager = await createUser({ role: "manager" });
    agent = await createUser({ role: "agent" });
    otherAgent = await createUser({ role: "agent" });
    customer = await createUser({ role: "customer" });
    phones = new Map();
    let n = 0;
    for (const u of [admin, manager, agent, otherAgent, customer]) {
      const phone = `555-01${String(++n).padStart(2, "0")}`;
      phones.set(u.id, phone);
      await db.update(users).set({ phone }).where(eq(users.id, u.id));
    }
    const team = await createTeam(manager);
    teamId = team.id;
    for (const u of [agent, otherAgent]) {
      await storage.addTeamMember({ teamId, userId: u.id, role: "member" });
    }
    await storage.addTeamAdmin(agent.id, teamId, admin.id);
    await storage.addTeamAdmin(otherAgent.id, teamId, admin.id);
    const ticket = await storage.createTask({
      title: "Phone visibility",
      description: "d",
      category: "support",
      priority: "medium",
      status: "open",
      createdBy: customer.id,
      assigneeType: "team",
      assigneeTeamId: teamId,
    } as never);
    ticketId = ticket.id;
    await db.update(tasks).set({ assigneeType: "team", assigneeTeamId: teamId }).where(eq(tasks.id, ticketId));
    await storage.addTaskComment({ taskId: ticketId, userId: otherAgent.id, content: "from other" });
    await storage.addTaskComment({ taskId: ticketId, userId: agent.id, content: "from me" });
    await storage.createTaskAssignment({
      taskId: ticketId,
      teamId,
      assignedUserId: otherAgent.id,
      assignedBy: admin.id,
    });
  });

  /** Every object in the body that is a known user (its `id` is a seeded user id). */
  function userObjects(body: unknown): Array<Record<string, unknown>> {
    const found: Array<Record<string, unknown>> = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.id === "string" && phones.has(o.id)) found.push(o);
        Object.values(o).forEach(walk);
      }
    };
    walk(body);
    return found;
  }

  async function endpointBodies(viewer: User): Promise<Array<[string, unknown]>> {
    const rest = await loginAs(ctx.app, viewer);
    const mcp = await mcpFor(ctx.app, viewer);
    const out: Array<[string, unknown]> = [];
    const add = async (name: string, path: string) => {
      const res = await rest.get(path);
      if (res.status === 200) out.push([name, res.body]);
      else out.push([`${name} (status ${res.status})`, null]);
    };
    await add("users", "/api/users");
    await add("picker", "/api/users?forTeamMemberSelection=true");
    await add("admin users", "/api/admin/users");
    await add("members", `/api/teams/${teamId}/members`);
    await add("admins", `/api/teams/${teamId}/admins`);
    await add("comments", `/api/tasks/${ticketId}/comments`);
    await add("history", `/api/tasks/${ticketId}/history`);
    await add("assignments", `/api/teams/${teamId}/tasks/${ticketId}/assignments`);
    const t = await mcp.call("get_ticket", { id: ticketId, includeComments: true });
    out.push(["mcp get_ticket", t.isError ? null : t.data]);
    return out;
  }

  function assertPhones(viewer: User, bodies: Array<[string, unknown]>, seeOthers: boolean) {
    let sawOther = 0;
    let sawSelf = 0;
    for (const [name, body] of bodies) {
      for (const u of userObjects(body)) {
        const self = u.id === viewer.id;
        const mayHavePhone = seeOthers || (self && viewer.role !== "customer");
        if (mayHavePhone) {
          expect({ name, id: u.id, phone: u.phone }).toEqual({ name, id: u.id, phone: phones.get(u.id as string) });
        } else {
          expect({ name, id: u.id, hasPhone: "phone" in u }).toEqual({ name, id: u.id, hasPhone: false });
        }
        if (self) sawSelf++;
        else sawOther++;
      }
    }
    return { sawOther, sawSelf };
  }

  it("an agent sees no other user's phone, but their own", async () => {
    const bodies = await endpointBodies(agent);
    // The agent can reach the user-bearing endpoints they are entitled to.
    const reached = bodies.filter(([, b]) => b !== null).map(([n]) => n);
    for (const n of ["users", "picker", "members", "admins", "comments", "history", "assignments", "mcp get_ticket"]) {
      expect(reached).toContain(n);
    }
    const { sawOther, sawSelf } = assertPhones(agent, bodies, false);
    expect(sawOther).toBeGreaterThan(8);
    expect(sawSelf).toBeGreaterThan(0);
    // The agent's own row carries their own phone.
    const users = bodies.find(([n]) => n === "users")![1] as Array<Record<string, unknown>>;
    expect(users.find((u) => u.id === agent.id)!.phone).toBe(phones.get(agent.id));
    expect(users.find((u) => u.id === otherAgent.id)).not.toHaveProperty("phone");
  });

  it("a manager sees every phone", async () => {
    const bodies = await endpointBodies(manager);
    const { sawOther } = assertPhones(manager, bodies, true);
    expect(sawOther).toBeGreaterThan(8);
  });

  it("an admin sees every phone", async () => {
    const bodies = await endpointBodies(admin);
    const { sawOther } = assertPhones(admin, bodies, true);
    expect(sawOther).toBeGreaterThan(8);
  });

  it("a customer never sees a phone, not even their own", async () => {
    const bodies = await endpointBodies(customer);
    const { sawOther } = assertPhones(customer, bodies, false);
    expect(sawOther).toBeGreaterThan(0);
    expect(JSON.stringify(bodies)).not.toMatch(/555-01/);
  });

  it("/api/auth/user keeps the caller's own phone", async () => {
    const res = await (await loginAs(ctx.app, agent)).get("/api/auth/user");
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(phones.get(agent.id));
  });
});
