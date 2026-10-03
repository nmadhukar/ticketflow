### Roles and RBAC Alignment

**Gap**

- Server RBAC lacks explicit `manager` permissions; UI and seeds recognize manager. `agent` vs `user` naming is inconsistent.

**Requirements**

- Define `manager` role with permissions to manage departments/teams they own and view their groups’ tickets.
- Align role names across UI, seeds, protected routes, and server RBAC.

**Approach**

1. RBAC
   - Add `managerPermissions` including:
     - read/manage: team, department (scoped to managed departments)
     - read: ticket (scoped to managed departments’ teams)
     - assign/update: ticket within scope
   - Update `requirePermission` usages for admin/manager endpoints.
2. Routing Guards
   - Ensure `ProtectedRoute` uses consistent roles and includes `manager` where appropriate.
3. Consistency
   - Decide on `agent` vs `user` naming; prefer `agent` for tech support. Update seeds, UI labels, and allowed roles arrays.
4. Tests
   - Add unit/integration tests for manager access paths.

**Acceptance Criteria**

- Manager-only screens are accessible to managers; forbidden to others.
- Manager can read tickets within department scope; cannot read outside.

**Risks/Notes**

- Edge cases for users with multiple roles (prefer single role per user).
