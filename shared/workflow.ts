import { TICKET_STATUSES, type TicketStatus } from "./constants";

/**
 * Staff status moves (owner decision 2026-10-01). Pure data, shared so the
 * client menu offers exactly what the server will accept.
 */
export const STAFF_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "on_hold", "resolved", "closed"],
  in_progress: ["open", "on_hold", "resolved", "closed"],
  on_hold: ["open", "in_progress", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

/**
 * Statuses a caller may move a ticket to. Staff follow STAFF_TRANSITIONS (a stored
 * status outside the vocabulary may go to any valid status); a customer may only
 * reopen their own resolved/closed ticket. The role is already normalised
 * ("user" is agent); anything else gets nothing.
 */
export function allowedNextStatusesFor(
  role: string | null | undefined,
  from: string,
  isCreator: boolean
): TicketStatus[] {
  if (role === "admin" || role === "manager" || role === "agent") {
    return [...(STAFF_TRANSITIONS[from as TicketStatus] ?? TICKET_STATUSES)];
  }
  if (role === "customer" && isCreator && (from === "resolved" || from === "closed")) return ["open"];
  return [];
}
