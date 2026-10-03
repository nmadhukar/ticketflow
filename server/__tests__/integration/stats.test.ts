import type request from "supertest";
import { tasks, type InsertTask, type User } from "@shared/schema";
import { eq } from "drizzle-orm";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";

/**
 * Dashboard statistics use the ticket list's visibility rule and count every status.
 *
 * Fixture: D1 (manager M1) -> T1 with agents A1, A2; D2 (manager M2) -> T2 with agent A3;
 * customers C1, C2; one admin. Tickets are spread over every status and priority and over
 * user-assigned, team-queued and stale-column rows, so each role sees a different slice.
 */
type Agent = ReturnType<typeof request.agent>;
type Who = "A1" | "A2" | "A3" | "M1" | "M2" | "C1" | "C2" | "admin";
const WHO: Who[] = ["A1", "A2", "A3", "M1", "M2", "C1", "C2", "admin"];
const STATUSES = ["open", "in_progress", "on_hold", "resolved", "closed"] as const;
const STAT_KEY: Record<(typeof STATUSES)[number], string> = {
  open: "open",
  in_progress: "inProgress",
  on_hold: "onHold",
  resolved: "resolved",
  closed: "closed",
};

describe("dashboard stats", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const users = {} as Record<Who, User>;
  const agents = {} as Record<Who, Agent>;

  /** Every ticket the list returns for ?status=X (or all), paged to the end. */
  async function listAll(who: Who, status?: string) {
    const rows: any[] = [];
    const pageSize = 4;
    for (let offset = 0; ; offset += pageSize) {
      const q = `limit=${pageSize}&offset=${offset}${status ? `&status=${status}` : ""}`;
      const res = await agents[who].get(`/api/tasks?${q}`);
      expect(res.status).toBe(200);
      rows.push(...res.body);
      if (res.body.length < pageSize) break;
    }
    return rows;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb();

    users.admin = await createUser({ role: "admin" });
    users.M1 = await createUser({ role: "manager" });
    users.M2 = await createUser({ role: "manager" });
    for (const w of ["A1", "A2", "A3"] as const) users[w] = await createUser({ role: "agent" });
    for (const w of ["C1", "C2"] as const) users[w] = await createUser({ role: "customer" });

    const T1 = (await createTeam(users.M1)).id;
    const T2 = (await createTeam(users.M2)).id;
    await storage.addTeamMember({ teamId: T1, userId: users.A1.id });
    await storage.addTeamMember({ teamId: T1, userId: users.A2.id });
    await storage.addTeamMember({ teamId: T2, userId: users.A3.id });

    const toUser = (w: Who) => ({ assigneeType: "user" as const, assigneeId: users[w].id, assigneeTeamId: null });
    const toTeam = (team: number) => ({ assigneeType: "team" as const, assigneeId: null, assigneeTeamId: team });
    const make = async (
      createdBy: Who,
      assignee: Pick<InsertTask, "assigneeType" | "assigneeId" | "assigneeTeamId">,
      status: (typeof STATUSES)[number],
      priority: string
    ) => {
      const t = await storage.createTask({
        title: `${createdBy} ${status} ${priority}`,
        description: "stats",
        category: "support",
        priority,
        status: "open",
        createdBy: users[createdBy].id,
        ...assignee,
      });
      if (status !== "open") await db.update(tasks).set({ status }).where(eq(tasks.id, t.id));
    };

    // Team T1 queue and its agents: every status, mixed priorities (incl. urgent in every non-closed status).
    await make("C1", toTeam(T1), "open", "urgent");
    await make("C1", toTeam(T1), "in_progress", "high");
    await make("C1", toTeam(T1), "on_hold", "urgent");
    await make("C1", toTeam(T1), "resolved", "urgent");
    await make("C1", toTeam(T1), "closed", "urgent");
    await make("C1", toUser("A2"), "on_hold", "high");
    await make("C1", toUser("A1"), "open", "low");
    await make("A1", toUser("A3"), "on_hold", "urgent");
    // Team T2 and its agent.
    await make("C2", toUser("A3"), "in_progress", "urgent");
    await make("C2", toUser("A3"), "closed", "high");
    await make("M1", toTeam(T2), "resolved", "medium");
    await make("C2", toTeam(T2), "on_hold", "medium");
    // Stale columns on a team ticket: a stale assignee_id grants nothing.
    await make("C2", { assigneeType: "team", assigneeId: users.A1.id, assigneeTeamId: T2 }, "open", "urgent");

    for (const w of WHO) agents[w] = await loginAs(ctx.app, users[w]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe.each(WHO)("%s", (who) => {
    it("GET /api/stats per-status counts equal GET /api/tasks?status=X paged to the end, on_hold included", async () => {
      const res = await agents[who].get("/api/stats");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("onHold");

      const actual: Record<string, number> = {};
      const expected: Record<string, number> = {};
      for (const status of STATUSES) {
        actual[status] = res.body[STAT_KEY[status]];
        expected[status] = (await listAll(who, status)).length;
      }
      expect(actual).toEqual(expected);

      const everything = await listAll(who);
      expect(res.body.total).toBe(everything.length);
      expect(res.body.total).toBe(Object.values(expected).reduce((a, b) => a + b, 0));
      expect(res.body.highPriority).toBe(everything.filter((t) => t.priority === "high").length);
    });

    it("urgent counts every non-closed urgent ticket the viewer can see (open, in_progress, on_hold, resolved)", async () => {
      const res = await agents[who].get("/api/stats");
      const everything = await listAll(who);
      const urgent = everything.filter((t) => t.priority === "urgent" && t.status !== "closed").length;
      expect(res.body.urgent).toBe(urgent);
    });
  });

  it("staff roles see different totals, so a role is not served another role's scope", async () => {
    const totals: Record<string, number> = {};
    for (const who of WHO) totals[who] = (await agents[who].get("/api/stats")).body.total;
    expect(totals.admin).toBe(13);
    expect(totals.A1).toBeLessThan(totals.admin);
    expect(totals.C1).toBe(7);
    // A1 does not see T2's queue even though a stale assignee_id points at A1.
    expect(totals.A1).toBe(8);
  });

  describe("GET /api/admin/stats", () => {
    it("urgentTickets counts every non-closed urgent ticket, not only open ones", async () => {
      const res = await agents.admin.get("/api/admin/stats");
      expect(res.status).toBe(200);
      const everything = await listAll("admin");
      expect(res.body.urgentTickets).toBe(
        everything.filter((t) => t.priority === "urgent" && t.status !== "closed").length
      );
      expect(res.body.totalTickets).toBe(everything.length);
      expect(res.body.openTickets).toBe((await listAll("admin", "open")).length);
    });

    it("stays admin-only", async () => {
      for (const who of ["A1", "M1", "C1"] as const) {
        expect((await agents[who].get("/api/admin/stats")).status).toBe(403);
      }
    });
  });

  describe("GET /api/stats/global", () => {
    it("is admin-only and returns the admin's own full-scope counts", async () => {
      for (const who of ["A1", "M1", "C1"] as const) {
        expect((await agents[who].get("/api/stats/global")).status).toBe(403);
      }
      const res = await agents.admin.get("/api/stats/global");
      expect(res.status).toBe(200);
      expect(res.body).toEqual((await agents.admin.get("/api/stats")).body);
    });
  });

  describe("GET /api/stats/agent", () => {
    it("assignedToMe counts only user-assigned tickets and team counts only team-queued ones", async () => {
      const a1 = await agents.A1.get("/api/stats/agent");
      expect(a1.status).toBe(200);
      // A1: one user ticket; the stale assignee_id on a T2 team ticket is not an assignment.
      expect(a1.body.personal.assignedToMe).toBe(1);
      const t1 = a1.body.team.find((t: any) => t.totalTickets > 0);
      expect(t1.totalTickets).toBe(5);

      const a3 = await agents.A3.get("/api/stats/agent");
      expect(a3.body.personal.assignedToMe).toBe(3);
    });
  });
});
