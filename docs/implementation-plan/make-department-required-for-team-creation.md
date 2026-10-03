# Make Department Required for Team Creation

## Overview

Make department selection mandatory when creating teams. Update database schema, backend validation, and frontend form to require department selection with role-based filtering (admins see all departments, managers see only their managed departments).

## Changes

### Phase 1: Database Schema Update

- **File**: `shared/schema.ts` (line 96)
  - Change `departmentId` from optional to required
  - Update: `departmentId: integer("department_id").references(() => departments.id).notNull()`
  - This makes the field non-nullable in the database

### Phase 2: Schema Validation Update

- **File**: `shared/schema.ts` (around line 509)
  - Update `insertTeamSchema` to require `departmentId`
  - Ensure Zod validation enforces `departmentId` as a required field
  - May need to check if `insertTeamSchema` uses `createInsertSchema` and adjust accordingly

### Phase 3: Create Database Migration

- **File**: New migration file (to be generated via CLI)
  - Add SQL to make `department_id` NOT NULL in `teams` table
  - Handle existing NULL values (either delete teams without departments or assign them to a default department)
  - Migration should be created manually using `npm run db:generate` then edited

### Phase 4: Backend Validation and Permission Check

- **File**: `server/routes/teams.ts` (POST /api/teams endpoint, around line 146)
  - Add validation to ensure `departmentId` is provided in request body
  - Add permission check: Verify user can assign teams to the selected department
    - Admins: Can assign to any department
    - Managers: Can only assign to departments they manage
  - Return 403 if manager tries to assign to a department they don't manage
  - Validate that the department exists and is active

### Phase 5: Add Department Fetching Endpoint (if needed)

- **File**: `server/routes/teams.ts` or `server/routes/index.ts`
  - Create endpoint `GET /api/teams/departments` for role-based department list
  - **For admins**: Return all active departments
  - **For managers**: Return only departments where `departments.managerId = userId`
  - **For agents**: Return empty array or 403 (agents typically can't create teams)
  - This endpoint provides filtered departments for the dropdown

### Phase 6: Frontend Form Update

- **File**: `client/src/pages/teams.tsx`
  - Add state for `departmentId`: `const [departmentId, setDepartmentId] = useState<string>("");`
  - Add query to fetch departments using role-based endpoint
  - Add department Select field between "Team Name" and "Description"
  - Use `Select` component from shadcn/ui (similar to department creation form)
  - Make field required (no "No Department" option)
  - Update `handleCreateTeam` to include `departmentId` in mutation payload
  - Reset `departmentId` when dialog closes

### Phase 7: Translation Updates

- **File**: `client/src/locales/en/teams.json`

  - Add translation keys:
    - `"department": "Department"`
    - `"selectDepartment": "Select a department"`
    - `"departmentRequired": "Department is required"`

- **File**: `client/src/locales/es/teams.json`
  - Add Spanish translations for the same keys

### Phase 8: Update Existing Code References

- **File**: `server/routes/teams.ts` (GET /api/teams for managers, around line 85-102)

  - Remove the check for `team.departmentId` being null (since it's now required)
  - Simplify logic since all teams will have a department

- **File**: `server/seed/seedTeams.ts`
  - Ensure all teams in seeder have a `departmentId` assigned
  - Verify no teams are created without departments

## Implementation Details

### Department Endpoint Logic

```typescript
app.get("/api/teams/departments", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  const user = await storage.getUser(userId);

  if (user?.role === "admin") {
    // Return all active departments
    const allDepts = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.isActive, true));
    return res.json(allDepts);
  }

  if (user?.role === "manager") {
    // Return only departments managed by this manager
    const managedDepts = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(
        and(
          eq(departments.isActive, true),
          eq(departments.managerId as any, userId)
        )
      );
    return res.json(managedDepts);
  }

  // Agents/customers: return empty or 403
  return res.json([]);
});
```

### Frontend Form Field

```typescript
<div>
  <Label htmlFor="team-department">{t("teams:form.department")}</Label>
  <Select value={departmentId} onValueChange={setDepartmentId}>
    <SelectTrigger>
      <SelectValue placeholder={t("teams:form.selectDepartment")} />
    </SelectTrigger>
    <SelectContent>
      {departments?.map((dept: any) => (
        <SelectItem key={dept.id} value={dept.id.toString()}>
          {dept.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

## Notes

- Migration must handle existing NULL `department_id` values before making the column NOT NULL
- Backend validation ensures managers can only create teams in their managed departments
- Frontend form will show empty dropdown if user has no accessible departments
- All existing teams should have departments assigned before migration runs
