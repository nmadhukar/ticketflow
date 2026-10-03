# Department Detail Page Implementation

## Overview

Create a department detail page (`/departments/:id`) that displays department information, associated teams, and department-level statistics. This page focuses on department-level data and avoids duplicating user/member information that's already shown in team detail pages.

## Phase 1: Backend API Endpoints

### 1.1 Department Teams Endpoint

**Location**: `server/routes/index.ts` or new `server/routes/departments.ts`

- `GET /api/departments/:id/teams`
- Returns all teams belonging to the department
- Access: Admin (all departments), Manager (only their departments)
- Response: Array of team objects with basic info (id, name, description, createdAt, createdBy)

### 1.2 Department Statistics Endpoint

**Location**: `server/routes/index.ts` or new `server/routes/departments.ts`

- `GET /api/departments/:id/stats`
- Returns department-level statistics
- Access: Admin (all departments), Manager (only their departments)
- Response: Object with:
- `teamCount`: Number of teams in department
- `totalTickets`: Total tickets assigned to teams in this department
- `openTickets`: Open tickets in department teams
- `inProgressTickets`: In-progress tickets
- `resolvedTickets`: Resolved tickets
- `highPriorityTickets`: High priority tickets count

## Phase 2: Frontend Hooks

### 2.1 Department Hooks

**Location**: `client/src/hooks/useDepartments.ts` (new file)

- `useDepartment(departmentId)` - Fetch single department
- `useDepartmentTeams(departmentId)` - Fetch teams in department
- `useDepartmentStats(departmentId)` - Fetch department statistics

## Phase 3: Department Detail Page

### 3.1 Create Department Detail Page

**Location**: `client/src/pages/department-detail.tsx` (new file)

**Page Structure**:

- Header section with department name, description, manager info, status badge
- Tabs for: Overview, Teams, Statistics
- Edit/Delete actions (admin only, or manager for their department)

**Overview Tab**:

- Department information card
- Manager information (name, email, avatar if available)
- Active/Inactive status
- Created/Updated dates
- Quick stats cards (team count, ticket counts)

**Teams Tab**:

- List of teams in the department
- Each team card shows: name, description, link to team detail page
- Empty state if no teams
- For managers: only show teams they can access

**Statistics Tab**:

- Department-level ticket statistics
- Charts/graphs for ticket distribution (optional)
- Team performance metrics (optional)

### 3.2 Update Departments List Page

**Location**: `client/src/pages/departments.tsx`

- Make department cards clickable
- Navigate to `/departments/:id` on click
- Add visual indicator (hover effect, cursor pointer)

## Phase 4: UI Components

### 4.1 Department Teams Section

**Location**: `client/src/components/departments/department-teams-section.tsx` (new file)

- Component to display teams in a department
- Similar structure to `TeamTasksSection` but simpler
- Team cards with link to team detail page
- Empty state handling

### 4.2 Department Stats Section

**Location**: `client/src/components/departments/department-stats-section.tsx` (new file)

- Display department statistics
- Stats cards similar to dashboard stats
- Optional: Charts for ticket distribution

## Phase 5: Routing and Navigation

### 5.1 Add Route

**Location**: `client/src/App.tsx`

- Add route: `/departments/:id` → `DepartmentDetail` component
- Protected route: `allowedRoles: ["admin", "manager"]`

### 5.2 Update Sidebar Navigation

**Location**: `client/src/components/sidebar.tsx`

- No changes needed (departments link already exists)

## Phase 6: Permissions

### 6.1 Permission Checks

- Admin: Can view all departments
- Manager: Can only view departments they manage
- Add permission check in department detail page
- Redirect to `/departments` if unauthorized

## Phase 7: WebSocket Integration

### 7.1 Real-time Updates

**Location**: `client/src/hooks/useWebSocket.tsx`

- Invalidate department queries on relevant events
- `department:updated` - invalidate department detail
- `team:created`, `team:updated`, `team:deleted` - invalidate department teams if team belongs to department

## Phase 8: Translations

### 8.1 Update Translation Files

**Location**: `client/src/locales/{lang}/departments.json`

- Add keys for:
- Detail page titles and descriptions
- Tab labels (Overview, Teams, Statistics)
- Stats labels
- Empty states
- Error messages

## Implementation Notes

1. **No User/Member Details**: As per user feedback, department detail page should NOT show user/member lists. Users can see member details in team detail pages.

2. **Team Links**: Teams in department should link to `/teams/:id` for full team details.

3. **Statistics Focus**: Department stats should be aggregate data (team counts, ticket counts) not individual user data.

4. **Manager Access**: Managers should only see departments they manage, with appropriate permission checks.

5. **Consistent UI**: Follow the same design patterns as team detail page for consistency.
