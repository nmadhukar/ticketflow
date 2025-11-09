# Team Admins and Task Assignments Implementation Plan

## Overview

This plan implements team admin management and team task assignment tracking. It includes database schema changes, API endpoints, and permission system updates.

## Phase 1: Database Schema Changes

### 1.1 Create team_admins Table

- Create new `team_admins` table with fields:
  - Primary key, team_id, user_id, granted_by, granted_at
  - Optional: permissions array field for future extensibility
- Add foreign key constraints with appropriate cascade/restrict behaviors
- Add unique constraint on (user_id, team_id)
- Create indexes for performance:
  - Team lookup: (team_id, user_id)
  - User lookup: (user_id)
  - Team-only: (team_id)

### 1.2 Create team_task_assignments Table

- Create new `team_task_assignments` table with fields:
  - Primary key, task_id, team_id, assigned_user_id, assigned_by, assigned_at
  - Status field: 'active', 'completed', 'reassigned', 'cancelled'
  - Optional fields: completed_at, notes, priority
- Add foreign key constraints:
  - task_id → CASCADE delete
  - team_id → CASCADE delete
  - assigned_user_id → SET NULL on delete (preserve history)
  - assigned_by → RESTRICT or SET NULL
- No unique constraint on task_id (allow multiple active assignments)
- Create indexes:
  - Task queries: (task_id)
  - User workload: (assigned_user_id)
  - Team assignments: (team_id)
  - Active assignments: (task_id, status)
  - Composite: (team_id, assigned_user_id)

### 1.3 Remove role Column from team_members

- Drop `role` column from `team_members` table
- This assumes migration of existing data to `team_admins` table first

### 1.4 Migration Strategy

- Generate migration file using CLI (drizzle-kit or similar)
- Migration steps:
  1. Create `team_admins` table
  2. Migrate existing `team_members` records with `role='admin'` to `team_admins`
  3. Create `team_task_assignments` table
  4. Drop `role` column from `team_members`

## Phase 2: Permission System

### 2.1 Create Team Permissions Module

- Create `server/permissions/teams.ts` file
- Implement `canManageTeam(userId, teamId)` function:
  - System admins: always return true
  - Team admins: check `team_admins` table
  - Team creators: check `teams.createdBy`
  - Managers: check if team is in their managed department
- Implement `canGrantTeamAdmin(userId, teamId)` function:
  - Uses same logic as `canManageTeam`
- Implement `isTeamAdmin(userId, teamId)` helper function

### 2.2 Update Storage Interface

- Add methods to `IStorage` interface:
  - `isTeamAdmin(userId, teamId): Promise<boolean>`
  - `getTeamAdmins(teamId): Promise<TeamAdmin[]>`
  - `addTeamAdmin(userId, teamId, grantedBy): Promise<TeamAdmin>`
  - `removeTeamAdmin(userId, teamId): Promise<void>`
  - `getUserTeamAdminStatus(userId): Promise<Record<number, boolean>>` (batch check)

### 2.3 Update Storage Implementation

- Implement all team admin methods in `DatabaseStorage` class
- Optimize queries using indexes
- Handle edge cases (duplicates, cascading deletes)

## Phase 3: Team Admins API Endpoints

### 3.1 New Endpoints

- `GET /api/teams/:id/admins`
  - Get all team admins for a team
  - Access: System admin, team admin, team creator, manager (if team in their dept)
  - Returns: Array of admin objects with user info, granted_by, granted_at
- `POST /api/teams/:id/admins`
  - Grant team admin status to a team member
  - Access: System admin, team admin, team creator, manager (if team in their dept)
  - Body: `{ memberId: string }` (user must be team member)
  - Validates: User exists in team_members before granting
- `DELETE /api/teams/:id/admins/:adminId`
  - Remove team admin status
  - Access: System admin, team admin, team creator, manager (if team in their dept)
  - Safety: Prevent removing yourself (optional)
- `GET /api/teams/:id/permissions`
  - Check if current user can manage the team
  - Access: Any authenticated user
  - Returns: `{ canManageTeam: boolean, isTeamAdmin: boolean, isTeamCreator: boolean }`

### 3.2 Update Existing Endpoints

- `PATCH /api/teams/:teamId/members/:userId`
  - Remove role update functionality (role column no longer exists)
  - Update to use `canManageTeam()` permission check instead of system admin only
- `POST /api/admin/users/:userId/assign-team`
  - Remove `role` field from request body
  - Update to use `canManageTeam()` permission check
- `DELETE /api/admin/users/:userId/remove-team/:teamId`
  - Update to use `canManageTeam()` permission check
  - Also remove from `team_admins` if user is an admin
- `GET /api/teams/:id/members`
  - Remove `role` field from response
  - Optionally add `isAdmin: boolean` flag (derived from `team_admins` table)

## Phase 4: Team Task Assignments API Endpoints

### 4.1 New Endpoints

- `GET /api/teams/:id/tasks`
  - Get all tasks assigned to the team
  - Access: Team members, team admins, team creator, managers
  - Returns: Tasks with `assigneeType='team'` and `assigneeTeamId=teamId`
  -

## Phase 5: Client Changes

### 5.1 Type Definitions

**Location**: `client/src/types/teams.ts` (new file)

- Add TypeScript interfaces:
  - `TeamAdmin` - matches server TeamAdmin type with user info
  - `TeamTaskAssignment` - matches server TeamTaskAssignment type with user relations
  - `TeamPermissions` - response from `/api/teams/:id/permissions`
  - Update `TeamMember` - remove `role` field, add `isAdmin: boolean`

