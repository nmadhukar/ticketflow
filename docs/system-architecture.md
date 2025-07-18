# TicketFlow System Architecture

## Overview
TicketFlow is a modern, cloud-native ticketing system built with a microservices-oriented architecture. The system uses a three-tier architecture pattern with clear separation between presentation, business logic, and data layers.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                   Users                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Admin   │  │ Manager  │  │  User    │  │ Customer │  │  Guest   │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼─────────────┼─────────────┼─────────────┼─────────────┼───────────┘
        │             │             │             │             │
        └─────────────┴─────────────┴─────────────┴─────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Frontend Layer (React)                              │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │                          React Application                               │ │
│ │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐       │ │
│ │  │   Router   │  │   State    │  │    UI      │  │   Auth     │       │ │
│ │  │  (Wouter)  │  │  (TanStack │  │ (Shadcn/   │  │   Hooks    │       │ │
│ │  │            │  │   Query)   │  │    UI)     │  │            │       │ │
│ │  └────────────┘  └────────────┘  └────────────┘  └────────────┘       │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                          Vite Dev Server (HMR)                              │
└────────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                                    ▼ HTTPS/WSS
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Backend Layer (Express.js)                          │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │                         Express Application                              │ │
│ │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐       │ │
│ │  │   Routes   │  │Middleware  │  │  Storage   │  │   Auth     │       │ │
│ │  │    API     │  │  (Auth,    │  │ Interface  │  │ (Passport) │       │ │
│ │  │            │  │  Session)  │  │            │  │            │       │ │
│ │  └────────────┘  └────────────┘  └────────────┘  └────────────┘       │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                          ┌─────────┴──────────┐                             │
│                          │   Drizzle ORM      │                             │
│                          └─────────┬──────────┘                             │
└────────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Data Layer (PostgreSQL)                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │                         Neon Serverless PostgreSQL                       │ │
│ │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐       │ │
│ │  │   Users    │  │   Tasks    │  │   Teams    │  │  Sessions  │       │ │
│ │  │   Tables   │  │   Tables   │  │   Tables   │  │   Table    │       │ │
│ │  └────────────┘  └────────────┘  └────────────┘  └────────────┘       │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          External Services                                   │
│ ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│ │  Replit    │  │ Microsoft  │  │  SendGrid  │  │ Microsoft  │           │
│ │   Auth     │  │  Azure AD  │  │   Email    │  │   Teams    │           │
│ │  (OIDC)    │  │   (SSO)    │  │  Service   │  │  Webhooks  │           │
│ └────────────┘  └────────────┘  └────────────┘  └────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Frontend Layer
**Technology Stack**: React 18, TypeScript, Vite

**Key Components**:
- **React Router (Wouter)**: Lightweight client-side routing
- **State Management (TanStack Query)**: Server state synchronization and caching
- **UI Framework (Shadcn/UI)**: Component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **Build Tool**: Vite for development and production builds

**Responsibilities**:
- User interface rendering
- Client-side routing
- Form validation
- Real-time updates via WebSocket
- Authentication state management
- File upload handling

### Backend Layer
**Technology Stack**: Node.js, Express.js, TypeScript

**Key Components**:
- **Express Server**: RESTful API endpoints
- **Authentication**: Passport.js with multiple strategies (Replit OIDC, Microsoft Azure AD)
- **Session Management**: PostgreSQL-backed sessions using connect-pg-simple
- **Storage Interface**: Abstraction layer for database operations
- **Middleware**: Authentication, error handling, request logging

**Responsibilities**:
- API endpoint management
- Business logic execution
- Authentication and authorization
- Session management
- File storage coordination
- Email sending
- External service integration

### Data Layer
**Technology Stack**: PostgreSQL (Neon Serverless), Drizzle ORM

**Key Components**:
- **Neon Database**: Serverless PostgreSQL instance
- **Drizzle ORM**: Type-safe database queries
- **Connection Pooling**: Efficient database connections
- **Schema Management**: Migration and schema updates

