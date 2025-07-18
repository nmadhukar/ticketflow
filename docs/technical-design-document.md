# TicketFlow Technical Design Document

## 1. Introduction

### 1.1 Purpose
This document provides a comprehensive technical design for TicketFlow, a modern ticketing system designed for small businesses. It outlines the technical architecture, design decisions, implementation details, and integration strategies.

### 1.2 Scope
TicketFlow is a full-stack web application that provides:
- Ticket management with complete lifecycle tracking
- Role-based access control with four user roles
- Team collaboration features
- Email and Microsoft Teams integration
- AI-powered help system
- Comprehensive audit trails

### 1.3 Definitions and Acronyms
- **RBAC**: Role-Based Access Control
- **SSO**: Single Sign-On
- **OIDC**: OpenID Connect
- **HMR**: Hot Module Replacement
- **ORM**: Object-Relational Mapping
- **API**: Application Programming Interface
- **SMTP**: Simple Mail Transfer Protocol

## 2. System Overview

### 2.1 High-Level Architecture
TicketFlow follows a three-tier architecture:
1. **Presentation Layer**: React-based single-page application
2. **Application Layer**: Express.js REST API server
3. **Data Layer**: PostgreSQL database with Drizzle ORM

### 2.2 Key Design Principles
- **Type Safety**: Full TypeScript implementation across stack
- **Security First**: OAuth 2.0 authentication, encrypted storage
- **Scalability**: Stateless backend, serverless database
- **User Experience**: Responsive design, real-time updates
- **Maintainability**: Modular architecture, clear separation of concerns

## 3. Frontend Design

### 3.1 Technology Stack
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **UI Library**: Shadcn/UI (Radix UI primitives + Tailwind CSS)
- **State Management**: TanStack Query for server state
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation
- **Styling**: Tailwind CSS with CSS variables for theming

### 3.2 Component Architecture

#### 3.2.1 Core Components
```
src/
├── components/
│   ├── ui/              # Shadcn/UI components
│   ├── layout/          # Layout components (Header, Sidebar, Footer)
│   ├── tickets/         # Ticket-related components
│   ├── teams/           # Team management components
│   └── shared/          # Shared/common components
├── hooks/               # Custom React hooks
├── lib/                 # Utility functions and helpers
├── pages/               # Page components (route handlers)
└── App.tsx             # Main application component
```

#### 3.2.2 Key Design Patterns
- **Container/Presentational Components**: Separation of logic and UI
- **Custom Hooks**: Reusable business logic
- **Compound Components**: Complex UI patterns (e.g., TaskModal)
- **Render Props**: Flexible component composition

### 3.3 State Management Strategy

#### 3.3.1 Server State (TanStack Query)
```typescript
// Query for fetching tasks
const { data: tasks, isLoading } = useQuery({
  queryKey: ["/api/tasks"],
  staleTime: 5 * 60 * 1000, // 5 minutes
});

// Mutation for updating tasks
const updateTaskMutation = useMutation({
  mutationFn: (data) => apiRequest("/api/tasks", { method: "PATCH", body: JSON.stringify(data) }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
});
```

#### 3.3.2 Local State
- Component state for UI interactions
- Context API for theme and authentication state
- No global state management library needed

### 3.4 Routing Architecture
```typescript
// App.tsx routing structure
<Switch>
  {isLoading || !isAuthenticated ? (
    <Route path="/" component={Landing} />
  ) : (
    <>
      <Route path="/" component={Dashboard} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/teams" component={Teams} />
      <ProtectedRoute path="/admin" component={Admin} allowedRoles={["admin"]} />
    </>
  )}
</Switch>
```

### 3.5 Performance Optimizations
- **Code Splitting**: Dynamic imports for large components
- **Lazy Loading**: Images and heavy components
- **Memoization**: React.memo for expensive renders
- **Virtual Scrolling**: For large lists
- **Optimistic Updates**: Immediate UI feedback

## 4. Backend Design

### 4.1 Technology Stack
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js
- **Session Management**: express-session with PostgreSQL store
- **WebSocket**: ws library for real-time features

### 4.2 API Architecture

