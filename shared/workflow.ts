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

export const WORKFLOW_STATUSES = TICKET_STATUSES;
