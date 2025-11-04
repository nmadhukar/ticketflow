import { z } from "zod";

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
] as const;

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    status: z
      .enum(["open", "in_progress", "resolved", "closed", "on_hold"])
      .optional(),
    notes: z.string().optional(),
    assigneeId: z.union([z.string(), z.number()]).nullable().optional(),
    assigneeType: z.enum(["user", "team"]).optional(),
    assigneeTeamId: z.union([z.string(), z.number()]).nullable().optional(),
    dueDate: z.string().optional(),
    departmentId: z.union([z.string(), z.number()]).optional(),
    teamId: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

type UpdatePayload = z.infer<typeof updateTaskSchema>;

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

function deriveAllowedFields(role?: string): ReadonlyArray<string> {
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
    ];
  if (role === "agent")
    return [
      "title",
      "description",
      "priority",
      "status",
      "notes",
      "assigneeId",
      "assigneeType",
      "assigneeTeamId",
      "dueDate",
    ];
  // customer: keep small surface
  return ["title", "description", "notes", "dueDate"];
}

export async function canUpdateTicket({
  user,
  ticket,
  payload,
}: CanUpdateArgs): Promise<Verdict<UpdatePayload>> {
  const role = user?.role;

  // Basic ownership rule for customers
  if (
    role === "customer" &&
    ticket?.createdBy !== (user?.id || user?.claims?.sub)
  ) {
    return {
      allowed: false,
      reason: "Customers may only edit their own tickets",
    };
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
    // Restrict status changes for customers
    delete base.status;
    delete base.priority; // optional stricter policy
  }

  try {
    const prunedPayload = updateTaskSchema.partial().parse(base);
    if (Object.keys(prunedPayload).length === 0) {
      return { allowed: false, reason: "No allowed fields to update" };
    }

    return { allowed: true, prunedPayload };
  } catch (e: any) {
    return { allowed: false, reason: e?.message || "Invalid payload" };
  }
}

interface CanDeleteArgs {
  user: any;
  ticket: any;
}

export function canDeleteTicket({ user }: CanDeleteArgs): Verdict<void> {
  const role = user?.role;
  if (role === "admin") return { allowed: true };
  const allowManager =
    String(process.env.ALLOW_MANAGER_DELETE || "false").toLowerCase() ===
    "true";
  if (role === "manager" && allowManager) return { allowed: true };
  return { allowed: false, reason: "Only administrators can delete tickets" };
}

import { storage } from "../storage";

type User = {
  id: string;
  role: string;
};

const IMMUTABLE_FIELDS = new Set([
  "id",
  "ticketNumber",
  "createdBy",
  "createdAt",
  "updatedAt",
]);

export async function getTicketMetaForUser(user: User, task: any | null) {
  // Compute simple permissions similar to /api/tickets/meta
  const base = {
    allowedFields: [] as string[],
    allowedAssigneeTypes: [] as string[],
  };

  if (user.role === "admin") {
    base.allowedAssigneeTypes = ["user", "team"];
    base.allowedFields = [
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
    ];
  } else if (user.role === "manager") {
    base.allowedAssigneeTypes = ["user", "team"];
    base.allowedFields = [
      "title",
      "description",
      "priority",
      "status",
      "notes",
      "dueDate",
      "assigneeType",
      "assigneeId",
      "assigneeTeamId",
    ];
  } else if (user.role === "agent") {
    base.allowedAssigneeTypes = ["user", "team"];
    base.allowedFields = ["status", "priority", "dueDate", "notes"];
    if (task) {
      const myTeams = await storage.getUserTeams(user.id);
      const isAssigneeUser =
        task.assigneeType === "user" && task.assigneeId === user.id;
      const isInTicketTeam =
        task.assigneeType === "team" && task.assigneeTeamId
          ? (myTeams || []).some((t: any) => t.id === task.assigneeTeamId)
          : false;
      if (isAssigneeUser) {
        base.allowedFields.push("assigneeType", "assigneeId", "assigneeTeamId");
      }
      if (!isAssigneeUser && !isInTicketTeam) {
        base.allowedFields = [];
      }
    }
  } else if (user.role === "customer") {
    base.allowedAssigneeTypes = ["team"]; // only on create
    base.allowedFields = ["title", "description"];
  }

  return base;
}

export async function canUpdateTicket(args: {
  user: User;
  ticket: any;
  payload: any;
}): Promise<{ allowed: boolean; prunedPayload: any; reason?: string }> {
  const { user, ticket, payload } = args;
  const meta = await getTicketMetaForUser(user, ticket);

  // Customers can only edit own tickets
  if (user.role === "customer" && ticket.createdBy !== user.id) {
    return { allowed: false, prunedPayload: {}, reason: "customer_not_owner" };
  }

  // Prune immutable fields
  const inputKeys = Object.keys(payload || {});
  const pruned: any = {};
  for (const key of inputKeys) {
    if (IMMUTABLE_FIELDS.has(key)) continue;
    pruned[key] = payload[key];
  }

  if (user.role === "admin") {
    return { allowed: true, prunedPayload: pruned };
  }

  // For non-admins, restrict to meta.allowedFields
  const filtered: any = {};
  for (const key of Object.keys(pruned)) {
    if (meta.allowedFields.includes(key)) filtered[key] = pruned[key];
  }

  // If nothing remains, deny
  if (Object.keys(filtered).length === 0) {
    return { allowed: false, prunedPayload: {}, reason: "no_allowed_fields" };
  }

  // Assignment restrictions for non-admins
  if (
    "assigneeType" in filtered ||
    "assigneeId" in filtered ||
    "assigneeTeamId" in filtered
  ) {
    const myTeams = await storage.getUserTeams(user.id);
    const isAssigneeUser =
      ticket.assigneeType === "user" && ticket.assigneeId === user.id;
    if (!isAssigneeUser) {
      return {
        allowed: false,
        prunedPayload: {},
        reason: "not_current_assignee",
      };
    }
    if (filtered.assigneeType === "user" && filtered.assigneeId !== user.id) {
      return {
        allowed: false,
        prunedPayload: {},
        reason: "assign_user_not_self",
      };
    }
    if (
      filtered.assigneeType === "team" &&
      filtered.assigneeTeamId &&
      !(myTeams || []).some((t: any) => t.id === filtered.assigneeTeamId)
    ) {
      return {
        allowed: false,
        prunedPayload: {},
        reason: "assign_team_not_member",
      };
    }
  }

  return { allowed: true, prunedPayload: filtered };
}

export function canDeleteTicket(args: { user: User; ticket: any }): {
  allowed: boolean;
  reason?: string;
} {
  const { user } = args;
  if (user.role === "admin") return { allowed: true };
  const managerAllowed = process.env.ALLOW_MANAGER_DELETE === "true";
  if (user.role === "manager" && managerAllowed) return { allowed: true };
  if (user.role === "customer")
    return { allowed: false, reason: "customer_cannot_delete" };
  return { allowed: false, reason: "not_authorized" };
}