#### 4.2.1 RESTful Endpoints
```
/api/auth/
  GET    /user          # Get current user
  POST   /logout        # Logout user

/api/tasks/
  GET    /              # List tasks (with filters)
  POST   /              # Create task
  GET    /:id           # Get task details
  PATCH  /:id           # Update task
  DELETE /:id           # Delete task

/api/teams/
  GET    /              # List teams
  POST   /              # Create team
  GET    /:id           # Get team details
  PATCH  /:id           # Update team
  DELETE /:id           # Delete team
  POST   /:id/members   # Add team member
  DELETE /:id/members/:userId  # Remove team member
```

#### 4.2.2 Middleware Stack
```typescript
app.use(helmet());                    // Security headers
app.use(compression());               // Response compression
app.use(express.json());              // JSON parsing
app.use(session(sessionConfig));      // Session management
app.use(passport.initialize());       // Authentication
app.use(passport.session());          // Session authentication
app.use(rateLimiter);                 // Rate limiting
app.use(errorHandler);                // Error handling
```

### 4.3 Authentication & Authorization

#### 4.3.1 Authentication Flow
1. User initiates login via Replit or Microsoft
2. OAuth provider authenticates user
3. Callback returns with user tokens
4. Backend creates/updates user record
5. Session established in PostgreSQL
6. Subsequent requests validated via session

#### 4.3.2 Role-Based Access Control
```typescript
const rolePermissions = {
  admin: ["*"], // All permissions
  manager: ["tasks:*", "teams:*", "users:read"],
  user: ["tasks:create", "tasks:read", "tasks:update:own"],
  customer: ["tasks:create:own", "tasks:read:own", "tasks:update:own"]
};
```

### 4.4 Database Design

#### 4.4.1 Connection Management
```typescript
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

#### 4.4.2 Query Patterns
- **Prepared Statements**: Prevent SQL injection
- **Transactions**: Ensure data consistency
- **Bulk Operations**: Efficient batch processing
- **Cursor Pagination**: For large result sets

### 4.5 Business Logic Layer

#### 4.5.1 Storage Interface Pattern
```typescript
interface IStorage {
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getTask(id: number): Promise<Task | undefined>;
  updateTask(id: number, updates: Partial<Task>, userId: string): Promise<Task>;
  
  // Team operations
  createTeam(team: InsertTeam): Promise<Team>;
  addTeamMember(teamId: number, userId: string, role: string): Promise<void>;
  
  // User operations
  getUser(id: string): Promise<User | undefined>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;
}
```

#### 4.5.2 Service Layer
- **TaskService**: Business logic for ticket management
- **TeamService**: Team and member management
- **NotificationService**: Email and Teams notifications
- **AuditService**: History and activity tracking

## 5. Database Design

### 5.1 Schema Design Principles
- **Normalization**: 3NF for data integrity
- **Denormalization**: Strategic for performance
- **Audit Trail**: Complete history tracking
- **Soft Deletes**: Data retention with isActive flags

### 5.2 Key Design Decisions

#### 5.2.1 Ticket Number Generation
```sql
-- Format: TKT-YYYY-XXXX
-- Example: TKT-2024-0001
CREATE SEQUENCE ticket_number_seq;
```

#### 5.2.2 Polymorphic Associations
- Tasks can be assigned to users OR teams
- Handled via assigneeType and separate foreign keys

#### 5.2.3 Array Columns
- PostgreSQL arrays for tags and permissions
- Efficient for small, frequently accessed lists

### 5.3 Performance Optimization
- **Indexes**: On foreign keys and frequently queried columns
- **Partial Indexes**: For filtered queries
- **Composite Indexes**: For multi-column queries
- **Query Optimization**: EXPLAIN ANALYZE for tuning

## 6. Integration Design

### 6.1 Authentication Providers

#### 6.1.1 Replit OIDC Integration
```typescript
const config = await client.discovery(
  new URL(process.env.ISSUER_URL || "https://replit.com/oidc"),
  process.env.REPL_ID
);
```

#### 6.1.2 Microsoft Azure AD SSO
```typescript
passport.use(new OIDCStrategy({
  identityMetadata: `https://login.microsoftonline.com/${TENANT_ID}/v2.0/.well-known/openid-configuration`,
  clientID: CLIENT_ID,
  responseType: 'code',
  responseMode: 'form_post',
  redirectUrl: REDIRECT_URL,
  allowHttpForRedirectUrl: true,
  clientSecret: CLIENT_SECRET,
  scope: ['openid', 'email', 'profile']
}, verifyCallback));
```

### 6.2 Email Integration (SendGrid)
```typescript
const mailService = new MailService();
mailService.setApiKey(process.env.SENDGRID_API_KEY);

