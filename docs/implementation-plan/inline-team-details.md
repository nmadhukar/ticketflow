# Inline Team Details in Department Teams Section

## Overview

Implement inline team details expansion in the department teams section, similar to how ticket details are shown inline. When a team card is clicked, it expands below to show a simplified view with key information (members count, admins count, recent tasks) and a "View Full Details" button for navigation to the full team page.

## Phase 1: Update Department Teams Section Component

### 1.1 Add Expansion State Management

**Location**: `client/src/components/departments/department-teams-section.tsx`

- Add `expandedTeamId` state to track which team is currently expanded
- Only one team can be expanded at a time (collapsing previous when opening new)
- Make team cards clickable to toggle expansion

### 1.2 Create Simplified Team Detail Component

**Location**: `client/src/components/departments/team-detail-preview.tsx` (new file)

- Component to display simplified team information inline
- Shows:
  - **Members Count**: Total number of team members
  - **Admins Count**: Number of team admins
  - **Recent Tasks**: Last 3-5 tasks assigned to the team (with status badges)
  - **Quick Stats**: Optional quick metrics (total tasks, open tasks count)
- Includes "View Full Details" button that navigates to `/teams/:id`
- Loading states with skeleton loaders
- Error handling

### 1.3 Update Team Card Interaction

**Location**: `client/src/components/departments/department-teams-section.tsx`

- Replace "View Team" button with clickable card area
- Add visual indicator (chevron/arrow) to show expandable state
- When team card is clicked:
  - If not expanded: Expand to show inline details
  - If already expanded: Collapse
  - If another team is expanded: Collapse previous, expand clicked team
- Add hover effects and visual feedback

### 1.4 Fetch Team Data for Expanded Teams

**Location**: `client/src/components/departments/department-teams-section.tsx`

- Use `useTeamAdmins` hook to fetch admins count (only when team is expanded)
- Use `useQuery` to fetch team members (only when team is expanded)
- Use `useTeamTasks` hook to fetch recent tasks (only when team is expanded)
- All queries should be enabled only when `expandedTeamId === team.id`

## Phase 2: Team Detail Preview Component

### 2.1 Component Structure

**Location**: `client/src/components/departments/team-detail-preview.tsx` (new file)

**Props**:

- `teamId: string | number` - Team ID to fetch data for
- `onViewFullDetails: () => void` - Callback for "View Full Details" button

**Features**:

- Card-based layout with sections for different information
- Responsive grid layout for stats
- Recent tasks list with status badges
- Loading states for each data section
- Error handling per section

### 2.2 Data Fetching

- Use `useTeamAdmins(teamId)` to get admins count
- Use `useQuery` with `/api/teams/:id/members` to get members count
- Use `useTeamTasks(teamId)` to get tasks, then slice to show last 3-5
- All queries enabled only when component is mounted (team is expanded)

### 2.3 UI Components

- Stats cards showing counts (Members, Admins, Tasks)
- Recent tasks list with:
  - Task title/link
  - Status badge
  - Priority badge (optional)
  - Created date
- "View Full Details" button with ExternalLink icon
- Separator between sections

## Phase 3: Styling and UX

### 3.1 Visual Indicators

- Add chevron icon (ChevronDown/ChevronUp) to team cards to indicate expandable state
- Add transition animations for smooth expand/collapse
- Highlight expanded team card with different background color
- Add border or shadow to expanded section

### 3.2 Responsive Design

- Ensure inline details work well on mobile
- Consider accordion-style collapse on smaller screens
- Stack stats vertically on mobile, horizontally on desktop

### 3.3 Accessibility

- Add `aria-expanded` attribute to team cards
- Keyboard navigation support (Enter/Space to expand)
- Focus management when expanding/collapsing

## Phase 4: Translations

### 4.1 Add Translation Keys

**Location**: `client/src/locales/en/departments.json` and `client/src/locales/es/departments.json`

- Add keys for:
  - "View Full Details" button
  - "Members" label
  - "Admins" label
  - "Recent Tasks" section title
  - "No tasks" empty state
  - Loading states

## Implementation Notes

1. **Performance**: Only fetch team data when team is expanded to avoid unnecessary API calls
2. **State Management**: Use local component state for expansion, no need for global state
3. **Data Caching**: TanStack Query will cache the data, so re-expanding is fast
4. **Consistency**: Follow the same pattern as ticket details expansion in team-tasks-section
5. **Simplified View**: Keep it concise - full details are available via "View Full Details" button

## Files to Modify

1. `client/src/components/departments/department-teams-section.tsx` - Add expansion logic
2. `client/src/components/departments/team-detail-preview.tsx` - New component for inline view
3. `client/src/locales/en/departments.json` - Add translation keys
4. `client/src/locales/es/departments.json` - Add Spanish translations