**Responsibilities**:
- Data persistence
- Transaction management
- Query optimization
- Data integrity constraints
- Backup and recovery

## Authentication Flow

```
User → Landing Page → Replit/Microsoft Login → OAuth Provider
                                                     │
                                                     ▼
Backend ← Callback with tokens ← OAuth Provider
   │
   ▼
Create/Update User Record → Create Session → Redirect to App
```

## Data Flow

### Ticket Creation Flow
1. User fills out ticket form in React UI
2. Form data validated client-side using Zod schemas
3. API request sent to `/api/tasks` endpoint
4. Backend validates session and permissions
5. Storage interface creates ticket in database
6. Ticket history entry created for audit trail
7. Email/Teams notifications sent if configured
8. Response sent back to client
9. UI updates via TanStack Query cache invalidation

### Real-time Updates
1. WebSocket connection established on `/ws` path
2. Backend broadcasts updates to connected clients
3. Clients update UI based on received messages
4. TanStack Query cache synchronized

## Security Architecture

### Authentication Layers
1. **OAuth 2.0/OIDC**: Primary authentication via Replit or Microsoft
2. **Session Management**: Server-side sessions stored in PostgreSQL
3. **Role-Based Access Control**: Permissions based on user roles
4. **API Security**: All endpoints protected by authentication middleware

### Data Security
1. **Encryption in Transit**: HTTPS/TLS for all communications
2. **Encryption at Rest**: Database encryption via Neon
3. **Password Security**: SMTP passwords encrypted before storage
4. **API Key Management**: Keys hashed with only prefix visible
5. **File Security**: Secure file storage with access controls

## Scalability Considerations

### Horizontal Scaling
- **Frontend**: Static assets served via CDN
- **Backend**: Stateless design allows multiple instances
- **Database**: Neon serverless auto-scaling

### Performance Optimization
- **Caching**: TanStack Query for client-side caching
- **Database Indexes**: Strategic indexing for query performance
- **Connection Pooling**: Efficient database connection management
- **Code Splitting**: Vite-based code splitting for faster loads

## Deployment Architecture

### Development Environment
```
Developer Machine
    │
    ├── Frontend (Vite Dev Server - Port 5173)
    ├── Backend (TSX Watch Mode - Port 5000)
    └── Database (Neon Cloud)
```

### Production Environment
```
Replit Deployment
    │
    ├── Static Assets (Served by Express)
    ├── API Server (Express - Port 5000)
    ├── WebSocket Server (Same port, /ws path)
    └── Database (Neon Cloud)
```

## Integration Points

### External Services
1. **Replit Auth**: OIDC provider for user authentication
2. **Microsoft Azure AD**: Enterprise SSO integration
3. **SendGrid**: Transactional email service
4. **Microsoft Teams**: Webhook-based notifications
5. **File Storage**: External file storage service

### API Integration
- RESTful API design
- JSON request/response format
- Webhook support for external notifications
- API key authentication for third-party access

## Monitoring and Logging

### Application Monitoring
- Request/response logging
- Error tracking and reporting
- Performance metrics collection
- User activity tracking

### Infrastructure Monitoring
- Database query performance
- API endpoint response times
- WebSocket connection status
- External service availability

## Disaster Recovery

### Backup Strategy
- Automated database backups via Neon
- File storage redundancy
- Configuration backups

### Recovery Plan
1. Database restoration from backups
2. Application redeployment
3. File storage recovery
4. Configuration restoration

## Future Architecture Considerations

### Potential Enhancements
1. **Microservices Split**: Separate notification service
2. **Message Queue**: Asynchronous task processing
3. **Redis Cache**: Session and data caching
4. **GraphQL API**: Alternative to REST endpoints
5. **Kubernetes Deployment**: Container orchestration
6. **AI Service Integration**: Enhanced ticket routing and suggestions