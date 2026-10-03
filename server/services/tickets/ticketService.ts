import { z } from "zod";
import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { insertTaskCommentSchema, insertTaskSchema, tasks, type User } from "@shared/schema";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "@shared/constants";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { assertTaskAccess, assignedToUserSql, ticketVisibilityWhere } from "../../permissions/ticketAccess";
import { canDeleteTicket, canUpdateTicket, normalizeAssigneeUpdate } from "../../permissions/tickets";
import { containsPattern } from "../../utils/like";
import { projectUserForViewer } from "../../utils/publicUser";
import { assertAgentMayAssign, assertAssigneesExist } from "./assignees";
import { commentBodySchema } from "./commentSchema";
import { createTicketRecord, runTicketCreatedHooks } from "./create";
import { STAFF_ONLY_TICKET_FIELDS, createTicketSchema } from "./schemas";
import { afterTicketUpdated, isReassignment, notifyCommentAdded, notifyTicketDeleted, recipientsNow } from "./notifier";
import { toCommentDTO, toTicketDTO, type CommentDTO, type TicketDTO } from "./serializers";
import { TicketError, guard } from "./ticketError";
import { defaultTriageAssignment } from "./triage";
import { HttpError } from "../../http/errors";

export { TicketError } from "./ticketError";
export type { TicketDTO, CommentDTO } from "./serializers";

/**
 * The one place ticket rules live. REST handlers and MCP tools are adapters over
 * these functions; the rules themselves stay in the modules imported above
 * (schemas, assignees, permissions/*, storage). Expected refusals are thrown as
 * TicketError (VALIDATION, NOT_FOUND, FORBIDDEN, INVALID_STATE).
 */

export interface ListQuery {
  status?: string;
  priority?: string;
  category?: string;
  assigneeId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export const LIST_DEFAULT_LIMIT = 25;
export const LIST_MAX_LIMIT = 100;

/** Context only REST has (the request origin, the audit log); MCP passes nothing. */
export interface WriteContext {
  /** Site origin for links in Teams messages; null means no link. */
  actionBaseUrl?: string | null;
  /** Called when a requested status change is refused (403 or 409), for the security audit log. */
  onStatusRefusal?: (info: { from: string; to: unknown; taskId: number }) => void;
}

function assertId(id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new TicketError("VALIDATION", "id must be a positive integer", {
      formErrors: [],
      fieldErrors: { id: ["Must be a positive integer"] },
    });
  }
}

function fieldError(field: string, message: string): TicketError {
  return new TicketError("VALIDATION", message, { formErrors: [], fieldErrors: { [field]: [message] } });
}

function badRequest(message: string): HttpError {
  return new HttpError(400, "validation_failed", message);
}

/**
 * The customer's routing choice (a user, a team, a department only, or nothing) turned into
 * the assignment columns. REST and MCP share it. A customer with no user or team assignee
 * (nothing chosen, or a department only) goes to DEFAULT_TRIAGE_TEAM_ID when that is set (R36).
 * Department-only tickets are triaged too, by owner decision: no user or team assignee means
 * only admins could see them, which is the M2 problem. The department hint is kept as given.
 * Mutates and returns `fields`.
 */
async function applyCustomerRouting(fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { assigneeType, assigneeId } = fields;
  const teamId = (fields.teamId as number | null | undefined) ?? undefined;
  const departmentId = (fields.departmentId as number | null | undefined) ?? undefined;

  if (assigneeType === "user") {
    if (!assigneeId) throw badRequest("assigneeId is required for user assignment");
    fields.assigneeId = String(assigneeId);
    fields.assigneeTeamId = null;
    fields.teamId = undefined;
  } else if (assigneeType === "team" || teamId) {
    if (!teamId) throw badRequest("teamId is required for team assignment");
    const team = await storage.getTeam(teamId);
    if (!team) throw badRequest("Invalid team");
    if (departmentId) {
      const dept = await storage.getDepartmentById(departmentId);
      if (!dept || (dept as { isActive?: boolean }).isActive === false) {
        throw badRequest("Invalid or inactive department");
      }
      const teamDept = (team as { departmentId?: number | null }).departmentId;
      if (teamDept && teamDept !== departmentId) {
        throw badRequest("Team does not belong to the selected department");
      }
    }
    fields.assigneeType = "team";
    fields.assigneeTeamId = teamId;
    fields.assigneeId = null;
    const teamDept = (team as { departmentId?: number | null }).departmentId;
    if (!departmentId && teamDept) fields.departmentId = teamDept;
  } else {
    if (departmentId) {
      const dept = await storage.getDepartmentById(departmentId);
      if (!dept || (dept as { isActive?: boolean }).isActive === false) {
        throw badRequest("Invalid or inactive department");
      }
      // Department-only routing: clear team and assignee fields
      fields.teamId = null;
    } else {
      // Unassigned: clear all assignment fields
      fields.departmentId = null;
      fields.teamId = null;
    }
    fields.assigneeId = null;
    fields.assigneeTeamId = null;
    const triage = await defaultTriageAssignment();
    if (triage) Object.assign(fields, triage);
  }
  return fields;
}

