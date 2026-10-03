/** One entry from GET /api/tasks/:id/history. */
export interface TicketHistoryItem {
  id: number;
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  createdAt: string;
  user?: { firstName?: string | null; lastName?: string | null } | null;
}

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  priority: "Priority",
  assigneeId: "Assignee",
  assigneeType: "Assignee type",
  assigneeTeamId: "Assigned team",
};

export function historyFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** The text shown next to the actor's name for one history entry. */
export function describeHistoryItem(item: TicketHistoryItem): string {
  if (item.action === "updated" && item.field) {
    // null, undefined and "" all mean "no value"; "0" and "false" are real values and show.
    const show = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : v);
    const from = show(item.oldValue);
    const to = show(item.newValue);
    return `${historyFieldLabel(item.field)}: ${from} → ${to}`;
  }
  return item.action;
}
