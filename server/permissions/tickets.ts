import { ZodError } from "zod";
import { normalizeRole, type Role } from "./roles";
import { canAccessTask } from "./ticketAccess";
import { HttpError } from "../http/errors";
import { STAFF_ONLY_TICKET_FIELDS, updateTicketSchema, type UpdateTicketInput } from "../services/tickets/schemas";
import { allowedNextStatuses, type Status } from "./workflow";

// Fields allowed to be updated in principle (subset will be applied per role)
export const updatableFields = [
  "title",
  "description",
  "category",
  "priority",
  "status",
  "notes",
  "assigneeId",
  "assigneeType",
  "assigneeTeamId",
  "dueDate",
  "departmentId",
  "teamId",
  "tags",
  "estimatedHours",
  "actualHours",
] as const;


type UpdatePayload = UpdateTicketInput;

interface CanUpdateArgs {
  user: any;
  ticket: any;
  payload: Record<string, unknown>;
}

interface Verdict<T = any> {
  allowed: boolean;
  reason?: string;
  prunedPayload?: T;
}

/** The one list of fields PATCH accepts per role; the meta route reports it too. */
export function deriveAllowedFields(role: Role): ReadonlyArray<string> {
  if (role === "admin") return [...updatableFields];
  if (role === "manager")
    return [
      "title",
      "description",
      "category",
      "priority",
      "status",
      "notes",
      "assigneeId",
      "assigneeType",
      "assigneeTeamId",
      "dueDate",
      "departmentId",
      "teamId",
      "tags",
      "estimatedHours",
      "actualHours",
    ];
  if (role === "agent") return ["priority", "status", "notes", "estimatedHours", "actualHours"];
  // customer: small surface. status is the reopen move only (assertTransition refuses the rest).
  return ["title", "description", "notes", "status"];
}

/**
 * Access + role field table. The ticket must be inside the user's scope
 * (ticketVisibilityWhere: an agent only on tickets they can see, a manager only
 * on tickets of the departments they manage or their own); then the payload is
 * pruned to the fields the role may change.
 */
export async function canUpdateTicket({
  user,
  ticket,
  payload,
}: CanUpdateArgs): Promise<Verdict<UpdatePayload>> {
  const role = normalizeRole(user?.role);
  const userId: unknown = user?.id;
  if (!role || typeof userId !== "string") {
    return { allowed: false, reason: "Unknown role" };
  }
  if (typeof ticket?.id !== "number" || !(await canAccessTask({ id: userId, role }, ticket.id))) {
    return { allowed: false, reason: "This ticket is outside your scope" };
  }

  // Ruling R3: effort hours are staff-only. A customer naming them is refused,
  // not silently pruned.
  if (
    role === "customer" &&
    STAFF_ONLY_TICKET_FIELDS.some((f) => payload && (payload as any)[f] !== undefined)
  ) {
    return { allowed: false, reason: "Only staff can set estimated or actual hours" };
  }

  // Remove immutable/unknown fields and validate shape
  const allowedFields = new Set(deriveAllowedFields(role));
  const base: Record<string, unknown> = {};
  for (const key of Object.keys(payload || {})) {
    if (allowedFields.has(key)) {
      base[key] = (payload as any)[key];
    }
  }

  // Customers cannot change assignment
  if (role === "customer") {
    delete base.assigneeId;
    delete base.assigneeType;
    delete base.assigneeTeamId;
    delete base.category; // ensure routing/category not hijacked by customer edits
    delete base.departmentId;
    delete base.teamId;
    // status stays: assertTransition lets a customer reopen their own ticket and nothing else
    delete base.priority; // optional stricter policy
    delete base.dueDate;
  }

  try {
    const prunedPayload = updateTicketSchema.partial().parse(base);
    if (Object.keys(prunedPayload).length === 0) {
      return { allowed: false, reason: "No allowed fields to update" };
    }

    return { allowed: true, prunedPayload };
  } catch (e: any) {
    // Bad values are a 400 with field details (the route hands ZodError to the error contract).
    if (e instanceof ZodError) throw e;
    return { allowed: false, reason: e?.message || "Invalid payload" };
  }
}

/**
 * Keep assignee_type, assignee_id and assignee_team_id consistent on update, so
 * a reassignment leaves no stale column behind (mutates `updates`):
 * - assigneeType "team" clears assigneeId; "user" clears assigneeTeamId;
 * - no type but a non-null assigneeId (or assigneeTeamId) sets the type to
 *   user (or team) and clears the other column;
 * - no type and both ids non-null is ambiguous: 400 validation_failed.
 */
export function normalizeAssigneeUpdate(updates: Record<string, unknown>): void {
  let type = updates.assigneeType;
  if (type === undefined || type === null) {
    const hasUser = updates.assigneeId !== undefined && updates.assigneeId !== null;
    const hasTeam = updates.assigneeTeamId !== undefined && updates.assigneeTeamId !== null;
    if (hasUser && hasTeam) {
      throw new HttpError(
        400,
        "validation_failed",
        "Give assigneeType when setting both assigneeId and assigneeTeamId"
      );
    }
    if (!hasUser && !hasTeam) return;
    type = hasUser ? "user" : "team";
    updates.assigneeType = type;
  }
  if (type === "team") updates.assigneeId = null;
  if (type === "user") updates.assigneeTeamId = null;
}

interface CanDeleteArgs {
  user: any;
  ticket: any;
}

export function canDeleteTicket({ user }: CanDeleteArgs): Verdict<void> {
  const role = normalizeRole(user?.role);
  if (role === "admin") return { allowed: true };
  const allowManager =
    String(process.env.ALLOW_MANAGER_DELETE || "false").toLowerCase() ===
    "true";
  if (role === "manager" && allowManager) return { allowed: true };
  return { allowed: false, reason: "Only administrators can delete tickets" };
}

/**
 * What this caller may do on this ticket, derived from the same rules PATCH
 * enforces: the field table (deriveAllowedFields) and the status workflow
 * (allowedNextStatuses). No second list.
 */
export function getTicketMetaForUser(user: { id: string; role: unknown }, task: any | null) {
  const role = normalizeRole(user?.role);
  const out = {
    allowedFields: [] as string[],
    allowedAssigneeTypes: [] as string[],
    allowedStatuses: [] as string[],
  };
  if (!role) return out;

  out.allowedStatuses = task
    ? allowedNextStatuses(role, (task.status || "open") as Status, task.createdBy === user.id)
    : [];
  out.allowedFields = deriveAllowedFields(role).filter(
    (f) => f !== "status" || out.allowedStatuses.length > 0
  );
  if (role === "admin" || role === "manager") out.allowedAssigneeTypes = ["user", "team"];
  return out;
}