### 5.2 API Hooks

**Location**: `client/src/hooks/useTeamAdmins.ts` (new file)

- Create custom hooks:
  - `useTeamAdmins(teamId)` - fetch team admins with user info
  - `useTeamPermissions(teamId)` - fetch current user's permissions for team
  - `useGrantTeamAdmin(teamId)` - mutation to grant admin status
  - `useRevokeTeamAdmin(teamId)` - mutation to revoke admin status

**Location**: `client/src/hooks/useTeamTasks.ts` (new file)

- Create custom hooks:
  - `useTeamTasks(teamId)` - fetch all tasks assigned to team
  - `useTaskAssignments(teamId, taskId)` - fetch assignments for a specific task
  - `useCreateTaskAssignment(teamId, taskId)` - mutation to assign task to member
  - `useUpdateTaskAssignment(teamId, taskId, assignmentId)` - mutation to update assignment
  - `useDeleteTaskAssignment(teamId, taskId, assignmentId)` - mutation to delete assignment

### 5.3 UI Components

**Location**: `client/src/components/teams/team-admins-section.tsx` (new file)

- Component to display team admins:
  - List of admins with avatar, name, email
  - Show "Granted by" and "Granted at" info
  - Actions: Grant Admin (if user has permission), Revoke Admin (if user has permission)
  - Permission-based rendering

**Location**: `client/src/components/teams/team-tasks-section.tsx` (new file)

- Component to display team tasks:
  - List of tasks assigned to team (from `/api/teams/:id/tasks`)
  - Show task title, status, priority, assignee info
  - Link to task detail page
  - Empty state when no tasks

**Location**: `client/src/components/teams/task-assignments-section.tsx` (new file)

- Component to display and manage task assignments:
  - List of assignments for a specific task
  - Show assigned user, assigned by, status, dates
  - Actions: Assign Task (modal), Update Assignment (status/notes/priority), Delete Assignment
  - Status badges (active, completed, reassigned, cancelled)
  - History view (all assignments including completed)

**Location**: `client/src/components/teams/assign-task-modal.tsx` (new file)

- Modal for assigning team task to member:
  - Select team member dropdown (filtered to team members only)
  - Optional: notes, priority fields
  - Validation: ensure user is team member
  - Submit creates assignment via API

**Location**: `client/src/components/teams/grant-admin-dialog.tsx` (new file)

- Dialog for granting team admin status:
  - Select team member (filtered to non-admin members)
  - Confirmation message
  - Submit grants admin via API

### 5.4 Page Updates

**Location**: `client/src/pages/team-detail.tsx`

- Update team detail page:
  - Remove role-based UI (role dropdown, "Make Admin"/"Remove Admin" actions)
  - Add Team Admins section (new component, below Team Members)
  - Add Team Tasks section (new component, below Team Admins)
  - Update member display to show `isAdmin` badge instead of `role` badge
  - Update `canAddMembers` logic to use `/api/teams/:id/permissions` endpoint
  - Remove `updateMemberRoleMutation` (replaced by admin grant/revoke mutations)
  - Update `addMemberMutation` to remove `role` parameter
  - Add permission checks using `useTeamPermissions` hook
  - Add tabs or accordion sections for: Members, Admins, Tasks

### 5.5 Integration Points

**WebSocket Updates** (`client/src/hooks/useWebSocket.tsx`):

- Add handlers for team admin events:
  - `team:admin:granted` - invalidate team admins query
  - `team:admin:revoked` - invalidate team admins query
  - `team:task:assigned` - invalidate task assignments query
  - `team:task:assignment:updated` - invalidate task assignments query

**Translation Files** (`client/src/locales/{lang}/teams.json`):

- Add translations for:
  - Team admins section titles and descriptions
  - Grant/revoke admin actions
  - Team tasks section
  - Task assignments section
  - Assignment status labels
  - Error messages for permission failures

### 5.6 UI/UX Considerations

**Permission-Based Rendering**:

- Show/hide actions based on `canManageTeam` permission
- Disable actions for users without permissions
- Show tooltips explaining why actions are disabled

**Loading States**:

- Skeleton loaders for team admins list
- Loading spinners for async operations
- Optimistic updates where appropriate

**Error Handling**:

- Display error toasts for failed operations
- Handle 403 (Forbidden) with clear messages
- Handle validation errors (e.g., user not a team member)

**Success Feedback**:

- Toast notifications for successful operations
- Invalidate relevant queries after mutations
- Refresh data automatically after changes

**Confirmation Dialogs**:

- Confirm before revoking admin status
- Confirm before deleting task assignments
- Warn if removing last admin (if applicable)

### 5.7 Data Flow

1. Team Detail Page loads → fetches team, members, permissions
2. User views Team Admins → fetches admins list
3. User grants admin → mutation → invalidate queries → refresh UI
4. User views Team Tasks → fetches tasks assigned to team
5. User clicks on task → shows Task Assignments section
6. User assigns task → opens modal → selects member → creates assignment
7. User updates assignment → mutation → updates status/notes/priority

### 5.8 Migration Considerations

**Backward Compatibility**:

- Handle teams that may still have `role` field in members (during migration period)
- Gracefully handle missing `isAdmin` field
- Show appropriate fallbacks during transition

**Data Migration UI** (Optional):

- Admin notification if migration is needed
- One-time migration prompt (if applicable)
