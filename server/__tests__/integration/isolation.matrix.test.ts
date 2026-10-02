import type request from "supertest";
import { eq } from "drizzle-orm";
import {
  aiFeedback,
  taskAttachments,
  tasks,
  teamAdmins,
  teamTaskAssignments,
  ticketAutoResponses,
  type InsertTask,
  type User,
} from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";

/**
 * Ticket isolation matrix (one access rule everywhere).
 *
 * Fixture:
 *   department D1 (manager M1) -> team T1 (created by M1) with agents A1, A2
 *   department D2 (manager M2) -> team T2 (created by M2) with agent A3
 *   A3 is also a team ADMIN of T1 without being a member (team-level rights,
 *   no ticket rights): the team routes must not show him T1's tickets.
 *   customers C1, C2; one admin
 *   t1  created by C1, queued to team T1
 *   t2  created by C2, assigned to A3
 *   t3  created by C1, assigned to A2
 *   t4  created by A1, assigned to A3   ("created by me" for an agent)
 *   t5  created by M1, queued to team T2 ("created by me" for a manager)
 *   t6  created by C2, assigned to user A3, with a STALE assignee_team_id = T1
 *   t7  created by C2, queued to team T2, with a STALE assignee_id = A1
 *
 * Rule: admin all; manager = assigned/created by them, queued to a team in a
 * department they manage, or assigned to a member of such a team; agent =
 * assigned/created by them, queued to a team they belong to, or assigned to a
 * teammate; customer = created by them. "Assigned" terms apply only when
 * assignee_type is user, "queued" terms only when it is team.
 */
type Who = "A1" | "A2" | "A3" | "M1" | "M2" | "C1" | "C2" | "admin";
type Ticket = "t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "t7";
const WHO: Who[] = ["A1", "A2", "A3", "M1", "M2", "C1", "C2", "admin"];
const TICKETS: Ticket[] = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];

const Y = true;
const N = false;
type Row = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
/** The allow/deny table. Y = may see/act on the ticket, N = 403. */
const MATRIX: Record<Who, Row> = {
  //       t1 t2 t3 t4 t5 t6 t7
  A1:    [Y, N, Y, Y, N, N, N], // t1 his team's queue; t3 teammate A2's; t4 created by him. t6 stale T1, t7 stale A1 -> N
  A2:    [Y, N, Y, N, N, N, N], // t1 his team's queue; t3 his own. t4 only CREATED by a teammate -> N
  A3:    [N, Y, N, Y, Y, Y, Y], // t2, t4, t6 assigned to him; t5, t7 queued to his team T2. Team admin of T1 grants no t1
  M1:    [Y, N, Y, N, Y, N, N], // t1 queued to T1 (D1); t3 assigned to A2 (T1, D1); t5 created by him. t6/t7 stale -> N
  M2:    [N, Y, N, Y, Y, Y, Y], // t2, t4, t6 assigned to A3 (T2, D2); t5, t7 queued to T2 (D2)
  C1:    [Y, N, Y, N, N, N, N], // created by C1
  C2:    [N, Y, N, N, N, Y, Y], // created by C2
  admin: [Y, Y, Y, Y, Y, Y, Y],
};
const visibleTo = (who: Who): Ticket[] => TICKETS.filter((_, i) => MATRIX[who][i]);

type Agent = ReturnType<typeof request.agent>;
type Res = Awaited<ReturnType<Agent["get"]>>;

interface RouteSpec {
  name: string;
  call(agent: Agent, id: number): Promise<Res>;
  /** Statuses that mean the access gate let the request through. */
  allowed: number[];
  /** Per-role override of `allowed` for routes whose success status differs by role (kept exact, never a union). */
  allowedFor?(who: Who): number[];
  /** Runs before each call on an existing ticket (puts shared state back so the call tests access, not state). */
  prepare?(id: number): Promise<unknown>;
  /** Roles the route's own role rule refuses (403) even on a ticket they can see. */
  refusedRoles?: Who[];
}

