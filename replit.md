# Replit.md

## Overview

This is a comprehensive ticketing system called TicketFlow designed for small business use. Built with a modern tech stack featuring React frontend with shadcn/ui components, Express.js backend, and PostgreSQL database using Drizzle ORM. The application provides professional task management with full audit trails, role-based access control, team management, and administrative features. Authentication is handled through Replit's OpenID Connect system.

## User Preferences

Preferred communication style: Simple, everyday language.
UI Preferences: Table listing format strongly preferred over card-based layouts for all ticket/task views.

## Recent Changes

**January 2025:**
- Enhanced TaskModal component with modern UX/UI best practices
- Implemented tabbed interface for task details and comments
- Added visual card-based form sections with color-coded borders
- Integrated contextual icons and improved visual hierarchy
- Added smart form validation with helpful error messages
- Implemented guided workflow for task creation and editing
- Converted task listing pages from card to table layout based on user preference
- Enhanced TaskModal with in-ticket editing capabilities for status, assignment, and due dates
- Added comprehensive status update functionality within ticket view
- Fixed modal layout issues - reorganized sections for better visibility and scrolling
- Added ability to reassign tickets to different users or teams with "Unassigned" option
- Separated status editing into its own visual section when editing existing tickets
- Maintained enhanced filtering system with visual search and filter controls
- Added overdue and due soon indicators in table views
- Fixed Select component errors for unassigned tickets by changing empty strings to "unassigned" values
- Added team member role management - admins can now promote/demote team members to team admin role
- Implemented dropdown menu in team detail page for easy role changes with visual indicators
- Added Company Branding tab in admin panel with logo upload functionality
- Implemented JPG/PNG logo upload with file validation and Base64 storage
- Created visual logo preview with upload interface in admin settings
- Completed professional color redesign across entire application with business-appropriate color palette
- Updated all components to use semantic color classes (primary, muted, card, etc.) for consistent theming
- Applied professional styling to dashboard, stats cards, header, sidebar, and status badges
- Enhanced visual hierarchy with business-focused shadow effects and gradient accents
- Professional redesign extended to teams page with updated card layouts, icon backgrounds, and button styling
- Admin panel redesigned with professional stat cards featuring icon backgrounds and business-appropriate hover effects

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **UI Library**: shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state
- **Routing**: Wouter for client-side routing
- **Build Tool**: Vite with development and production configurations

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **Authentication**: Replit OpenID Connect with Passport.js
- **Session Management**: Express sessions stored in PostgreSQL
- **Database Provider**: Neon Database (@neondatabase/serverless)

### Project Structure
```
├── client/          # React frontend application
├── server/          # Express.js backend API
├── shared/          # Shared TypeScript schemas and types
└── migrations/      # Database migration files
```

## Key Components

### Authentication System
- **Provider**: Replit OpenID Connect integration
- **Strategy**: Passport.js with OpenID Client strategy
- **Session Storage**: PostgreSQL-backed sessions using connect-pg-simple
- **User Management**: Automatic user creation/updates on login

### Database Schema
- **Users**: Profile information synced from Replit with role-based permissions (admin, manager, user)
- **Tasks**: Comprehensive ticket management with:
  - Unique ticket numbers (TKT-YYYY-XXXX format)
  - Multiple statuses (open, in_progress, resolved, closed, on_hold)
  - Priority levels (low, medium, high, urgent)
  - Severity levels (minor, normal, major, critical)
  - Categories (bug, feature, support, enhancement, incident, request)
  - Time tracking (estimated vs actual hours)
  - Tags for better organization
- **Teams**: Team organization with membership management and role assignments
- **Task Comments**: Full conversation history with user attribution and timestamps
- **Task History**: Complete audit trail tracking all changes with before/after values
- **Sessions**: Authentication session persistence with PostgreSQL storage

### API Design
- **RESTful endpoints**: `/api/tasks`, `/api/teams`, `/api/auth`
- **Authentication middleware**: Route protection with session validation
- **Error handling**: Centralized error handling with proper HTTP status codes
- **Request logging**: Automatic API request/response logging

### UI Components
- **Design System**: shadcn/ui with consistent styling and enhanced visual hierarchy
- **Responsive Design**: Mobile-first approach with Tailwind breakpoints
- **Navigation**: Sidebar-based layout with protected routing
- **Forms**: React Hook Form with Zod validation and intuitive task creation modal
- **Task Modal**: Modern tabbed interface with visual cards, icons, and guided form sections
- **Notifications**: Toast system for user feedback

## Data Flow

### Authentication Flow
1. User accesses protected route
2. Middleware checks session validity
3. Redirects to Replit OAuth if unauthorized
4. Creates/updates user record on successful auth
5. Establishes session and redirects to original route

### Task Management Flow
1. Frontend makes authenticated API requests
2. Backend validates session and permissions
3. Drizzle ORM handles database operations
4. Results returned as JSON responses
5. React Query manages caching and updates
6. UI updates reactively based on query state

### Team Collaboration Flow
1. Team creation restricted to authenticated users
2. Team membership managed through junction table
3. Task assignment supports both individual users and teams
4. Comments and history provide collaboration features

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe database operations
- **@tanstack/react-query**: Server state management
- **passport**: Authentication framework
- **express-session**: Session management

### UI Dependencies
- **@radix-ui/***: Accessible UI primitives
- **tailwindcss**: Utility-first CSS framework
- **lucide-react**: Icon library
- **wouter**: Lightweight routing

### Development Dependencies
- **vite**: Frontend build tool with HMR
- **typescript**: Type safety across the stack
- **drizzle-kit**: Database schema management
- **esbuild**: Backend bundling for production

## Deployment Strategy

### Development Environment
- **Frontend**: Vite dev server with HMR
- **Backend**: tsx for TypeScript execution
- **Database**: Neon serverless PostgreSQL
- **Sessions**: PostgreSQL-stored sessions

### Production Build
- **Frontend**: Vite production build to `dist/public`
- **Backend**: esbuild bundle to `dist/index.js`
- **Static Serving**: Express serves built frontend assets
- **Environment**: NODE_ENV=production configuration

### Database Management
- **Migrations**: Drizzle Kit handles schema changes
- **Connection**: Pooled connections via Neon serverless
- **Schema**: Shared TypeScript definitions in `/shared/schema.ts`

### Replit Integration
- **Authentication**: Seamless Replit user integration
- **Environment**: Optimized for Replit hosting environment
- **Development**: Cartographer plugin for enhanced debugging