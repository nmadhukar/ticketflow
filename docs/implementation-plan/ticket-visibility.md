### Ticket Visibility and Filtering

**Gap**

- Team-based visibility is not enforced on the server. `getTasks` does not consider a user’s team memberships; managers do not have scoped visibility to their groups. A `userIdFilter` hinted in routes is ignored in storage.

**Current State**

- Customers are restricted to their own tickets (`createdBy = userId`).
- Admins effectively see all tickets.
- Assignment fields exist: `assigneeId`, `assigneeType`, `assigneeTeamId`.
- Team membership tables exist; teams currently are not linked to departments (see Teams/Departments plan).

**Requirements**

- Admin: view all tickets.
- Manager: view tickets for teams in departments they manage (after teams link to departments).
- Agent/User (Tech Support): view the union of
  - tickets directly assigned to them, and
  - tickets assigned to any team they belong to (including unassigned-to-user but assigned to their team).
- Customer: view only their own tickets.

**Filters**

- Query params: `status`, `priority`, `category`, `search`, `assigneeId`, `teamId`, `departmentId`, `mine`.
- Enforce that `teamId`/`departmentId` filters are only allowed if the requester is an admin/manager or a member of that team/department; otherwise ignore or return 403.

**Approach**

1. Compute effective visibility scope in `/api/tasks`:
   - Determine `effectiveTeamIds` from `team_members` for the requester.
   - If role = customer: force `createdBy = userId` and ignore `assigneeId`.
   - If role = agent/user: allow where `assigneeId = userId OR assigneeTeamId IN effectiveTeamIds`.
   - If role = manager: allow where `assigneeTeamId IN managerDepartmentTeamIds` (requires teams.departmentId).
   - If role = admin: no restriction.
2. Pass a normalized filter object to storage including: `createdBy`, `assigneeId`, `assigneeTeamIds`, and a `visibilityMode`.
3. Update `storage.getTasks` to apply `WHERE` conditions based on the supplied scope, including support for `teamId`/`departmentId` with permission checks at the route layer.
4. Add endpoint `/api/tasks/my-groups` (optional convenience) that returns tickets for `effectiveTeamIds` only.

**API Changes**

- GET `/api/tasks` supports new filters: `teamId`, `departmentId`, `mine`.
- GET `/api/tasks/my-groups` returns tickets for teams the requester belongs to, including unassigned-to-user tickets.

**DB Changes**

- None for visibility itself; relies on existing `team_members`. Requires teams to have `departmentId` for manager scoping (see related doc).

**Client Changes**

- Add filters in list views: Team, Department, Status, Priority, Assignee, Mine.
- Add a "My Groups" tab/view to show union of team queues.

**Acceptance Criteria**

- Customers never see tickets they didn’t create.
- Agents/Users see tickets for any of their teams and their own assigned tickets.
- Managers see tickets in teams of departments they manage.
- Filtering by team/department is constrained to authorized scopes.

**Risks/Notes**

- Performance: add indexes on `assignee_team_id`, `created_by`, `status`, `updated_at`.
- Ensure pagination and search continue to work with added joins.