const ROUTES: RouteSpec[] = [
  { name: "GET /api/tasks/:id", call: (a, id) => a.get(`/api/tasks/${id}`), allowed: [200] },
  { name: "GET /api/tickets/:id/meta", call: (a, id) => a.get(`/api/tickets/${id}/meta`), allowed: [200] },
  {
    name: "PATCH /api/tasks/:id (status)",
    call: (a, id) => a.patch(`/api/tasks/${id}`).send({ status: "in_progress" }),
    allowed: [200],
    // open -> in_progress is a legal staff move; a customer may only reopen, so C1/C2 are refused on their own tickets.
    // Reset to open first: earlier roles in the loop move the shared tickets, and in_progress -> in_progress is a no-op 200.
    prepare: (id) => db.update(tasks).set({ status: "open", resolvedAt: null, closedAt: null }).where(eq(tasks.id, id)),
    refusedRoles: ["C1", "C2"],
  },
  {
    name: "PATCH /api/tasks/:id (notes)",
    call: (a, id) => a.patch(`/api/tasks/${id}`).send({ notes: "matrix note" }),
    allowed: [200],
  },
  { name: "GET /api/tasks/:id/comments", call: (a, id) => a.get(`/api/tasks/${id}/comments`), allowed: [200] },
  {
    name: "POST /api/tasks/:id/comments",
    call: (a, id) => a.post(`/api/tasks/${id}/comments`).send({ content: "matrix comment" }),
    allowed: [201],
  },
  { name: "GET /api/tasks/:id/history", call: (a, id) => a.get(`/api/tasks/${id}/history`), allowed: [200] },
  { name: "GET /api/tasks/:id/attachments", call: (a, id) => a.get(`/api/tasks/${id}/attachments`), allowed: [200] },
  {
    // No file and no S3 in the test env: the gate passes, then 503 (storage off) or 400 (no file).
    name: "POST /api/tasks/:id/attachments",
    call: (a, id) => a.post(`/api/tasks/${id}/attachments`),
    allowed: [400, 503],
  },
  {
    // An UNAPPLIED draft: staff 200, the ticket's own customer 404 (customers see only applied rows). Outside scope stays 403.
    name: "GET /api/tasks/:id/auto-response (unapplied draft)",
    call: (a, id) => a.get(`/api/tasks/${id}/auto-response`),
    allowed: [200],
    allowedFor: (who) => (who === "C1" || who === "C2" ? [404] : [200]),
    prepare: async (id) => {
      await db.delete(ticketAutoResponses).where(eq(ticketAutoResponses.ticketId, id));
      await db.insert(ticketAutoResponses).values({ ticketId: id, aiResponse: "draft", confidenceScore: "0.5", wasApplied: false });
    },
  },
  {
    // An APPLIED row: everyone who can see the ticket gets exactly 200.
    name: "GET /api/tasks/:id/auto-response (applied)",
    call: (a, id) => a.get(`/api/tasks/${id}/auto-response`),
    allowed: [200],
    prepare: async (id) => {
      await db.delete(ticketAutoResponses).where(eq(ticketAutoResponses.ticketId, id));
      await db.insert(ticketAutoResponses).values({ ticketId: id, aiResponse: "sent", confidenceScore: "0.5", wasApplied: true });
    },
  },
  {
    // No draft exists for the fixture tickets: the gate passes, then 404 for staff.
    name: "POST /api/tasks/:id/auto-response/apply",
    call: (a, id) => a.post(`/api/tasks/${id}/auto-response/apply`),
    allowed: [404],
    refusedRoles: ["C1", "C2"],
    prepare: (id) => db.delete(ticketAutoResponses).where(eq(ticketAutoResponses.ticketId, id)),
  },
  {
    // AI is not configured in the test env: the gate passes, then 503 / 400.
    name: "POST /api/tasks/:id/auto-response/generate",
    call: (a, id) => a.post(`/api/tasks/${id}/auto-response/generate`),
    allowed: [400, 503],
    // AI generation is a staff tool: a customer is refused on their own ticket too (after the 404/403 access check).
    refusedRoles: ["C1", "C2"],
  },
  {
    // Takes the ticket in the body. AI is not configured here: the gate passes, then 503.
    name: "POST /api/ai/analyze-ticket",
    call: (a, id) => a.post("/api/ai/analyze-ticket").send({ ticketId: id }),
    allowed: [503],
    refusedRoles: ["C1", "C2"],
  },
  {
    name: "POST /api/ai/generate-response",
    call: (a, id) => a.post("/api/ai/generate-response").send({ ticketId: id }),
    allowed: [503],
    refusedRoles: ["C1", "C2"],
  },
  {
    name: "POST /api/tasks/:id/auto-response/feedback",
    call: (a, id) => a.post(`/api/tasks/${id}/auto-response/feedback`).send({ wasHelpful: true }),
    allowed: [200],
    // Feedback on a ticket with no auto-response is 404 (Task 17), so give each fixture ticket one.
    prepare: async (id) => {
      await db.delete(ticketAutoResponses).where(eq(ticketAutoResponses.ticketId, id));
      await db.insert(ticketAutoResponses).values({ ticketId: id, aiResponse: "draft", confidenceScore: "0.5", wasApplied: false });
    },
  },
  {
    // Fixture tickets are never resolved: the gate passes, then 400.
    name: "POST /api/tasks/:id/add-to-learning",
    call: (a, id) => a.post(`/api/tasks/${id}/add-to-learning`),
    allowed: [400],
  },
];

