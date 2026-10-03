### Reassignment and Escalation

**Gap**

- Tickets can be updated but reassignment rules/history are minimal. No explicit escalation rules applied.

**Requirements**

- Allow reassignment within same team (to another user) and reroute to another team (if role permits).
- Maintain task history on reassignment (from, to, actor, timestamp).
- Optionally apply escalation rules (existing `escalation_rules` table) in the future.

**Approach**

1. API
   - PATCH `/api/tasks/:id/assign` with payload `{ assigneeId | teamId }`.
   - Validate permissions: agent can assign to self or team they belong to; manager/admin broader.
   - Write a `taskHistory` entry detailing reassignment.
2. UI
   - Add "Assign to me" and "Reassign" actions with scoped options.

**Acceptance Criteria**

- History reflects all reassignments and reroutes.
- Unauthorized reroutes are blocked with 403.

**Risks/Notes**

- Ensure concurrency safety (optimistic UI ok; server is source of truth).
