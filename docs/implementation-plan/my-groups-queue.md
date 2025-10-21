### "My Groups" Queue (Team Union View)

**Gap**

- No dedicated view/API for tech support to monitor all team queues they belong to.

**Requirements**

- Provide a consolidated queue of tickets where `assigneeTeamId IN userTeamIds`, including unassigned-to-user tickets.

**Approach**

1. API
   - GET `/api/tasks/my-groups`: returns tickets scoped to `effectiveTeamIds` with standard filters and pagination.
2. Client
   - Add a "My Groups" tab next to "My Tickets" that calls the new endpoint.
   - Display per-team grouping and allow reassignment/claiming where permitted.

**Acceptance Criteria**

- Agents see a combined queue across all their teams.
- Filtering by status/priority/category works within this scope.

**Risks/Notes**

- Large union sets: ensure pagination and server-side filtering.
