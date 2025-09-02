## Overview

TicketFlow is a comprehensive ticketing system designed for small businesses, offering professional task management with full audit trails, role-based access control, team management, and administrative features. It aims to provide a robust solution for internal task tracking, customer support, and project management. Key capabilities include AI-powered intelligent ticket handling, knowledge base management, and integrations with external communication platforms like Microsoft Teams. The system supports various user roles, including customer, agent, and administrator, ensuring secure and efficient operations with a focus on enterprise-level security measures.

## User Preferences

Preferred communication style: Simple, everyday language.
UI Preferences: Table listing format strongly preferred over card-based layouts for all ticket/task views.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript.
- **UI Library**: shadcn/ui components built on Radix UI primitives, styled with Tailwind CSS.
- **State Management**: TanStack Query (React Query) for server state.
- **Routing**: Wouter for client-side routing.

### Backend
- **Framework**: Express.js with TypeScript.
- **Database ORM**: Drizzle ORM with PostgreSQL dialect.
- **Authentication**: Commercial-style email/password authentication using Passport.js, with optional Microsoft 365 SSO.
- **Session Management**: Express sessions stored in PostgreSQL.
- **Real-time Updates**: WebSocket server (`/ws`) for real-time notifications and updates.

### Core Features & Design Patterns
- **AI-Powered Helpdesk**: Integrated AWS Bedrock (Claude 3 Sonnet) for intelligent ticket analysis, auto-responses, and knowledge base article generation. This includes confidence scoring and automatic knowledge base learning from resolved tickets.
- **Role-Based Access Control (RBAC)**: Supports admin, agent, and customer roles with granular permissions enforced across the application.
- **Comprehensive Ticketing**: Features unique ticket numbers (configurable prefix), multiple statuses, priority/severity levels, categories, time tracking, and tags.
- **Audit Trails**: Full history tracking for all ticket changes.
- **Team Management**: Functionality for creating teams, managing memberships, and assigning roles (including team admin).
- **User Management**: Includes user invitation system (with auto-approval for invited users), user approval workflow for new registrations, and department management.
- **Security Infrastructure**: Implements JWT authentication, bcrypt password hashing (12 salt rounds), input validation/sanitization, rate limiting, account lockout, XSS protection, and CSRF prevention. Utilizes AWS IAM roles with minimal permissions.
- **Configurability**: Admins can customize company branding (logo), ticket number prefixes, and configure external service API keys.
- **Documentation System**: Comprehensive internal technical documentation (e.g., database schema, API reference, deployment guides) for development and maintenance.
- **UI/UX Decisions**: Emphasis on professional design with a business-appropriate color palette, semantic color classes, consistent styling via shadcn/ui, and responsive design. Preference for table-based layouts for ticket listings.

### Project Structure
- `client/`: React frontend application.
- `server/`: Express.js backend API.
- `shared/`: Shared TypeScript schemas and types.
- `migrations/`: Database migration files.

## External Dependencies

- **Database**: @neondatabase/serverless (PostgreSQL)
- **ORM**: drizzle-orm
- **Frontend State Management**: @tanstack/react-query
- **Authentication**: passport, express-session, connect-pg-simple
- **UI Framework**: @radix-ui/ (primitives for shadcn/ui), tailwindcss
- **Icons**: lucide-react
- **Routing**: wouter
- **Email Sending**: Amazon SES (Simple Email Service)
- **AI/ML**: AWS Bedrock (with Claude 3 Sonnet model)
- **Third-party Integrations**: Microsoft Teams (webhook notifications)
- **Password Hashing**: bcrypt
- **Form Management**: React Hook Form, Zod (for validation)
- **Development Tools**: vite, typescript, drizzle-kit, esbuild