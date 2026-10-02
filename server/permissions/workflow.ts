import { TICKET_STATUSES } from "@shared/constants";
import { STAFF_TRANSITIONS } from "@shared/workflow";
import { HttpError } from "../http/errors";
import { normalizeRole, type Role } from "./roles";

/** Owner decision 2026-10-01. The table lives in shared/workflow.ts so the client menu uses the same one. */
export const STATUSES = TICKET_STATUSES;
export type Status = (typeof STATUSES)[number];
export { STAFF_TRANSITIONS };

/** Statuses a caller may move a ticket to from `from`. A customer may only reopen their own resolved/closed ticket. */
export function allowedNextStatuses(role: Role | null, from: Status, isCreator: boolean): Status[] {
  if (role === "admin" || role === "manager" || role === "agent") return [...STAFF_TRANSITIONS[from]];
  if (role === "customer" && isCreator && (from === "resolved" || from === "closed")) return ["open"];
  return [];
}

/**
 * Throws unless the move is allowed. Same status is a no-op (callers drop it).
 * A customer outside the reopen rule gets 403 forbidden; a staff move the
 * table does not list is 409 invalid_transition.
 */
export function assertTransition(role: Role | string | null, from: Status, to: Status, isCreator: boolean): void {
  if (from === to) return;
  const r = normalizeRole(role);
  if (r === "customer") {
    if (!allowedNextStatuses(r, from, isCreator).includes(to)) {
      throw new HttpError(403, "forbidden", "Customers may only reopen their own resolved or closed ticket");
    }
    return;
  }
  if (!r) throw new HttpError(403, "forbidden", "Unknown role");
  if (!STAFF_TRANSITIONS[from]?.includes(to)) {
    throw new HttpError(409, "invalid_transition", `Cannot move a ticket from ${from} to ${to}`);
  }
}
