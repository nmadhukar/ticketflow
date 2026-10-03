### Notifications for Creation and Reassignment

**Gap**

- Teams/Microsoft integration exists, but no explicit notifications to target teams on create or reassignment.

**Requirements**

- On ticket creation (customer or agent), notify the target team.
- On reassignment (user-to-user or team reroute), notify the new target.

**Approach**

1. Event Hooks
   - After `createTask`, emit `ticket.created` with payload (id, teamId, createdBy, priority, title).
   - After reassignment, emit `ticket.reassigned` with (id, from, to, actor).
2. Integrations
   - Send Microsoft Teams webhook/message if configured.
   - Placeholder for email/SMS if needed.
3. Preferences
   - Respect user/team notification preferences when available.

**Acceptance Criteria**

- Team channel receives a message on new ticket to its queue.
- New assignee (user or team) receives notification on reassignment.

**Risks/Notes**

- Ensure idempotency and error isolation (log but don’t fail main request).
