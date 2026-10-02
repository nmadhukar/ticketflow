import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { HttpError } from "../../http/errors";

// Every db.select(...).from(...).where(...).limit(...) resolves to the next
// queued result; where() arguments are kept so the predicate can be rendered.
const mockResults: unknown[][] = [];
const mockWheres: SQL[] = [];
jest.mock("../../storage/db", () => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn((w: SQL) => {
    mockWheres.push(w);
    return chain;
  });
  chain.limit = jest.fn(async () => mockResults.shift() ?? []);
  return { db: chain, pool: {} };
});

import {
  ticketVisibilityWhere,
  canAccessTask,
  assertTaskAccess,
} from "../../permissions/ticketAccess";
import { canUpdateTicket, normalizeAssigneeUpdate } from "../../permissions/tickets";

const dialect = new PgDialect();
const render = (s: SQL) => dialect.sqlToQuery(s);
const ME = "user-1";

beforeEach(() => {
  mockResults.length = 0;
  mockWheres.length = 0;
});

describe("ticketVisibilityWhere", () => {
  it("admin sees everything", () => {
    const q = render(ticketVisibilityWhere({ id: ME, role: "admin" }));
    expect(q.sql.trim().toLowerCase()).toBe("true");
    expect(q.params).toEqual([]);
  });

  it("customer sees only tickets they created", () => {
    const q = render(ticketVisibilityWhere({ id: ME, role: "customer" }));
    expect(q.sql).toBe('"tasks"."created_by" = $1');
    expect(q.params).toEqual([ME]);
  });

  it.each([["superuser"], ["Admin"], [""], [null], [undefined], [42]])(
    "unknown role %p sees nothing",
    (role) => {
      const q = render(ticketVisibilityWhere({ id: ME, role }));
      expect(q.sql.trim().toLowerCase()).toBe("false");
      expect(q.params).toEqual([]);
    }
  );

  it("a user without an id sees nothing, whatever the role", () => {
    for (const role of ["admin", "manager", "agent", "customer"]) {
      const q = render(ticketVisibilityWhere({ id: "", role }));
      expect(q.sql.trim().toLowerCase()).toBe("false");
    }
  });

  it("agent: assigned to me, created by me, queued to my team, or assigned to a teammate", () => {
    const q = render(ticketVisibilityWhere({ id: ME, role: "agent" }));
    expect(q.sql).toContain('"tasks"."assignee_id" = $');
    expect(q.sql).toContain('"tasks"."created_by" = $');
    // queued to a team I belong to
    expect(q.sql).toMatch(/"team_members"[\s\S]*"tasks"\."assignee_team_id"/);
    // assigned to someone who shares one of my teams
    expect(q.sql).toMatch(/JOIN "team_members"[\s\S]*"tasks"\."assignee_id"/);
    expect(q.sql).not.toContain("departments");
    expect(q.params.every((p) => p === ME)).toBe(true);
    expect(q.params.length).toBeGreaterThanOrEqual(4);
  });

  it.each([["agent"], ["manager"]])(
    "%s: 'assigned' terms only for user tickets, 'queued' terms only for team tickets (stale columns grant nothing)",
    (role) => {
      const q = render(ticketVisibilityWhere({ id: ME, role }));
      // Every assignee_id term sits behind the user gate...
      expect(q.sql).toMatch(
        /COALESCE\("tasks"\."assignee_type", 'user'\) = 'user' AND \("tasks"\."assignee_id" = \$\d+ OR EXISTS/
      );
      // ...and every assignee_team_id term behind the team gate.
      expect(q.sql).toMatch(/"tasks"\."assignee_type" = 'team' AND EXISTS \([^)]*"tasks"\."assignee_team_id"/);
      expect(q.sql.match(/"tasks"\."assignee_id"/g)).toHaveLength(2);
      expect(q.sql.match(/"tasks"\."assignee_team_id"/g)).toHaveLength(1);
      // created_by needs no gate.
      expect(q.sql).toMatch(/^\("tasks"\."created_by" = \$\d+\s+OR /);
    }
  );

  it("legacy role user is read as agent", () => {
    expect(render(ticketVisibilityWhere({ id: ME, role: "user" }))).toEqual(
      render(ticketVisibilityWhere({ id: ME, role: "agent" }))
    );
  });

  it("manager: assigned/created by me, queued to a team in a department I manage, or assigned to a member of one", () => {
    const q = render(ticketVisibilityWhere({ id: ME, role: "manager" }));
    expect(q.sql).toContain('"tasks"."assignee_id" = $');
    expect(q.sql).toContain('"tasks"."created_by" = $');
    expect(q.sql).toMatch(/"departments"[\s\S]*manager_id = \$/);
    expect(q.sql).toMatch(/"tasks"\."assignee_team_id"/);
    expect(q.sql).toMatch(/tm\.user_id = "tasks"\."assignee_id"/);
    expect(q.params.every((p) => p === ME)).toBe(true);
  });

  it("the user id is always a bound parameter, never SQL text", () => {
    const evil = "x' OR '1'='1";
    for (const role of ["agent", "manager", "customer"]) {
      const q = render(ticketVisibilityWhere({ id: evil, role }));
      expect(q.sql).not.toContain(evil);
      expect(q.params).toContain(evil);
    }
  });
});

describe("canAccessTask", () => {
  it("is true when the ticket matches the visibility rule", async () => {
    mockResults.push([{ one: 1 }]);
    await expect(canAccessTask({ id: ME, role: "agent" }, 7)).resolves.toBe(true);
    const q = render(mockWheres[0]);
    expect(q.sql).toContain('"tasks"."id" = $1');
    expect(q.params[0]).toBe(7);
    expect(q.sql).toContain('"tasks"."created_by" = $');
  });

  it("is false when no row matches", async () => {
    mockResults.push([]);
    await expect(canAccessTask({ id: ME, role: "customer" }, 7)).resolves.toBe(false);
  });
});

describe("assertTaskAccess", () => {
  it("resolves for a visible ticket", async () => {
    mockResults.push([{ one: 1 }]);
    await expect(assertTaskAccess({ id: ME, role: "agent" }, 7)).resolves.toBeUndefined();
  });

  it("403 forbidden when the ticket exists but is outside the user's scope", async () => {
    mockResults.push([], [{ id: 7 }]);
    const err = await assertTaskAccess({ id: ME, role: "agent" }, 7).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
  });

  it("404 not_found when the ticket does not exist", async () => {
    mockResults.push([], []);
    const err = await assertTaskAccess({ id: ME, role: "admin" }, 99).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
  });
});

describe("canUpdateTicket = access + role field table", () => {
  const ticket = { id: 7, createdBy: "someone-else", status: "open" };

  it("refuses a ticket outside the user's scope, whatever the role", async () => {
    for (const role of ["agent", "manager", "customer"]) {
      mockResults.push([]);
      const v = await canUpdateTicket({ user: { id: ME, role }, ticket, payload: { notes: "x" } });
      expect(v.allowed).toBe(false);
    }
  });

  it("an agent may change status, priority and notes on an accessible ticket, nothing else", async () => {
    mockResults.push([{ one: 1 }]);
    const ok = await canUpdateTicket({
      user: { id: ME, role: "agent" },
      ticket,
      payload: { status: "in_progress", title: "renamed" },
    });
    expect(ok.allowed).toBe(true);
    expect(ok.prunedPayload).toEqual({ status: "in_progress" });

    mockResults.push([{ one: 1 }]);
    const no = await canUpdateTicket({
      user: { id: ME, role: "agent" },
      ticket,
      payload: { title: "renamed", assigneeId: "x" },
    });
    expect(no.allowed).toBe(false);
  });

  it("legacy role user gets the agent field table, not the customer one", async () => {
    mockResults.push([{ one: 1 }]);
    const v = await canUpdateTicket({
      user: { id: ME, role: "user" },
      ticket,
      payload: { status: "in_progress" },
    });
    expect(v.allowed).toBe(true);
  });

  it("a customer may not change status even on their own ticket", async () => {
    mockResults.push([{ one: 1 }]);
    const v = await canUpdateTicket({
      user: { id: ME, role: "customer" },
      ticket: { ...ticket, createdBy: ME },
      payload: { status: "closed" },
    });
    expect(v.allowed).toBe(false);
  });

  it("an unknown role is refused without consulting the database", async () => {
    const v = await canUpdateTicket({
      user: { id: ME, role: "superuser" },
      ticket,
      payload: { notes: "x" },
    });
    expect(v.allowed).toBe(false);
    expect(mockWheres).toHaveLength(0);
  });
});

describe("normalizeAssigneeUpdate: a reassignment leaves no stale column", () => {
  const norm = (u: Record<string, unknown>) => {
    const copy = { ...u };
    normalizeAssigneeUpdate(copy);
    return copy;
  };

  it("switching to a team clears assignee_id", () => {
    expect(norm({ assigneeType: "team", assigneeTeamId: 2, assigneeId: "x" })).toEqual({
      assigneeType: "team",
      assigneeTeamId: 2,
      assigneeId: null,
    });
  });

  it("switching to a user clears assignee_team_id", () => {
    expect(norm({ assigneeType: "user", assigneeId: "x", assigneeTeamId: 2 })).toEqual({
      assigneeType: "user",
      assigneeId: "x",
      assigneeTeamId: null,
    });
  });

  it("an id without a type sets the type and clears the other column", () => {
    expect(norm({ assigneeId: "x" })).toEqual({ assigneeType: "user", assigneeId: "x", assigneeTeamId: null });
    expect(norm({ assigneeTeamId: 2 })).toEqual({ assigneeType: "team", assigneeTeamId: 2, assigneeId: null });
  });

  it("unassigning or not touching the assignee changes nothing", () => {
    expect(norm({ assigneeId: null })).toEqual({ assigneeId: null });
    expect(norm({ status: "open" })).toEqual({ status: "open" });
  });

  it("both ids without a type is a 400", () => {
    let err: unknown;
    try {
      norm({ assigneeId: "x", assigneeTeamId: 2 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).code).toBe("validation_failed");
  });
});
