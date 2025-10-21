### Customer Ticket Routing (Department/Team Required)

**Gap**

- Customers can create tickets without selecting a Department/Team; routing to a group queue is not enforced.

**Requirements**

- When role = customer:
  - Department selection is required.
  - Team selection within that department is required.
  - Ticket is routed to the team queue: `assigneeType = 'team'`, `assigneeTeamId = teamId`, `assigneeId = NULL`.

**Approach**

1. UI
   - Add required Department select; upon selection, populate Team select with teams in that department.
   - Hide user assignment for customers.
2. Server
   - In POST `/api/tasks`, if `req.user.role === 'customer'`:
     - Validate `departmentId` and `teamId` are provided and active.
     - Validate team belongs to department.
     - Force routing fields as above; ignore provided `assigneeId`.
3. Validation
   - Extend route-level validation to require `departmentId` and `teamId` for customers.

**API Changes**

- POST `/api/tasks`: accept `departmentId`, `teamId` for customer-originated tickets; enforce routing.

**DB Changes**

- Requires `teams.departmentId` FK to validate team within department (see Teams/Departments doc).

**Client Changes**

- Ticket create form: Department (required) → Team (required) cascading selects.

**Acceptance Criteria**

- Customer submissions without department/team are rejected (400).
- Tickets from customers appear in the selected team’s queue as unassigned-to-user.

**Risks/Notes**

- Ensure department/team lists are cached and handle empty departments gracefully.
