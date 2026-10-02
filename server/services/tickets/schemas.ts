import { z } from "zod";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
} from "@shared/constants";

/**
 * Request schemas for creating and updating a ticket. Statuses, priorities and
 * categories are closed sets: a value outside them is a 400, never stored.
 */

/** A numeric id that may arrive as a string (multipart forms send everything as text). */
const numericId = z.preprocess(
  (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v),
  z.number().int().positive().nullable().optional()
);

/** Hour estimates: whole, non-negative; blank string reads as absent (multipart). */
const hours = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v),
  z.number().int().min(0).max(100000).nullable().optional()
);

const dueDate = z.preprocess(
  (v) => (v === "" ? null : v),
  z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Must be a valid date")
    .nullable()
    .optional()
);

/** Multipart sends arrays as a JSON string (the client does JSON.stringify); a bare comma string is ambiguous and stays invalid. */
const tags = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : v;
    } catch {
      return v;
    }
  },
  z.array(z.string().trim().min(1).max(50)).max(20).optional()
);

/** A blank assignee id is no assignee (never reaches the FK). */
const assigneeUserId = z.preprocess((v) => (v === "" ? undefined : v), z.string().nullable().optional());

const idLikeLoose = z.union([z.string(), z.number()]).nullable().optional();

/**
 * Create body. Strict: server-owned fields (status, resolvedAt, closedAt,
 * createdBy, ticketNumber, timestamps) are rejected, not ignored. departmentId
 * and teamId are routing hints the customer flow reads; they are not columns.
 */
export const createTicketSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(255),
    description: z.string().nullable().optional(),
    category: z.enum(TICKET_CATEGORIES),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    severity: z.enum(TICKET_SEVERITIES).optional(),
    notes: z.string().nullable().optional(),
    assigneeId: assigneeUserId,
    assigneeType: z.enum(["user", "team"]).optional(),
    assigneeTeamId: numericId,
    departmentId: numericId,
    teamId: numericId,
    dueDate,
    tags,
    estimatedHours: hours,
    actualHours: hours,
  })
  .strict();

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/** Update body (every field optional). Which fields a role may send is decided in permissions/tickets.ts. */
export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(1, "Title cannot be empty").max(255).optional(),
    description: z.string().nullable().optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    severity: z.enum(TICKET_SEVERITIES).optional(),
    status: z.enum(TICKET_STATUSES).optional(),
    notes: z.string().nullable().optional(),
    assigneeId: assigneeUserId,
    assigneeType: z.enum(["user", "team"]).optional(),
    assigneeTeamId: numericId,
    dueDate,
    tags,
    estimatedHours: hours,
    actualHours: hours,
    departmentId: idLikeLoose,
    teamId: idLikeLoose,
  })
  .strict();

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

/** Fields only staff may set (ruling R3). */
export const STAFF_ONLY_TICKET_FIELDS = ["estimatedHours", "actualHours"] as const;