/**
 * Validation and assignee rules for a new ticket, with no write. Returns the
 * final field set (a customer's routing already applied), ready for createTicket
 * through `opts.prepared`, so REST validates before it uploads attachments and
 * does not do the work twice.
 */
export async function prepareTicketCreate(user: User, input: unknown): Promise<Record<string, unknown>> {
  return guard(async () => {
    // Server-owned fields (status, resolvedAt, closedAt, createdBy, ticketNumber) are rejected.
    const submitted = createTicketSchema.parse(input ?? {});
    const isCustomer = user.role === "customer";
    if (isCustomer) {
      // Ruling R3: effort hours are staff-only.
      const staffOnly = STAFF_ONLY_TICKET_FIELDS.filter((f) => submitted[f] !== undefined);
      if (staffOnly.length > 0) {
        throw new TicketError("VALIDATION", "Only staff can set estimated or actual hours", {
          formErrors: [],
          fieldErrors: Object.fromEntries(staffOnly.map((f) => [f, ["Staff only"]])),
        });
      }
    }
    // A customer's routing choice becomes the assignment first; then one assignee kind,
    // the assignee exists, and ruling R16 for agents.
    const fields: Record<string, unknown> = { ...submitted };
    if (isCustomer) await applyCustomerRouting(fields);
    normalizeAssigneeUpdate(fields);
    await assertAssigneesExist(fields);
    await assertAgentMayAssign({ id: user.id, role: user.role }, fields);
    return fields;
  });
}

export async function createTicket(
  user: User,
  input: unknown,
  opts: { runHooks?: boolean; actionBaseUrl?: string | null; prepared?: Record<string, unknown> } = {}
): Promise<TicketDTO> {
  const fields = opts.prepared ?? (await prepareTicketCreate(user, input));
  const task = await guard(() => createTicketRecord(fields, user.id));
  if (opts.runHooks !== false) {
    await runTicketCreatedHooks(task, user.id, opts.actionBaseUrl ?? null);
  }
  return toTicketDTO(task);
}

export async function getTicket(
  user: User,
  id: number,
  opts: { includeComments?: boolean } = {}
): Promise<TicketDTO> {
  assertId(id);
  return guard(async () => {
    await assertTaskAccess(user, id);
    const task = await storage.getTask(id);
    if (!task) throw new TicketError("NOT_FOUND", "Ticket not found");
    if (!opts.includeComments) return toTicketDTO(task);
    const comments = await storage.getTaskComments(id);
    // R19: the commenter is shown to this viewer the way GET .../comments shows them.
    return toTicketDTO({
      ...task,
      comments: comments.map((c) => ({
        ...c,
        user: c.user ? projectUserForViewer(user.role, c.user) : undefined,
      })),
    });
  });
}

const listQuerySchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    assigneeId: z.string().trim().min(1).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

/**
 * Tickets the user may see (ticketVisibilityWhere), narrowed by filters, newest
 * first with the id as tie-break so paging by offset reaches every row exactly
 * once. `total` counts ALL matching visible rows, not the page. A filter value
 * outside the closed sets is VALIDATION, never zero rows.
 */
export async function listTickets(
  user: User,
  q: ListQuery
): Promise<{ tickets: TicketDTO[]; limit: number; offset: number; returned: number; hasMore: boolean; total: number }> {
  return guard(async () => {
    // An absent filter may arrive as null/"" from a client: treat as not given.
    const cleaned = Object.fromEntries(
      Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
    );
    const { status, priority, category, assigneeId, search, limit, offset } = listQuerySchema.parse(cleaned);

    const filters: SQL[] = [ticketVisibilityWhere(user)];
    if (status) filters.push(eq(tasks.status, status));
    if (priority) filters.push(eq(tasks.priority, priority));
    if (category) filters.push(eq(tasks.category, category));
    if (assigneeId) filters.push(sql`(${assignedToUserSql} AND ${tasks.assigneeId} = ${assigneeId})`);
    if (search) {
      filters.push(
        or(ilike(tasks.title, containsPattern(search)), ilike(tasks.description, containsPattern(search)))!
      );
    }
    const where = and(...filters);

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(where);
    // M9: the page and its joined names in ONE query (not one getTask per row).
    const rows = await storage.getTaskPage(where, limit, offset);
    const page = rows.map((r) => toTicketDTO(r));
    return {
      tickets: page,
      limit,
      offset,
      returned: page.length,
      hasMore: offset + rows.length < n,
      total: n,
    };
  });
}

/**
 * Update by the same verdict PATCH has always used: access, the role's field
 * table and the status workflow (canUpdateTicket), then a status write that is
 * conditional on the status the workflow checked (409 if it changed meanwhile).
 * `appliedFields` are the columns written; `ignoredFields` are the submitted
 * keys the role may not set (or a status equal to the current one).
 */
