import { and, eq, sql, type SQL } from "drizzle-orm";
import type { RequestHandler } from "express";
import { departments, tasks, teamMembers, teams } from "@shared/schema";
import { db } from "../storage/db";
import { normalizeRole } from "./roles";
import { HttpError, asyncHandler } from "../http/errors";
import { parseIdParam } from "../http/params";

export interface AccessUser {
  id: string;
  role: unknown;
}

/** A user assignment: assignee_id counts only on these rows. NULL reads as the column default ('user'). */
export const assignedToUserSql = sql`COALESCE(${tasks.assigneeType}, 'user') = 'user'`;
/** A team queue: assignee_team_id counts only on these rows. */
export const queuedToTeamSql = sql`${tasks.assigneeType} = 'team'`;

/** The one visibility rule. admin: all. manager: assigned/created by them, queued to teams in departments
 *  they manage, or assigned to members of those teams. agent: assigned/created by them, queued to a team
 *  they belong to, or assigned to a teammate. customer: created by them. Unknown role: nothing.
 *
 *  Rendered against the `tasks` table; use it in any SELECT ... FROM tasks. The user id is always a bound
 *  parameter. "Manages a department" is departments.manager_id; "belongs to a team" is a team_members row;
 *  a teammate is a user who shares at least one team with the agent. "Assigned" terms read assignee_id only
 *  on user tickets and "queued" terms read assignee_team_id only on team tickets, so a column left over from
 *  a reassignment grants nothing. */
export function ticketVisibilityWhere(user: AccessUser): SQL {
  const role = normalizeRole(user?.role);
  const me = user?.id;
  if (!role || typeof me !== "string" || me === "") return sql`FALSE`;
  if (role === "admin") return sql`TRUE`;
  if (role === "customer") return sql`${tasks.createdBy} = ${me}`;

  if (role === "manager") {
    return sql`(${tasks.createdBy} = ${me}
      OR (${assignedToUserSql} AND (${tasks.assigneeId} = ${me} OR EXISTS (
        SELECT 1 FROM ${teamMembers} tm
        JOIN ${teams} t ON t.id = tm.team_id
        JOIN ${departments} d ON d.id = t.department_id
        WHERE tm.user_id = ${tasks.assigneeId} AND d.manager_id = ${me}
      )))
      OR (${queuedToTeamSql} AND EXISTS (
        SELECT 1 FROM ${teams} t
        JOIN ${departments} d ON d.id = t.department_id
        WHERE t.id = ${tasks.assigneeTeamId} AND d.manager_id = ${me}
      )))`;
  }

  // agent
  return sql`(${tasks.createdBy} = ${me}
    OR (${assignedToUserSql} AND (${tasks.assigneeId} = ${me} OR EXISTS (
      SELECT 1 FROM ${teamMembers} mine
      JOIN ${teamMembers} theirs ON theirs.team_id = mine.team_id
      WHERE mine.user_id = ${me} AND theirs.user_id = ${tasks.assigneeId}
    )))
    OR (${queuedToTeamSql} AND EXISTS (
      SELECT 1 FROM ${teamMembers} tm
      WHERE tm.team_id = ${tasks.assigneeTeamId} AND tm.user_id = ${me}
    )))`;
}

/** SELECT 1 FROM tasks WHERE id=$1 AND <ticketVisibilityWhere(user)> */
export async function canAccessTask(user: AccessUser, taskId: number): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), ticketVisibilityWhere(user)))
    .limit(1);
  return rows.length > 0;
}

/** 404 if the ticket does not exist, 403 if it exists but is outside the user's scope. */
export async function assertTaskAccess(user: AccessUser, taskId: number): Promise<void> {
  if (await canAccessTask(user, taskId)) return;
  const exists = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (exists.length === 0) throw new HttpError(404, "not_found", "Ticket not found");
  throw new HttpError(403, "forbidden", "You do not have access to this ticket");
}

/** Route middleware: assertTaskAccess(req.user, req.params[param]) before the handler runs. */
export function requireTaskAccess(param = "id"): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    await assertTaskAccess(req.user as AccessUser, parseIdParam(req.params[param], param));
    next();
  });
}