describe("ticket isolation matrix", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const users = {} as Record<Who, User>;
  const agents = {} as Record<Who, Agent>;
  const ids = {} as Record<Ticket, number>;
  let T1 = 0;
  let T2 = 0;
  const ticketOf = (id: number) => TICKETS.find((t) => ids[t] === id);
  const sortedTickets = (list: Array<{ id: number }>) =>
    list.map((r) => ticketOf(r.id) ?? `#${r.id}`).sort();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb();

    users.admin = await createUser({ role: "admin" });
    users.M1 = await createUser({ role: "manager" });
    users.M2 = await createUser({ role: "manager" });
    for (const w of ["A1", "A2", "A3"] as const) users[w] = await createUser({ role: "agent" });
    for (const w of ["C1", "C2"] as const) users[w] = await createUser({ role: "customer" });

    T1 = (await createTeam(users.M1)).id; // creates D1 managed by M1
    T2 = (await createTeam(users.M2)).id; // creates D2 managed by M2
    await storage.addTeamMember({ teamId: T1, userId: users.A1.id });
    await storage.addTeamMember({ teamId: T1, userId: users.A2.id });
    await storage.addTeamMember({ teamId: T2, userId: users.A3.id });
    // Team-level rights on T1 for A3 (not a member, not in D1): no ticket rights.
    await db
      .insert(teamAdmins)
      .values({ teamId: T1, userId: users.A3.id, grantedBy: users.admin.id });

    const ticket = async (
      createdBy: Who,
      assignee: Pick<InsertTask, "assigneeType" | "assigneeId" | "assigneeTeamId">
    ) => {
      const t = await storage.createTask({
        title: `ticket by ${createdBy}`,
        description: "isolation matrix",
        category: "support",
        priority: "medium",
        status: "open",
        createdBy: users[createdBy].id,
        ...assignee,
      });
      return t.id;
    };
    const toUser = (w: Who) => ({ assigneeType: "user" as const, assigneeId: users[w].id, assigneeTeamId: null });
    const toTeam = (team: number) => ({ assigneeType: "team" as const, assigneeId: null, assigneeTeamId: team });
    ids.t1 = await ticket("C1", toTeam(T1));
    ids.t2 = await ticket("C2", toUser("A3"));
    ids.t3 = await ticket("C1", toUser("A2"));
    ids.t4 = await ticket("A1", toUser("A3"));
    ids.t5 = await ticket("M1", toTeam(T2));
    // Stale columns left behind by a reassignment: they must grant nothing.
    ids.t6 = await ticket("C2", { assigneeType: "user", assigneeId: users.A3.id, assigneeTeamId: T1 });
    ids.t7 = await ticket("C2", { assigneeType: "team", assigneeId: users.A1.id, assigneeTeamId: T2 });

    for (const w of WHO) agents[w] = await loginAs(ctx.app, users[w]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe.each(ROUTES)("$name", (route) => {
    it.each(WHO)("%s gets exactly the tickets in the matrix", async (who) => {
      const expected: Record<string, string> = {};
      const actual: Record<string, string> = {};
      for (const t of TICKETS) {
        const visible = MATRIX[who][TICKETS.indexOf(t)];
        const refused = route.refusedRoles?.includes(who) ?? false;
        expected[t] = visible && !refused ? "allowed" : "403 forbidden";

        await route.prepare?.(ids[t]);
        const res = await route.call(agents[who], ids[t]);
        if ((route.allowedFor?.(who) ?? route.allowed).includes(res.status)) actual[t] = "allowed";
        else if (res.status === 403 && res.body?.error === "forbidden") actual[t] = "403 forbidden";
        else actual[t] = `${res.status} ${JSON.stringify(res.body)}`;
      }
      expect(actual).toEqual(expected);
    });

    it("a missing ticket id is 404 not_found for staff and customers alike", async () => {
      for (const who of ["C1", "A1", "admin"] as const) {
        const res = await route.call(agents[who], 999999);
        expect({ who, status: res.status, error: res.body?.error }).toEqual({
          who,
          status: 404,
          error: "not_found",
        });
        expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules/);
      }
    });
  });

  describe("lists use the same rule as ids", () => {
    it.each(WHO)("%s: GET /api/tasks lists exactly the matrix row", async (who) => {
      const res = await agents[who].get("/api/tasks");
      expect(res.status).toBe(200);
      expect(sortedTickets(res.body)).toEqual(visibleTo(who));
    });

    it.each(WHO)("%s: list ids equal the ids that answer 200 by id", async (who) => {
      const listed = sortedTickets((await agents[who].get("/api/tasks?limit=500")).body);
      const byId: string[] = [];
      for (const t of TICKETS) {
        if ((await agents[who].get(`/api/tasks/${ids[t]}`)).status === 200) byId.push(t);
      }
      expect(listed).toEqual(byId.sort());
    });

    it("?assigneeId= is filtered by the same rule (no bypass for staff)", async () => {
      const list = async (who: Who, assignee: Who) =>
        sortedTickets((await agents[who].get(`/api/tasks?assigneeId=${users[assignee].id}`)).body);
      expect(await list("A1", "A3")).toEqual(["t4"]); // not t2: A3 is not A1's teammate
      expect(await list("A2", "A3")).toEqual([]);
      expect(await list("M1", "A3")).toEqual([]);
      expect(await list("M2", "A3")).toEqual(["t2", "t4", "t6"]);
      expect(await list("admin", "A3")).toEqual(["t2", "t4", "t6"]);
      expect(await list("C1", "A2")).toEqual(["t3"]);
      expect(await list("C2", "A2")).toEqual([]);
      // t7's stale assignee_id (it is queued to a team) is not an assignment.
      expect(await list("admin", "A1")).toEqual([]);
    });

    it("GET /api/tasks/my lists only tickets assigned to me", async () => {
      expect(sortedTickets((await agents.A3.get("/api/tasks/my")).body)).toEqual(["t2", "t4", "t6"]);
      expect(sortedTickets((await agents.A1.get("/api/tasks/my")).body)).toEqual([]);
      expect(sortedTickets((await agents.A2.get("/api/tasks/my")).body)).toEqual(["t3"]);
      expect(sortedTickets((await agents.C1.get("/api/tasks/my")).body)).toEqual([]);
    });

    it.each(WHO)("%s: GET /api/tasks/my-groups never exceeds the matrix row", async (who) => {
      const res = await agents[who].get("/api/tasks/my-groups");
      expect(res.status).toBe(200);
      for (const t of sortedTickets(res.body)) expect(visibleTo(who)).toContain(t);
    });
  });

  describe("activity feed", () => {
    it.each(WHO)("%s: /api/activity shows only events of tickets in the matrix row", async (who) => {
      const res = await agents[who].get("/api/activity?limit=1000");
      expect(res.status).toBe(200);
      const seen = Array.from(
        new Set(res.body.map((e: { taskId: number }) => ticketOf(e.taskId) ?? `#${e.taskId}`))
      ).sort();
      expect(seen).toEqual(visibleTo(who));
    });
  });

  describe("global stats", () => {
    it("only an admin may read /api/stats/global", async () => {
      for (const who of WHO) {
        const res = await agents[who].get("/api/stats/global");
        if (who === "admin") {
          expect(res.status).toBe(200);
          expect(res.body.total).toBe(TICKETS.length);
        } else {
          expect({ who, status: res.status, error: res.body?.error }).toEqual({
            who,
            status: 403,
            error: "forbidden",
          });
        }
      }
    });
  });

  describe("attachments addressed by attachment id", () => {
    const attach = async (t: Ticket, uploader: Who) => {
      const [row] = await db
        .insert(taskAttachments)
        .values({
          taskId: ids[t],
          userId: users[uploader].id,
          fileName: "note.txt",
          fileSize: 4,
          fileType: "text/plain",
          fileUrl: "matrix/note.txt",
        })
        .returning();
      return row.id;
    };

    it.each(WHO)("%s: GET /api/attachments/:id/download follows the matrix", async (who) => {
      const expected: Record<string, string> = {};
      const actual: Record<string, string> = {};
      for (const t of TICKETS) {
        const attId = await attach(t, "admin");
        expected[t] = MATRIX[who][TICKETS.indexOf(t)] ? "allowed" : "403 forbidden";
        const res = await agents[who].get(`/api/attachments/${attId}/download`);
        // No S3 in the test env, so an allowed download fails after the gate (5xx).
        if (![401, 403, 404].includes(res.status)) actual[t] = "allowed";
        else if (res.status === 403 && res.body?.error === "forbidden") actual[t] = "403 forbidden";
        else actual[t] = `${res.status} ${JSON.stringify(res.body)}`;
      }
      expect(actual).toEqual(expected);
    });

    it("DELETE /api/attachments/:id needs ticket access, and agents may delete only their own uploads", async () => {
      const del = async (who: Who, attId: number) => {
        const res = await agents[who].delete(`/api/attachments/${attId}`);
        return res.status === 403 ? `403 ${res.body?.error}` : String(res.status);
      };
      // No access to t1 at all: refused even though they are staff.
      expect(await del("A3", await attach("t1", "A2"))).toBe("403 forbidden");
      expect(await del("M2", await attach("t1", "A2"))).toBe("403 forbidden");
      expect(await del("C2", await attach("t1", "C1"))).toBe("403 forbidden");
      // Access to t1, but an agent may not delete someone else's upload.
      expect(await del("A1", await attach("t1", "A2"))).toBe("403 forbidden");
      // Uploader with access, the department's manager, and admin may.
      expect(await del("A2", await attach("t1", "A2"))).toBe("204");
      expect(await del("C1", await attach("t1", "C1"))).toBe("204");
      expect(await del("M1", await attach("t1", "A2"))).toBe("204");
      expect(await del("admin", await attach("t2", "A3"))).toBe("204");
      // A customer's own upload on a ticket they can no longer see is still refused.
      expect(await del("C2", await attach("t1", "C2"))).toBe("403 forbidden");
      // Missing attachment.
      const missing = await agents.admin.delete("/api/attachments/999999");
      expect(missing.status).toBe(404);
    });
  });

  describe("other ticket-scoped writes", () => {
    it("DELETE /api/tasks/:id: 404 for a missing id, 403 outside scope", async () => {
      expect((await agents.admin.delete("/api/tasks/999999")).status).toBe(404);
      const res = await agents.A3.delete(`/api/tasks/${ids.t1}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("forbidden");
    });

  });

  describe("team routes never show a ticket the by-id route would refuse", () => {
    it("GET /api/teams/:id/tasks is the team's queue intersected with the ticket rule", async () => {
      const queue = async (who: Who, team: number) => {
        const res = await agents[who].get(`/api/teams/${team}/tasks`);
        return res.status === 200 ? sortedTickets(res.body) : `${res.status} ${res.body?.error ?? ""}`.trim();
      };
      expect(await queue("A1", T1)).toEqual(["t1"]);
      expect(await queue("M1", T1)).toEqual(["t1"]);
      expect(await queue("admin", T1)).toEqual(["t1"]);
      // A3 is a team admin of T1 (team-level rights) but may not see t1.
      expect(await queue("A3", T1)).toEqual([]);
      expect(await queue("A3", T2)).toEqual(["t5", "t7"]);
      expect(await queue("M2", T2)).toEqual(["t5", "t7"]);
    });

    it("GET /api/teams/:id/tasks/:taskId/assignments requires access to the ticket", async () => {
      const res = await agents.A3.get(`/api/teams/${T1}/tasks/${ids.t1}/assignments`);
      expect({ status: res.status, error: res.body?.error }).toEqual({ status: 403, error: "forbidden" });
      expect((await agents.A1.get(`/api/teams/${T1}/tasks/${ids.t1}/assignments`)).status).toBe(200);
      expect((await agents.M1.get(`/api/teams/${T1}/tasks/${ids.t1}/assignments`)).status).toBe(200);
      expect((await agents.admin.get(`/api/teams/${T1}/tasks/999999/assignments`)).status).toBe(404);
    });

    it("GET /api/teams/:id/members?taskId= requires access to that ticket", async () => {
      const res = await agents.A3.get(`/api/teams/${T2}/members?taskId=${ids.t1}`);
      expect({ status: res.status, error: res.body?.error }).toEqual({ status: 403, error: "forbidden" });
      expect((await agents.A3.get(`/api/teams/${T2}/members?taskId=${ids.t5}`)).status).toBe(200);
    });

    it("POST /api/teams/:id/tasks/:taskId/assignments requires access to the ticket", async () => {
      // A3 can manage T1 (team admin) but cannot see t1.
      const denied = await agents.A3
        .post(`/api/teams/${T1}/tasks/${ids.t1}/assignments`)
        .send({ userId: users.A2.id });
      expect({ status: denied.status, error: denied.body?.error }).toEqual({ status: 403, error: "forbidden" });
      const ok = await agents.M1
        .post(`/api/teams/${T1}/tasks/${ids.t1}/assignments`)
        .send({ userId: users.A2.id });
      expect(ok.status).toBe(201);
    });
  });

  describe("team task assignments are bound to their ticket and team", () => {
    let asg = 0;
    beforeEach(async () => {
      await db.delete(teamTaskAssignments);
      const row = await storage.createTaskAssignment({
        taskId: ids.t1,
        teamId: T1,
        assignedUserId: users.A1.id,
        assignedBy: users.M1.id,
        status: "active",
        notes: "original",
      });
      asg = row.id;
    });
    const current = async () =>
      (await db.select().from(teamTaskAssignments).where(eq(teamTaskAssignments.id, asg)))[0];
    const patch = (who: Who, team: number, t: number, id = asg) =>
      agents[who].patch(`/api/teams/${team}/tasks/${t}/assignments/${id}`).send({ notes: `by ${who}` });
    const del = (who: Who, team: number, t: number, id = asg) =>
      agents[who].delete(`/api/teams/${team}/tasks/${t}/assignments/${id}`);
    const outcome = (res: Res) => `${res.status}${res.status >= 400 ? ` ${res.body?.error}` : ""}`;

    it("M2 (manages D2/T2) cannot reach a D1 ticket's assignment through his own team or ticket", async () => {
      expect(outcome(await patch("M2", T2, ids.t1))).toBe("404 not_found"); // team mismatch
      expect(outcome(await patch("M2", T2, ids.t5))).toBe("404 not_found"); // ticket and team mismatch
      expect(outcome(await patch("M2", T1, ids.t1))).toBe("403 forbidden"); // bound, but no access to t1
      expect(outcome(await del("M2", T2, ids.t1))).toBe("404 not_found");
      expect(outcome(await del("M2", T2, ids.t5))).toBe("404 not_found");
      expect(outcome(await del("M2", T1, ids.t1))).toBe("403 forbidden");
      expect(await current()).toMatchObject({ notes: "original", taskId: ids.t1, teamId: T1 });
    });

    it("a mismatched taskId or a missing assignment id is 404", async () => {
      expect(outcome(await patch("M1", T1, ids.t3))).toBe("404 not_found");
      expect(outcome(await del("M1", T1, ids.t3))).toBe("404 not_found");
      expect(outcome(await patch("admin", T1, ids.t1, 999999))).toBe("404 not_found");
      expect(outcome(await del("admin", T1, ids.t1, 999999))).toBe("404 not_found");
      expect(await current()).toMatchObject({ notes: "original" });
    });

    it("a team admin without access to the ticket, and a member who cannot manage the team, are refused", async () => {
      expect(outcome(await patch("A3", T1, ids.t1))).toBe("403 forbidden"); // team admin, no ticket access
      expect(outcome(await patch("A1", T1, ids.t1))).toBe("403 forbidden"); // sees t1, cannot manage T1
      expect(outcome(await del("A3", T1, ids.t1))).toBe("403 forbidden");
      expect(outcome(await del("A1", T1, ids.t1))).toBe("403 forbidden");
      expect(await current()).toMatchObject({ notes: "original" });
    });

    it("the department's manager and an admin may update and delete it", async () => {
      expect(outcome(await patch("M1", T1, ids.t1))).toBe("200");
      expect(await current()).toMatchObject({ notes: "by M1" });
      expect(outcome(await patch("admin", T1, ids.t1))).toBe("200");
      expect(outcome(await del("M1", T1, ids.t1))).toBe("200");
      expect(await current()).toBeUndefined();
    });
  });

  describe("AI feedback", () => {
    let ar2 = 0; // an auto-response on t2
    beforeAll(async () => {
      const [ar] = await db
        .insert(ticketAutoResponses)
        .values({ ticketId: ids.t2, aiResponse: "Try turning it off and on.", confidenceScore: "0.50" })
        .returning();
      ar2 = ar.id;
      await db.insert(aiFeedback).values([
        { feedbackType: "auto_response", referenceId: ar2, userId: users.A3.id, rating: 5, ticketId: ids.t2, comment: "on t2" },
        { feedbackType: "knowledge_article", referenceId: 77, userId: users.A3.id, rating: 1, ticketId: null, comment: "no ticket" },
        { feedbackType: "knowledge_article", referenceId: 77, userId: users.A3.id, rating: 5, ticketId: ids.t2, comment: "kb on t2" },
      ]);
    });
    const comments = (res: Res) => (res.body as Array<{ comment: string }>).map((r) => r.comment).sort();

    it("GET /api/ai-feedback/auto_response/:id follows the auto-response's ticket", async () => {
      const denied = await agents.A1.get(`/api/ai-feedback/auto_response/${ar2}`);
      expect({ status: denied.status, error: denied.body?.error }).toEqual({ status: 403, error: "forbidden" });
      expect(JSON.stringify(denied.body)).not.toContain("on t2");
      for (const who of ["A3", "M2", "C2", "admin"] as const) {
        const res = await agents[who].get(`/api/ai-feedback/auto_response/${ar2}`);
        expect({ who, status: res.status }).toEqual({ who, status: 200 });
        expect(comments(res)).toEqual(["on t2"]);
      }
      expect((await agents.admin.get("/api/ai-feedback/auto_response/999999")).status).toBe(404);
    });

    it("GET /api/ai-feedback/:type/:id for other types keeps rows of visible tickets; ticketless rows are admin only", async () => {
      expect(comments(await agents.A1.get("/api/ai-feedback/knowledge_article/77"))).toEqual([]);
      expect(comments(await agents.C1.get("/api/ai-feedback/knowledge_article/77"))).toEqual([]);
      expect(comments(await agents.A3.get("/api/ai-feedback/knowledge_article/77"))).toEqual(["kb on t2"]);
      expect(comments(await agents.admin.get("/api/ai-feedback/knowledge_article/77"))).toEqual([
        "kb on t2",
        "no ticket",
      ]);
    });

    it("POST /api/ai-feedback for an auto-response is tied to that auto-response's ticket", async () => {
      const send = (who: Who, body: Record<string, unknown>) =>
        agents[who].post("/api/ai-feedback").send({ feedbackType: "auto_response", rating: 5, ...body });
      // A1 cannot see t2, whatever ticketId he claims (t1 is a ticket he can see).
      const denied = await send("A1", { referenceId: ar2, ticketId: ids.t1 });
      expect({ status: denied.status, error: denied.body?.error }).toEqual({ status: 403, error: "forbidden" });
      const denied2 = await send("A1", { referenceId: ar2 });
      expect({ status: denied2.status, error: denied2.body?.error }).toEqual({ status: 403, error: "forbidden" });
      // A ticketId that does not match the auto-response's ticket is rejected.
      const mismatch = await send("A3", { referenceId: ar2, ticketId: ids.t4 });
      expect({ status: mismatch.status, error: mismatch.body?.error }).toEqual({ status: 400, error: "validation_failed" });
      // The ticket is derived from the auto-response.
      const ok = await send("A3", { referenceId: ar2 });
      expect(ok.status).toBe(200);
      expect(ok.body.ticketId).toBe(ids.t2);
      expect((await send("A3", { referenceId: ar2, ticketId: ids.t2 })).status).toBe(200);
      expect((await send("A3", { referenceId: 999999 })).status).toBe(404);
    });

    it("POST /api/ai-feedback for another type with a ticketId needs access to that ticket", async () => {
      const send = (who: Who, t: number) =>
        agents[who]
          .post("/api/ai-feedback")
          .send({ feedbackType: "knowledge_article", referenceId: 77, rating: 5, ticketId: t });
      const denied = await send("A3", ids.t1);
      expect({ status: denied.status, error: denied.body?.error }).toEqual({ status: 403, error: "forbidden" });
      expect((await send("A3", ids.t2)).status).toBe(200);
      expect((await send("A3", 999999)).status).toBe(404);
    });
  });

  describe("PATCH reassignment leaves no stale scope", () => {
    let t8 = 0;
    beforeAll(async () => {
      const t = await storage.createTask({
        title: "reassigned",
        category: "support",
        priority: "medium",
        status: "open",
        createdBy: users.admin.id,
        assigneeType: "user",
        assigneeId: users.A2.id,
        assigneeTeamId: null,
      });
      t8 = t.id;
    });
    const row = async () => (await db.select().from(tasks).where(eq(tasks.id, t8)))[0];
    const sees = async (who: Who) => (await agents[who].get(`/api/tasks/${t8}`)).status;

    it("user -> team clears assignee_id; the old assignee's team loses the ticket", async () => {
      expect(await sees("A1")).toBe(200); // teammate of A2
      const res = await agents.admin
        .patch(`/api/tasks/${t8}`)
        .send({ assigneeType: "team", assigneeTeamId: T2 });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({ assigneeType: "team", assigneeId: null, assigneeTeamId: T2 });
      expect(await sees("A1")).toBe(403);
      expect(await sees("A2")).toBe(403);
      expect(await sees("A3")).toBe(200);
    });

    it("assigning a person (no type given) makes it a user assignment and clears the team", async () => {
      const res = await agents.admin.patch(`/api/tasks/${t8}`).send({ assigneeId: users.A1.id });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({ assigneeType: "user", assigneeId: users.A1.id, assigneeTeamId: null });
      expect(await sees("A3")).toBe(403);
      expect(await sees("A2")).toBe(200); // teammate of A1
    });

    it("an explicit type wins over a contradicting id, and both ids without a type is a 400", async () => {
      const res = await agents.admin
        .patch(`/api/tasks/${t8}`)
        .send({ assigneeType: "user", assigneeId: users.A3.id, assigneeTeamId: T1 });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({ assigneeType: "user", assigneeId: users.A3.id, assigneeTeamId: null });
      const both = await agents.admin
        .patch(`/api/tasks/${t8}`)
        .send({ assigneeId: users.A1.id, assigneeTeamId: T1 });
      expect({ status: both.status, error: both.body?.error }).toEqual({ status: 400, error: "validation_failed" });
      expect(await row()).toMatchObject({ assigneeId: users.A3.id, assigneeTeamId: null });
    });
  });
});