// Template-based email sending
await mailService.send({
  to: recipient,
  from: sender,
  templateId: 'd-xxxxx',
  dynamicTemplateData: { ticketNumber, title, assignee }
});
```

### 6.3 Microsoft Teams Integration
```typescript
// Webhook notification
await axios.post(webhookUrl, {
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  "themeColor": "0076D7",
  "summary": "New Ticket Created",
  "sections": [{
    "activityTitle": ticketNumber,
    "activitySubtitle": title,
    "facts": [
      { "name": "Priority", "value": priority },
      { "name": "Assigned to", "value": assignee }
    ]
  }]
});
```

## 7. Security Design

### 7.1 Authentication Security
- **OAuth 2.0/OIDC**: Industry standard protocols
- **Session Security**: HTTP-only, secure cookies
- **CSRF Protection**: Token validation
- **Session Timeout**: Automatic expiration

### 7.2 Data Security
- **Input Validation**: Zod schemas for all inputs
- **SQL Injection Prevention**: Parameterized queries
- **XSS Prevention**: React's automatic escaping
- **File Upload Security**: Type and size validation

### 7.3 API Security
- **Rate Limiting**: Prevent abuse
- **API Keys**: Hashed storage with permissions
- **CORS Configuration**: Restricted origins
- **Request Validation**: Schema validation

### 7.4 Infrastructure Security
- **HTTPS Enforcement**: TLS for all communications
- **Environment Variables**: Secure secret management
- **Database Encryption**: At-rest encryption
- **Audit Logging**: Security event tracking

## 8. Performance Design

### 8.1 Frontend Performance
- **Bundle Size Optimization**: Tree shaking, code splitting
- **Asset Optimization**: Image compression, lazy loading
- **Caching Strategy**: Service worker for offline support
- **Performance Monitoring**: Web Vitals tracking

### 8.2 Backend Performance
- **Query Optimization**: Efficient SQL queries
- **Caching Layer**: In-memory caching for frequent data
- **Connection Pooling**: Database connection reuse
- **Async Processing**: Non-blocking operations

### 8.3 Scalability Design
- **Horizontal Scaling**: Stateless backend design
- **Load Balancing**: Ready for multiple instances
- **Database Scaling**: Neon serverless auto-scaling
- **CDN Integration**: Static asset delivery

## 9. Error Handling & Logging

### 9.1 Error Handling Strategy
```typescript
// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});
```

### 9.2 Logging Architecture
- **Request Logging**: All API requests
- **Error Logging**: Exceptions and failures
- **Audit Logging**: User actions and changes
- **Performance Logging**: Slow queries and operations

## 10. Testing Strategy

### 10.1 Unit Testing
- **Frontend**: Jest + React Testing Library
- **Backend**: Jest for business logic
- **Database**: Test database for integration tests

### 10.2 Integration Testing
- **API Testing**: Supertest for endpoint testing
- **Database Testing**: Transaction rollback for isolation
- **Authentication Testing**: Mock OAuth providers

### 10.3 End-to-End Testing
- **User Flows**: Critical path testing
- **Cross-Browser**: Compatibility testing
- **Performance Testing**: Load and stress testing

## 11. Deployment Design

### 11.1 Build Process
```bash
# Frontend build
npm run build:client  # Vite production build

# Backend build
npm run build:server  # TypeScript compilation

# Combined build
npm run build        # Both frontend and backend
```

### 11.2 Deployment Architecture
- **Replit Deployment**: Integrated deployment system
- **Environment Configuration**: Environment variables
- **Health Checks**: Automated monitoring
- **Rollback Strategy**: Version control integration

## 12. Future Enhancements

### 12.1 Planned Features
1. **Advanced Search**: Elasticsearch integration
2. **Mobile Apps**: React Native applications
3. **Workflow Automation**: Custom ticket workflows
4. **Advanced Analytics**: Business intelligence dashboard
5. **API v2**: GraphQL endpoint
6. **Webhook System**: External integrations

### 12.2 Technical Improvements
1. **Microservices Architecture**: Service separation
2. **Message Queue**: RabbitMQ/Redis for async processing
3. **Caching Layer**: Redis for session and data caching
4. **Container Orchestration**: Kubernetes deployment
5. **CI/CD Pipeline**: Automated testing and deployment