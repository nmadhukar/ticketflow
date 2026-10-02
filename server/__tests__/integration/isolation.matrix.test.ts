import type request from "supertest";
import { taskAttachments, type User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";

/**
 * Ticket isolation matrix (one access rule everywhere).
 *
 * Fixture:
 *   department D1 (manager M1) -> team T1 with agents A1, A2
 *   department D2 (manager M2) -> team T2 with agent A3
 *   customers C1, C2; one admin
 *   t1  created by C1, queued to team T1
 *   t2  created by C2, assigned to A3
 *   t3  created by C1, assigned to A2
 *   t4  created by A1, assigned to A3   ("created by me" for an agent)
 *   t5  created by M1, queued to team T2 ("created by me" for a manager)
 *
 * Rule: admin all; manager = assigned/created by them, queued to a team in a
 * department they manage, or assigned to a member of such a team; agent =
 * assigned/created by them, queued to a team they belong to, or assigned to a
 * teammate; customer = created by them.
 */
type Who = "A1" | "A2" | "A3" | "M1" | "M2" | "C1" | "C2" | "admin";
type Ticket = "t1" | "t2" | "t3" | "t4" | "t5";
const WHO: Who[] = ["A1", "A2", "A3", "M1", "M2", "C1", "C2", "admin"];
const TICKETS: Ticket[] = ["t1", "t2", "t3", "t4", "t5"];

const Y = true;
const N = false;
/** The allow/deny table. Y = may see/act on the ticket, N = 403. */
const MATRIX: Record<Who, [boolean, boolean, boolean, boolean, boolean]> = {
  //       t1 t2 t3 t4 t5
  A1:    [Y, N, Y, Y, N], // t1 queued to his team; t3 assigned to teammate A2; t4 created by him
  A2:    [Y, N, Y, N, N], // t1 his team's queue; t3 his own. t4 only CREATED by a teammate -> N
  A3:    [N, Y, N, Y, Y], // t2, t4 assigned to him; t5 queued to his team T2
  M1:    [Y, N, Y, N, Y], // t1 queued to T1 (D1); t3 assigned to A2 (T1, D1); t5 created by him
  M2:    [N, Y, N, Y, Y], // t2, t4 assigned to A3 (T2, D2); t5 queued to T2 (D2)
  C1:    [Y, N, Y, N, N], // created by C1
  C2:    [N, Y, N, N, N], // created by C2
  admin: [Y, Y, Y, Y, Y],
};
const visibleTo = (who: Who): Ticket[] => TICKETS.filter((_, i) => MATRIX[who][i]);

type Agent = ReturnType<typeof request.agent>;
type Res = Awaited<ReturnType<Agent["get"]>>;

interface RouteSpec {
  name: string;
  call(agent: Agent, id: number): Promise<Res>;
  /** Statuses that mean the access gate let the request through. */
  allowed: number[];
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
    refusedRoles: ["C1", "C2"], // customers may not change status, even on their own tickets
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
  { name: "GET /api/tasks/:id/attachments", call: (a, id) => a.get(`/api/tasks/${id}/attachments`), allowed: [200] },
  {
    // No file and no S3 in the test env: the gate passes, then 503 (storage off) or 400 (no file).
    name: "POST /api/tasks/:id/attachments",
    call: (a, id) => a.post(`/api/tasks/${id}/attachments`),
    allowed: [400, 503],
  },
  { name: "GET /api/tasks/:id/auto-response", call: (a, id) => a.get(`/api/tasks/${id}/auto-response`), allowed: [200] },
  {
    // AI is not configured in the test env: the gate passes, then 503 / 400.
    name: "POST /api/tasks/:id/auto-response/generate",
    call: (a, id) => a.post(`/api/tasks/${id}/auto-response/generate`),
    allowed: [400, 503],
  },
  {
    name: "POST /api/tasks/:id/auto-response/feedback",
    call: (a, id) => a.post(`/api/tasks/${id}/auto-response/feedback`).send({ wasHelpful: true }),
    allowed: [200],
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

    const T1 = await createTeam(users.M1); // creates D1 managed by M1
    const T2 = await createTeam(users.M2); // creates D2 managed by M2
    await storage.addTeamMember({ teamId: T1.id, userId: users.A1.id });
    await storage.addTeamMember({ teamId: T1.id, userId: users.A2.id });
    await storage.addTeamMember({ teamId: T2.id, userId: users.A3.id });

    const ticket = async (
      createdBy: Who,
      assignee: { user: Who } | { team: number }
    ) => {
      const t = await storage.createTask({
        title: `ticket by ${createdBy}`,
        description: "isolation matrix",
        category: "support",
        priority: "medium",
        status: "open",
        createdBy: users[createdBy].id,
        ...("user" in assignee
          ? { assigneeType: "user", assigneeId: users[assignee.user].id, assigneeTeamId: null }
          : { assigneeType: "team", assigneeId: null, assigneeTeamId: assignee.team }),
      });
      return t.id;
    };
    ids.t1 = await ticket("C1", { team: T1.id });
    ids.t2 = await ticket("C2", { user: "A3" });
    ids.t3 = await ticket("C1", { user: "A2" });
    ids.t4 = await ticket("A1", { user: "A3" });
    ids.t5 = await ticket("M1", { team: T2.id });

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

        const res = await route.call(agents[who], ids[t]);
        if (route.allowed.includes(res.status)) actual[t] = "allowed";
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
      expect(await list("M2", "A3")).toEqual(["t2", "t4"]);
      expect(await list("admin", "A3")).toEqual(["t2", "t4"]);
      expect(await list("C1", "A2")).toEqual(["t3"]);
      expect(await list("C2", "A2")).toEqual([]);
    });

    it("GET /api/tasks/my lists only tickets assigned to me", async () => {
      expect(sortedTickets((await agents.A3.get("/api/tasks/my")).body)).toEqual(["t2", "t4"]);
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
          expect(res.body.total).toBe(5);
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

    it("POST /api/ai-feedback with a ticketId is refused outside scope", async () => {
      const send = (who: Who, t: Ticket) =>
        agents[who]
          .post("/api/ai-feedback")
          .send({ feedbackType: "auto_response", referenceId: 1, rating: 5, ticketId: ids[t] });
      const denied = await send("A3", "t1");
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("forbidden");
      expect((await send("A3", "t2")).status).toBe(200);
      expect((await agents.A3.post("/api/ai-feedback").send({
        feedbackType: "auto_response", referenceId: 1, rating: 5, ticketId: 999999,
      })).status).toBe(404);
    });
  });
});
