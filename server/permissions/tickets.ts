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

// Note: legacy alt implementations removed to avoid duplicate exports
