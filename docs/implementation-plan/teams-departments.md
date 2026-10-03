### Teams and Departments Relationship

**Gap**

- `teams` are not linked to `departments`; manager scoping and customer routing validation need this linkage.

**Requirements**

- Each team optionally belongs to a department: `teams.departmentId`.
- Departments can have a `managerId` who has visibility and management rights over teams in that department.

**Approach**

1. DB Migration
   - Add `teams.department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL`.
   - Add indexes: `idx_teams_department`.
2. ORM
   - Update `shared/schema.ts` for `teams` and relations.
3. API
   - Update team creation/update to accept/validate `departmentId`.
   - Expose department on team payloads.
4. UI
   - When creating/editing a team, allow selecting a department.
5. Manager Scope
   - Resolve manager’s visible teams via departments they manage.

**Acceptance Criteria**

- Teams can be created/updated with a department.
- Managers see teams and tickets only for their departments.

**Risks/Notes**

- Data migration: backfill existing teams with null department, or map as appropriate.
