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
- Fixed notifications page display issue by removing double Layout wrapper that was preventing proper rendering
- Implemented AI Help Chatbot feature that uses uploaded help documentation to answer user questions
- Created aiChatMessages database table for storing chat history and sessions
- Added floating chat interface accessible from all authenticated pages with minimize/maximize functionality
- Integrated help document search within AI responses to provide contextual assistance
- **Migrated AI chat assistant from Perplexity to AWS Bedrock with Claude 3 Sonnet model**
- **Reused existing AWS credentials from email configuration (SES) for Bedrock integration**
- **Updated admin panel to reflect AWS Bedrock configuration status with visual indicators**
- Implemented Customer role with restricted permissions - customers can only create tickets, view own tickets, add updates to own tickets
- Updated backend access control logic across all routes to enforce customer role restrictions
- Modified frontend sidebar navigation to show only Dashboard and My Tickets for customer users
- Enhanced admin panel role management to include customer role option in user editing
- Added interactive dashboard filtering - clicking stats cards now filters the tasks table below
- Implemented visual indicators for active filters with badges and clear button
- Stats cards show active state with ring highlight when filtering is applied
- Fixed duplicate sidebar issues in Settings and Teams pages by removing redundant Layout wrappers
- Created comprehensive user guide management system with database tables for guides and categories
- Built admin interface for managing Scribehow guides, HTML content, and video embeds organized by categories
- Implemented user-facing guide interface with search and category filtering capabilities
- Added User Guides to sidebar navigation and integrated guide management link in admin Help Documentation section
- Fixed task attachment date display issue (was showing "invalid" because code referenced uploadedAt instead of createdAt field)
- Enhanced task tracking to show creator information throughout the system with proper database joins
- Updated task modal to display "Created by [user] on [date]" in the header section
- Modified tasks listing pages to show creator name and creation date in the tables
- Added creator information to dashboard recent tasks display for better visibility
- Implemented department management system with full CRUD operations accessible from admin panel
- Created departments database table with manager assignment and active/inactive status tracking
- Built admin interface for creating, editing, and deleting departments with visual card-based layout
- Added user invitation system allowing admins to invite new users via email with role and department assignment
- Created user_invitations table with token-based invitation tracking and expiration handling
- Integrated SendGrid email sending for invitation emails with customizable templates
- Added invitation management interface showing pending, accepted, and expired invitations
- Updated admin panel with links to new department and invitation management pages
- Fixed dashboard "Open" button bug - removed button and made ticket titles clickable instead
- Standardized terminology throughout application from "tasks" to "tickets" for consistency
- Made ticket titles clickable in all listing pages (dashboard, all tickets, my tickets)
- Made recent activity items clickable in dashboard - clicking opens the corresponding ticket
- Added last updated date and person information to ticket modal header
- Enhanced backend queries to include lastUpdatedBy field for all tickets
- Fixed notifications page 404 flash issue by reorganizing route order in App.tsx
- Fixed blank screen issue when clicking notification links by using wouter navigation instead of window.location
- Made notification items clickable to navigate to relevant content
- Added Microsoft Teams integration with automatic notifications for ticket creation, updates, and assignments
- Created Teams integration settings page allowing users to configure webhook URLs and notification preferences
- Implemented test notification functionality to verify webhook configuration
- Added Teams integration link to sidebar navigation for easy access
- Updated landing page to show Microsoft 365 sign-in option alongside Replit authentication
- **Replaced Replit authentication with commercial-style authentication system using passport.js**
- **Added password, password reset token, and expiry fields to users table**
- **Created comprehensive auth page with registration, sign in, and forgot password functionality**
- **Implemented secure password hashing using bcrypt with proper salt generation**
- **Maintained Microsoft 365 SSO option alongside new username/password authentication**
- **Fixed passport deserialization errors and verified full authentication flow is working**
- **Added user approval system where all new registrations require admin approval before login**
- **Created admin interface to view pending users and approve them with one click**
- **Added approval status display in user management table with visual badges**
- **Implemented auto-approval for invited users - users who register with an invited email are automatically approved**
- **Created admin user: maddy@talbothealthservices.com with full admin privileges**
- **Fixed dashboard ticket counts to show all tickets for admin users (was showing 0 due to user ID mismatch)**
- **Added Microsoft 365 SSO configuration UI in admin panel with client ID, secret, and tenant ID fields**
- **Enhanced stats endpoint to show global statistics for admins while maintaining user-specific stats for regular users**
- **Fixed signout "page not found" error by adding GET /api/logout route alongside existing POST /api/auth/logout endpoint**
- **Fixed duplicate menu columns issue in Teams page by correcting HTML structure to prevent Layout wrapper duplication**
- **Added "Invite User" button directly to User Management tab header in admin panel for easier access to invitation functionality**
- **Fixed company logo display in sidebar - now properly shows uploaded logo from company branding settings with fallback to default icon**
- **Added UI interface to view sent invitations with status tracking in admin panel and sidebar navigation**
- **Replaced SendGrid with Amazon SES for email sending functionality including invitation emails**
- **Major reorganization of Settings vs Admin panel - moved all system-level features (API Keys, Company branding) from Settings to Admin panel**
- **Settings page now contains only user-specific preferences: Profile, Notifications, Preferences, and simplified Security**
- **Admin panel now has complete API Keys management and Company branding tabs for proper separation of concerns**
- **Fixed critical invitation email bug - resolved AWS credentials mismatch by updating sendEmailWithTemplate calls to include awsAccessKeyId, awsSecretAccessKey, and awsRegion from database**
- **Implemented configurable ticket number prefix feature - admins can now customize the ticket prefix (default: TKT) through System Settings in admin panel**
- **Added ticketPrefix field to companySettings table and automatic ticket number generation in format PREFIX-YYYY-XXXX**
- **Enhanced ticket number generation logic with proper sequence handling to ensure unique ticket numbers across years**
- **Fixed duplicate menu columns issue in team-detail.tsx page by removing redundant Sidebar component and wrapper div - consistent with previous Layout fixes**
- **Fixed invitation cancellation bug - cancelled invitations now show "Cancelled" status badge instead of "Pending" by adding cancelled status handling to getStatusBadge function**
- **Fixed Company Branding functionality - company name is now properly editable with save button, logo upload includes file size validation (5MB limit), and resolved missing ticket_prefix database column issue**
- **Implemented Company Policy Document Management system - admins can now upload and manage policy documents (Word, PDF) that integrate with AI chatbot for answering policy-related questions**
- **Added Company Policies tab to admin panel with full CRUD operations for policy documents including upload, download, and delete functionality**
- **Fixed API key creation error - corrected frontend/backend mismatch where frontend expected 'key' but backend returns 'plainKey' in response**
- **Implemented separate AWS API key management for SES and Bedrock services - added separate configuration sections in admin panel allowing different IAM users for email and AI chat functionality**
- **Fixed TaskModal terminology consistency - changed all references from "task" to "ticket" including button text "Create Ticket", error messages, tab labels, and dialog descriptions**
- **Fixed invitation registration flow - auth page now properly handles invitation URL parameters (mode, email, token), switches to register tab, pre-fills email field as read-only, and shows invitation indicator**
- **Enhanced registration endpoint to handle invited users who already exist (from SSO) but need to set password - allows password setup for existing users with valid invitations**
- **Added validation to prevent sending invitations to emails that are already registered - system now checks for existing users and pending invitations before creating new invitations**
- **Implemented comprehensive smart helpdesk architecture with AI-powered features for intelligent ticket handling and knowledge management**
- **Created AI auto-response service using AWS Bedrock that analyzes new tickets, provides intelligent responses with confidence scoring, and tracks effectiveness**
- **Built knowledge base learning service that automatically extracts insights from resolved tickets and creates searchable knowledge articles**
- **Integrated AI analysis into ticket creation workflow - auto-responses are generated and applied for high-confidence scenarios (>70%)**
- **Added automatic knowledge base learning when tickets are resolved - system analyzes resolution patterns and creates draft knowledge articles**
- **Enhanced database schema with new tables: ticketAutoResponses, ticketComplexityScores, knowledgeArticles, escalationRules, and aiAnalytics**
- **Created comprehensive API endpoints for smart helpdesk features including auto-response management, knowledge base search, AI analytics, and escalation rules**
- **Implemented ticket complexity scoring system that evaluates tickets based on multiple factors and determines escalation needs**
- **Created AWS Bedrock integration module with Claude 3 Sonnet model for intelligent ticket analysis, response generation, and knowledge base extraction**
- **Implemented four core AI functions: analyzeTicket(), generateResponse(), updateKnowledgeBase(), and calculateConfidence() with proper error handling**
- **Added support for separate AWS credentials for Bedrock service, allowing different IAM users for AI chat and email functionality**
- **Integrated Bedrock AI into ticket creation workflow with automatic response generation for high-confidence scenarios**
- **Implemented WebSocket server on backend with /ws endpoint for real-time updates and authentication handling**
- **Created missing database tables for AI features: ticket_auto_responses, ticket_complexity_scores, knowledge_articles, escalation_rules, ai_analytics**
- **Fixed team query issue in storage.ts by correcting table reference from 'team' to 'teams' in SQL queries**
- **Fixed Brain icon import issue in admin panel to resolve React component errors**
- **Updated dashboard to properly use TicketList component and handle ticket detail views with conditional rendering**
- **Added Knowledge Base and AI Settings navigation links to sidebar (Knowledge Base for all users, AI Settings for admin only)**

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
- **Primary Method**: Commercial-style email/password authentication with passport.js
- **Secondary Method**: Microsoft 365 SSO integration (optional)
- **Password Security**: bcrypt hashing with salt rounds
- **Session Storage**: PostgreSQL-backed sessions using connect-pg-simple
- **User Management**: Registration, login, logout, and password reset functionality
- **Auth Page Features**: Tabbed interface for sign in, registration, and forgot password

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

## Documentation

### Available Documentation
The project includes comprehensive technical documentation in the `docs/` directory:

1. **[Database Schema Documentation](docs/database-schema.md)** - Complete database structure with all tables, relationships, and indexes
2. **[Database Schema Diagram](docs/database-schema-diagram.md)** - Visual ERD representation of the database
3. **[System Architecture](docs/system-architecture.md)** - High-level system design with component diagrams
4. **[Technical Design Document](docs/technical-design-document.md)** - Detailed technical implementation guide
5. **[Technical Requirements Document](docs/technical-requirements-document.md)** - Complete functional and non-functional requirements
6. **[Code Review Report](docs/code-review-report.md)** - Comprehensive code quality analysis and recommendations

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