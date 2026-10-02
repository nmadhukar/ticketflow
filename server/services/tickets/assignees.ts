import { and, eq } from "drizzle-orm";
import { teamMembers, teams, users } from "@shared/schema";
import { db } from "../../storage/db";
import { HttpError } from "../../http/errors";
import { normalizeRole } from "../../permissions/roles";

interface AssigneeFields {
  assigneeId?: unknown;
  assigneeTeamId?: unknown;
}

function invalid(field: string, message: string): HttpError {
  return new HttpError(400, "validation_failed", message, {
    formErrors: [],
    fieldErrors: { [field]: [message] },
  });
}

/** A named assignee must exist: 400 naming the field, never an FK 500. */
export async function assertAssigneesExist(fields: AssigneeFields): Promise<void> {
  if (typeof fields.assigneeId === "string" && fields.assigneeId !== "") {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, fields.assigneeId)).limit(1);
    if (!u) throw invalid("assigneeId", "Assignee user not found");
  }
  if (typeof fields.assigneeTeamId === "number") {
    const [t] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, fields.assigneeTeamId)).limit(1);
    if (!t) throw invalid("assigneeTeamId", "Assignee team not found");
  }
}

/**
 * Ruling R16: on create an agent may assign only to themself or to a team they
 * belong to. Admin and manager are unrestricted. Expects normalized fields.
 */
export async function assertAgentMayAssign(
  user: { id: string; role: unknown },
  fields: AssigneeFields
): Promise<void> {
  if (normalizeRole(user.role) !== "agent") return;
  if (typeof fields.assigneeId === "string" && fields.assigneeId !== user.id) {
    throw new HttpError(403, "forbidden", "Agents can assign a new ticket only to themselves or to their own team");
  }
  if (typeof fields.assigneeTeamId === "number") {
    const [m] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, fields.assigneeTeamId), eq(teamMembers.userId, user.id)))
      .limit(1);
    if (!m) {
      throw new HttpError(403, "forbidden", "Agents can assign a new ticket only to themselves or to their own team");
    }
  }
}