export async function updateTicket(
  user: User,
  id: number,
  patch: unknown,
  ctx: WriteContext = {}
): Promise<{ ticket: TicketDTO; appliedFields: string[]; ignoredFields: string[] }> {
  assertId(id);
  return guard(async () => {
    await assertTaskAccess(user, id);
    const task = await storage.getTask(id);
    if (!task) throw new TicketError("NOT_FOUND", "Ticket not found");
    const payload = (patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}) as Record<
      string,
      unknown
    >;

    const refused = (to: unknown) => {
      if (payload.status === undefined) return;
      try {
        ctx.onStatusRefusal?.({ from: task.status, to, taskId: id });
      } catch {
        /* best-effort: audit logging must not mask the refusal */
      }
    };

    let verdict;
    try {
      // assertTaskAccess above is the one access check; the verdict need not repeat it.
      verdict = await canUpdateTicket({ user, ticket: task, payload, accessChecked: true });
    } catch (e) {
      // An illegal staff transition (409): audited like a refusal.
      if (e instanceof Object && (e as { status?: number }).status === 409) refused(payload.status);
      throw e;
    }
    if (!verdict.allowed) {
      refused(payload.status);
      throw new TicketError("FORBIDDEN", verdict.reason ?? "Access denied");
    }

    const pruned = (verdict.prunedPayload ?? {}) as Record<string, unknown>;
    const ignoredFields = Object.keys(payload).filter((k) => !(k in pruned));
    // A same-status request was dropped: nothing left to write.
    if (Object.keys(pruned).length === 0) {
      return { ticket: toTicketDTO(task), appliedFields: [], ignoredFields };
    }

    const updates = insertTaskSchema.partial().parse(pruned) as Record<string, unknown>;
    // A reassignment clears the other assignee column (no stale scope).
    normalizeAssigneeUpdate(updates);
    await assertAssigneesExist(updates);

    // A reassignment changes who can see the ticket: whoever could see it before must hear about it too.
    const reassigns = isReassignment(updates);
    const recipientsBefore = reassigns ? await recipientsNow(id) : [];
    const updatedTask = await storage.updateTask(
      id,
      updates,
      user.id,
      updates.status !== undefined ? { expectedStatus: task.status } : undefined
    );

    await afterTicketUpdated({
      ticketId: id,
      before: task,
      updatedTask,
      updates,
      actorId: user.id,
      recipientsBefore,
      reassigns,
      actionBaseUrl: ctx.actionBaseUrl ?? null,
    });

    return {
      ticket: toTicketDTO(updatedTask),
      appliedFields: Object.keys(updates).filter((k) => updates[k] !== undefined),
      ignoredFields,
    };
  });
}

/**
 * A status move asked for by name (close, reopen). Access and the workflow are updateTicket's verdict
 * (FORBIDDEN for a customer closing, 409 for an illegal staff move); a ticket already in the target
 * status is not a no-op success but INVALID_STATE, so a caller that closes twice is told.
 */
async function moveStatus(user: User, id: number, status: "closed" | "open", ctx: WriteContext): Promise<TicketDTO> {
  const { ticket, appliedFields } = await updateTicket(user, id, { status }, ctx);
  if (!appliedFields.includes("status")) {
    throw new TicketError("INVALID_STATE", `Ticket is already ${status}`);
  }
  return ticket;
}

/** Staff close a ticket (the workflow decides which moves are legal). Closing a closed ticket is INVALID_STATE. */
export async function closeTicket(user: User, id: number, ctx: WriteContext = {}): Promise<TicketDTO> {
  return moveStatus(user, id, "closed", ctx);
}

/** Staff, or the customer who created it, reopen a resolved or closed ticket (back to open). */
export async function reopenTicket(user: User, id: number, ctx: WriteContext = {}): Promise<TicketDTO> {
  return moveStatus(user, id, "open", ctx);
}

/** Admin only (manager only with ALLOW_MANAGER_DELETE). `confirm` must be literally true. */
export async function deleteTicket(
  user: User,
  id: number,
  confirm: boolean
): Promise<{ deleted: true; id: number; ticketNumber: string }> {
  assertId(id);
  return guard(async () => {
    await assertTaskAccess(user, id);
    const task = await storage.getTask(id);
    if (!task) throw new TicketError("NOT_FOUND", "Ticket not found");
    const verdict = canDeleteTicket({ user, ticket: task });
    if (!verdict.allowed) throw new TicketError("FORBIDDEN", verdict.reason ?? "Access denied");
    if (confirm !== true) throw fieldError("confirm", "Deleting a ticket is permanent: pass confirm: true");
    // Who could see it must be read before the row is gone.
    const recipients = await recipientsNow(id);
    await storage.deleteTask(id);
    await notifyTicketDeleted(id, recipients);
    return { deleted: true, id, ticketNumber: task.ticketNumber };
  });
}

export async function addComment(user: User, id: number, content: unknown): Promise<CommentDTO> {
  assertId(id);
  return guard(async () => {
    await assertTaskAccess(user, id);
    // The body is only `content`; ticket and author come from the caller. Trimmed, 1..10000 characters.
    const body = commentBodySchema.parse({ content });
    const data = insertTaskCommentSchema.parse({ content: body.content, taskId: id, userId: user.id });
    const comment = await storage.addTaskComment(data);
    await notifyCommentAdded(id);
    return toCommentDTO(comment);
  });
}
