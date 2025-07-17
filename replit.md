# Replit.md

## Overview

This is a full-stack task management application called TaskFlow built with a modern tech stack. It features a React frontend with shadcn/ui components, an Express.js backend, and PostgreSQL database using Drizzle ORM. The application supports team collaboration, task management, and user authentication through Replit's OpenID Connect system.

## User Preferences

Preferred communication style: Simple, everyday language.

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
- **Users**: Profile information synced from Replit
- **Tasks**: Core task management with status, priority, categories
- **Teams**: Team organization with membership management
- **Task Comments**: Discussion threads on tasks
- **Task History**: Audit trail for task changes
- **Sessions**: Authentication session persistence

### API Design
- **RESTful endpoints**: `/api/tasks`, `/api/teams`, `/api/auth`
- **Authentication middleware**: Route protection with session validation
- **Error handling**: Centralized error handling with proper HTTP status codes
- **Request logging**: Automatic API request/response logging

### UI Components
- **Design System**: shadcn/ui with consistent styling
- **Responsive Design**: Mobile-first approach with Tailwind breakpoints
- **Navigation**: Sidebar-based layout with protected routing
- **Forms**: React Hook Form with Zod validation
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