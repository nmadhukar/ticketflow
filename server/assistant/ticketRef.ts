import { and, eq } from "drizzle-orm";
import { tasks, type User } from "@shared/schema";

/**
 * People refer to tickets by number ("TKT-2026-0151"); the ticket tools take the numeric id.
 * On the assistant's MCP surface only, a ticket number is resolved to its id first, and only
 * among the tickets this user can see (ticketVisibilityWhere): a ticket they cannot see resolves
 * exactly like one that does not exist, so a number reveals nothing. The resolved id then goes
 * through the unchanged tool, which applies its own access check as always.
 */
export const TICKET_NUMBER = /^TKT-\d{4}-\d{1,10}$/i;

export async function resolveTicketNumber(user: User, value: string): Promise<number | null> {
  // Loaded here, not at import: the module describing the tools must not need the database.
  const [{ db }, { ticketVisibilityWhere }] = await Promise.all([import("../storage/db"), import("../permissions/ticketAccess")]);
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.ticketNumber, value.trim().toUpperCase()), ticketVisibilityWhere(user)))
    .limit(1);
  return row?.id ?? null;
}
