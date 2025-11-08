# Stats Board Implementation for Agents and Managers

## Overview

Create a dedicated stats drawer accessible to agents and managers with role-specific metrics. The drawer will be triggered by a fixed button positioned at the center-right of the screen (top: 50%, right: 0).

## Backend Changes

### 1. Create New Stats Endpoints (`server/routes/index.ts`)

#### Agent Stats Endpoint

- **Route**: `GET /api/stats/agent`
- **Access**: `agent` role only (middleware check)
- **Returns**:
  - Personal stats: assigned to me, created by me, resolution rate, avg resolution time
  - Team stats (if agent is on teams): total, open, in progress, resolved, closed, high priority per team
  - Team member comparison (optional)

#### Manager Stats Endpoint

- **Route**: `GET /api/stats/manager`
- **Access**: `manager` role only (middleware check)
- **Returns**:
  - Department stats: total, open, in progress, resolved, closed, high priority, avg resolution time
  - Priority distribution: urgent, high, medium, low counts
  - Category breakdown: count and percentage per category
  - Team performance: per-team metrics with member stats

### 2. Storage Methods (`server/storage/index.ts`)

#### Add `getAgentStats(userId: string)`

- Query user's teams from teamMembers table
- Personal tickets: WHERE assigneeId = userId OR createdBy = userId
- Team tickets: WHERE assigneeTeamId IN (user's teams) OR assigneeId IN (team members)
- Calculate resolution rate: (resolved + closed) / total assigned
- Calculate avg resolution time from resolved tickets

#### Add `getManagerStats(userId: string)`

- Query manager's departments and teams
- Department tickets: WHERE departmentId IN (manager's departments)
- Group by team for team performance
- Calculate priority distribution with COUNT and GROUP BY
- Calculate category breakdown with COUNT and GROUP BY
- Join with users table for team member stats

### 3. Update Storage Interface (`server/storage/storage.interface.ts`)

- Add method signatures for `getAgentStats` and `getManagerStats`

## Frontend Changes

### 1. Create Stats Drawer Component (`client/src/components/stats-drawer.tsx`)

**Component Structure:**

- Use shadcn/ui Drawer component (install if needed: `npx shadcn-ui@latest add drawer`)
- Fixed trigger button:
  - Position: `fixed`, top: `50%`, right: `0`
  - Transform: `translateY(-50%)` for vertical centering
  - Z-index: `50` (above most content)
  - Icon: `BarChart3` or `TrendingUp` from lucide-react
  - Background: primary color with hover effect
  - Rounded left corners only (`rounded-l-lg`)
  - Tooltip: "View Statistics"
- Drawer configuration:
  - Direction: slides in from right
  - Width: `400px` (desktop), `100vw` (mobile)
  - Close on overlay click
  - Close button in header
  - Scrollable content area
- State management:
  - `useState` for open/close state
  - `useAuth` to get user role
  - Conditional rendering: only show for agent/manager roles
- Features:
  - Loading states with skeleton loaders
  - Error handling with error message display
  - Real-time refresh (polling every 30s or WebSocket)
  - Responsive design
  - Smooth animations
  - Keyboard support (ESC to close)

### 2. Create Agent Stats View (`client/src/components/stats/agent-stats.tsx`)

**Props Interface:**

```typescript
interface AgentStatsProps {
  data: AgentStatsData;
  isLoading: boolean;
  error: Error | null;
}
```

**Personal Stats Section:**

- Grid layout: 2 columns (mobile: 1 column)
- Stat Cards (4 cards):

  1. **Assigned to Me** - Icon: `UserCheck`, Color: blue, Clickable: filter tickets
  2. **Created by Me** - Icon: `PlusCircle`, Color: green, Clickable: filter tickets
  3. **My Resolution Rate** - Icon: `Target`, Color: purple, Progress bar
  4. **Avg Resolution Time** - Icon: `Clock`, Color: orange, Trend indicator

**Team Stats Section (conditional):**

- Only shown if user is on a team
- Section header: "Team Overview"
- Team selector dropdown (if multiple teams)
- Team Stats Cards (5 cards): Total, Open, In Progress, Resolved, High Priority
- Team Member Comparison (optional table/list)

**Styling:**

- Use Card components from shadcn/ui
- Consistent spacing and typography
- Color-coded metrics
- Hover effects on cards
- Loading skeletons

### 3. Create Manager Stats View (`client/src/components/stats/manager-stats.tsx`)

**Props Interface:**

```typescript
interface ManagerStatsProps {
  data: ManagerStatsData;
  isLoading: boolean;
  error: Error | null;
}
```

**Department Overview Section:**

- Department selector (if multiple departments)
- Overview Cards (6 cards): Total, Open, In Progress, Resolved, High Priority, Avg Resolution Time

**Priority Distribution:**

- Chart component (recharts PieChart or BarChart)
- Shows: Urgent, High, Medium, Low counts
- Color-coded segments

**Category Breakdown:**

- Horizontal bar chart or list
- Shows count and percentage per category
- Sortable by count

**Team Performance Section:**

- Accordion or tabs for each team
- Per-team metrics: counts, resolution rate, avg time, member count
- Team Member Stats Table:
  - Columns: Name, Assigned, Resolved, Resolution Rate, Avg Time
  - Sortable columns
  - Pagination if needed

**Department Metrics (optional):**

- Time-based charts: tickets over time, resolution trends

### 4. Create Reusable Stat Card Component (`client/src/components/stats/stat-card.tsx`)

**Props:**

```typescript
interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  trend?: { value: number; isPositive: boolean };
  onClick?: () => void;
  loading?: boolean;
}
```

**Features:**

- Consistent card styling
- Icon + value + title layout
- Optional trend indicator (up/down arrow)
- Click handler for filtering
- Loading skeleton state

### 5. Update Layout/App Structure

**Option A: Add to Main Layout**

- File: `client/src/components/layout.tsx` or similar
- Import StatsDrawer
- Render: `{isAuthenticated && (role === "agent" || role === "manager") && <StatsDrawer />}`

**Option B: Add to App Root**

- File: `client/src/App.tsx`
- Import StatsDrawer
- Render outside main router
- Use React portal if needed for z-index

### 6. Add Query Hooks (`client/src/hooks/useStats.ts`)

**useAgentStats Hook:**

```typescript
export function useAgentStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["/api/stats/agent"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stats/agent");
      return res.json();
    },
    enabled: !!user?.id && user?.role === "agent",
    refetchInterval: 30000, // 30 seconds
    staleTime: 10000,
  });
}
```

**useManagerStats Hook:**

```typescript
export function useManagerStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["/api/stats/manager"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stats/manager");
      return res.json();
    },
    enabled: !!user?.id && user?.role === "manager",
    refetchInterval: 30000,
    staleTime: 10000,
  });
}
```

**Cache Invalidation:**

- Add to task mutation success handlers
- Add to WebSocket event handlers
- Invalidate on ticket create/update/delete

### 7. Add Type Definitions (`client/src/types/stats.ts`)

```typescript
export interface AgentStats {
  personal: {
    assignedToMe: number;
    createdByMe: number;
    resolutionRate: number;
    avgResolutionTime: number; // hours
  };
  team?: {
    teamId: number;
    teamName: string;
    totalTickets: number;
    openTickets: number;
    inProgress: number;
    resolved: number;
    closed: number;
    highPriority: number;
  }[];
}

export interface ManagerStats {
  department: {
    departmentId: number;
    departmentName: string;
    totalTickets: number;
    openTickets: number;
    inProgress: number;
    resolved: number;
    closed: number;
    highPriority: number;
    avgResolutionTime: number;
  }[];
  priorityDistribution: {
    urgent: number;
    high: number;
    medium: number;
    low: number;
  };
  categoryBreakdown: {
    category: string;
    count: number;
    percentage: number;
  }[];
  teamPerformance: {
    teamId: number;
    teamName: string;
    totalTickets: number;
    resolutionRate: number;
    avgResolutionTime: number;
    members: {
      userId: string;
      name: string;
      assigned: number;
      resolved: number;
      resolutionRate: number;
      avgResolutionTime: number;
    }[];
  }[];
}
```

### 8. Add Translations (`client/src/locales/en/stats.json`)

```json
{
  "drawer": {
    "title": "Statistics",
    "close": "Close",
    "refresh": "Refresh"
  },
  "agent": {
    "title": "My Statistics",
    "personal": {
      "title": "Personal Stats",
      "assignedToMe": "Assigned to Me",
      "createdByMe": "Created by Me",
      "resolutionRate": "Resolution Rate",
      "avgResolutionTime": "Avg Resolution Time"
    },
    "team": {
      "title": "Team Overview",
      "selectTeam": "Select Team",
      "totalTickets": "Total Tickets",
      "openTickets": "Open Tickets",
      "inProgress": "In Progress",
      "resolved": "Resolved",
      "highPriority": "High Priority",
      "noTeam": "You are not assigned to any team"
    }
  },
  "manager": {
    "title": "Department Statistics",
    "department": {
      "title": "Department Overview",
      "selectDepartment": "Select Department",
      "totalTickets": "Total Tickets",
      "openTickets": "Open Tickets",
      "inProgress": "In Progress",
      "resolved": "Resolved",
      "highPriority": "High Priority",
      "avgResolutionTime": "Avg Resolution Time"
    },
    "priority": {
      "title": "Priority Distribution"
    },
    "category": {
      "title": "Category Breakdown"
    },
    "teams": {
      "title": "Team Performance",
      "memberStats": "Team Member Statistics"
    }
  },
  "common": {
    "loading": "Loading statistics...",
    "error": "Failed to load statistics",
    "noData": "No data available",
    "hours": "hours",
    "days": "days",
    "percentage": "{{value}}%"
  }
}
```

**Add to all locale files:**

- `client/src/locales/es/stats.json`
- `client/src/locales/fr/stats.json`
- `client/src/locales/de/stats.json`
- `client/src/locales/zh/stats.json`

### 9. Install Dependencies

- Check if Drawer exists: `npx shadcn-ui@latest add drawer` (if not available)
- Install chart library: `npm install recharts` (for priority/category charts)
- Install types if needed: `npm install --save-dev @types/recharts`

### 10. Integration Points

**Update WebSocket Handler (`client/src/hooks/useWebSocket.tsx`):**

- Add stats query invalidation on ticket update events
- Invalidate both agent and manager stats queries

**Update Task Mutations:**

- `client/src/components/task-modal/index.tsx`: Invalidate stats on create/update
- `client/src/pages/tickets.tsx`: Invalidate stats on bulk operations

### 11. Styling and Responsive Design

**Fixed Button:**

- Position: `fixed`, top: `50%`, right: `0`
- Transform: `translateY(-50%)`
- Z-index: `50`
- Padding: `12px 16px`
- Border radius: `8px 0 0 8px` (left corners only)
- Hover: scale(1.05) or color change
- Mobile: move to `bottom-right` if needed

**Drawer:**

- Width: `400px` (desktop), `100vw` (mobile)
- Max height: `100vh`
- Scrollable content
- Sticky header with title and close button
- Smooth slide-in animation

**Stat Cards:**

- Consistent padding and spacing
- Color-coded borders or backgrounds
- Hover effects
- Loading skeletons matching structure

**Charts:**

- Responsive sizing
- Consistent color scheme
- Accessible (ARIA labels)

### 12. Error Handling

- Network errors: Show retry button with error message
- Permission errors: Show "Access denied" message
- Empty data: Show friendly contextual messages
- Component errors: Wrap in ErrorBoundary with fallback UI
- Loading states: Use skeleton loaders for better UX

## Files to Create/Modify

### New Files

- `client/src/components/stats-drawer.tsx`
- `client/src/components/stats/agent-stats.tsx`
- `client/src/components/stats/manager-stats.tsx`
- `client/src/components/stats/stat-card.tsx`
- `client/src/hooks/useStats.ts`
- `client/src/types/stats.ts`
- `client/src/locales/en/stats.json` (and other locales)

### Modified Files

- `server/routes/index.ts` - Add new endpoints
- `server/storage/index.ts` - Add stats methods
- `server/storage/storage.interface.ts` - Add method signatures
- `client/src/App.tsx` or layout component - Add drawer
- `client/src/hooks/useWebSocket.tsx` - Add invalidation
- `client/src/components/task-modal/index.tsx` - Add invalidation
- `client/src/pages/tickets.tsx` - Add invalidation

## Testing Considerations

- Verify agent sees only personal + team stats
- Verify manager sees only department stats
- Test with agents not on teams
- Test with managers managing multiple departments
- Test drawer on mobile devices
- Test real-time updates
- Test error states and loading states
- Verify cache invalidation works correctly
