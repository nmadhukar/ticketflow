# TicketFlow Developer Documentation

## Table of Contents

1. [Code Architecture & Structure](#code-architecture--structure)
2. [Detailed Function/Class Documentation](#detailed-functionclass-documentation)
3. [Database & Data Models](#database--data-models)
4. [API Documentation](#api-documentation)
5. [Configuration & Environment](#configuration--environment)
6. [Maintenance Guidelines](#maintenance-guidelines)
7. [Security Considerations](#security-considerations)

## Code Architecture & Structure

### Overall Architecture

TicketFlow follows a modern full-stack architecture with clear separation of concerns:

- **Frontend**: React 18 with TypeScript using shadcn/ui components
- **Backend**: Express.js with TypeScript, RESTful API design
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **AI Integration**: AWS Bedrock with Claude 3 Sonnet for intelligent ticket analysis
- **Authentication**: Passport.js with email/password and Microsoft 365 SSO
- **Real-time**: WebSocket server for live updates
- **File Storage**: Multer for file uploads with 10MB limit

### Design Patterns Used

1. **Repository Pattern**: Data access abstracted through `storage.ts` interface
2. **Middleware Pattern**: Express middleware for authentication, security, and logging
3. **Observer Pattern**: WebSocket connections for real-time updates
4. **Factory Pattern**: AI service initialization and configuration
5. **Strategy Pattern**: Multiple authentication strategies (local, Microsoft)

### Directory Structure

```
├── client/                          # React frontend application
│   ├── src/
│   │   ├── components/              # Reusable UI components
│   │   │   ├── ui/                  # shadcn/ui components
│   │   │   ├── AiChatBot.tsx        # AI chat interface
│   │   │   ├── sidebar.tsx          # Navigation sidebar
│   │   │   └── task-modal.tsx       # Ticket creation/editing modal
│   │   ├── pages/                   # Route-based page components
│   │   │   ├── dashboard.tsx        # Main dashboard
│   │   │   ├── ai-settings.tsx     # AI configuration panel
│   │   │   ├── knowledge-base.tsx   # Knowledge management
│   │   │   └── admin.tsx            # Admin panel
│   │   ├── hooks/                   # Custom React hooks
│   │   │   ├── useAuth.ts           # Authentication state
│   │   │   └── useWebSocket.tsx     # WebSocket connections
│   │   ├── lib/                     # Utility functions
│   │   │   ├── queryClient.ts       # TanStack Query configuration
│   │   │   └── utils.ts             # Common utilities
│   │   └── App.tsx                  # Main app component with routing
│   └── index.html                   # HTML entry point
├── server/                          # Express.js backend
│   ├── security/                    # Security modules
│   │   ├── jwt.ts                   # JWT token handling
│   │   ├── rbac.ts                  # Role-based access control
│   │   ├── rateLimiting.ts          # API rate limiting
│   │   └── validation.ts            # Input validation
│   ├── __tests__/                   # Test files
│   ├── aiTicketAnalysis.ts          # AI ticket processing
│   ├── knowledgeBaseLearning.ts     # Knowledge base automation
│   ├── bedrockIntegration.ts        # AWS Bedrock client
│   ├── auth.ts                      # Authentication middleware
│   ├── routes.ts                    # API route definitions
│   ├── storage.ts                   # Database abstraction layer
│   ├── index.ts                     # Server entry point
│   └── vite.ts                      # Vite development server setup
├── shared/                          # Shared TypeScript definitions
│   └── schema.ts                    # Database schema and types
├── docs/                            # Technical documentation
├── migrations/                      # Database migration files
└── attached_assets/                 # Static assets and uploads
```

### Data Flow

#### Request-Response Flow
1. Client makes HTTP request → Express middleware → Authentication check
2. Route handler validates input → Storage layer → Database operation
3. Response transformation → JSON serialization → Client update
4. TanStack Query cache invalidation → UI re-render

#### AI Processing Flow
1. Ticket creation → AI analysis trigger → AWS Bedrock API call
2. Response evaluation → Confidence scoring → Auto-response generation
3. Knowledge base learning → Pattern extraction → Article creation
4. Real-time notification via WebSocket → UI update

## Detailed Function/Class Documentation

### Core Components

#### Storage Layer (`server/storage.ts`)

**Purpose**: Provides database abstraction with type-safe operations

**Key Methods**:

```typescript
// User Management
async getUser(id: string): Promise<User | undefined>
async createUser(user: InsertUser): Promise<User>
async getAllUsers(): Promise<User[]>
async updateUserRole(id: string, role: string): Promise<void>

// Task Management  
async createTask(task: InsertTask): Promise<Task>
async getTaskById(id: number): Promise<Task | undefined>
async updateTask(id: number, updates: Partial<Task>): Promise<Task>
async getTasksByUser(userId: string): Promise<Task[]>

// Team Management
async createTeam(team: InsertTeam): Promise<Team>
async addUserToTeam(teamId: number, userId: string, role: string): Promise<void>
async getTeamMembers(teamId: number): Promise<TeamMember[]>
```

**Error Handling**: All methods use try-catch blocks with detailed error logging

#### AI Analysis (`server/aiTicketAnalysis.ts`)

**Purpose**: Intelligent ticket processing using AWS Bedrock

**Key Functions**:

```typescript
async function analyzeTicket(ticket: Task): Promise<AnalysisResult>
// Input: Task object with title, description, category
// Output: { confidence: number, suggestedResponse: string, complexity: number }
// Side Effects: Creates analysis record in database
// Performance: ~2-5 seconds per analysis

async function generateAutoResponse(analysis: AnalysisResult): Promise<string>
// Input: Analysis result with confidence score
// Output: Generated response text
// Threshold: Only auto-responds if confidence > 70%
```

**Performance Considerations**:
- Rate limited to 20 requests/minute per user
- Implements exponential backoff for API failures
- Caches responses for 1 hour to reduce API calls

#### Authentication (`server/auth.ts`)

**Purpose**: Multi-strategy authentication with session management

**Strategies**:
1. **Local Strategy**: Email/password with bcrypt hashing
2. **Microsoft Strategy**: Azure AD integration with OIDC

**Security Features**:
- Password complexity validation
- Account lockout after 5 failed attempts
- Session storage in PostgreSQL
- CSRF protection with helmet

### Frontend Components

#### useAuth Hook (`client/src/hooks/useAuth.ts`)

**Purpose**: Centralized authentication state management

```typescript
interface AuthContext {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Usage
const { user, isAuthenticated } = useAuth();
```

#### TaskModal Component (`client/src/components/task-modal.tsx`)

**Purpose**: Unified ticket creation and editing interface

**Features**:
- Tabbed interface for details and comments
- Real-time validation with react-hook-form
- File attachment support
- Auto-assignment suggestions

## Database & Data Models

### Schema Overview

The database uses PostgreSQL with the following core tables:

#### Users Table
```sql
CREATE TABLE users (
  id VARCHAR PRIMARY KEY,
  email VARCHAR UNIQUE,
  password VARCHAR,           -- bcrypt hashed
  first_name VARCHAR,
  last_name VARCHAR,
  role VARCHAR(50) DEFAULT 'user',
  department VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Tasks Table
```sql
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  ticket_number VARCHAR(20) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'open',
  priority VARCHAR(20) DEFAULT 'medium',
  assignee_id VARCHAR REFERENCES users(id),
  created_by VARCHAR REFERENCES users(id),
  due_date TIMESTAMP,
  tags TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### AI Integration Tables
```sql
-- Auto-response tracking
CREATE TABLE ticket_auto_responses (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id),
  response_text TEXT,
  confidence_score DECIMAL(3,2),
  was_helpful BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Knowledge articles
CREATE TABLE knowledge_articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(100),
  tags TEXT[],
  effectiveness_score DECIMAL(3,2),
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Relationships

- **Users → Tasks**: One-to-many (creator and assignee)
- **Teams → Users**: Many-to-many through team_members
- **Tasks → Comments**: One-to-many
- **Tasks → Attachments**: One-to-many
- **Tasks → History**: One-to-many (audit trail)

### Indexing Strategy

```sql
-- Performance indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX idx_sessions_expire ON sessions(expire);

-- Search indexes
CREATE INDEX idx_tasks_title_gin ON tasks USING gin(to_tsvector('english', title));
CREATE INDEX idx_knowledge_content_gin ON knowledge_articles USING gin(to_tsvector('english', content));
```

### Migration Approach

Uses Drizzle Kit for schema management:

```bash
# Generate migration
npm run db:generate

# Apply migration  
npm run db:push

# Migrate production
npm run db:migrate
```

## API Documentation

### Authentication Endpoints

#### POST /api/register
Creates new user account with admin approval required.

**Request**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response**:
```json
{
  "id": "user-uuid",
  "email": "user@example.com", 
  "isApproved": false,
  "message": "Account created. Awaiting admin approval."
}
```

**Authentication**: None required
**Rate Limiting**: 5 requests per 15 minutes per IP

#### POST /api/login
Authenticates user and creates session.

**Request**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response**:
```json
{
  "id": "user-uuid",
  "email": "user@example.com",
  "role": "user",
  "isApproved": true
}
```

### Task Management Endpoints

#### GET /api/tasks
Retrieves tasks with filtering and pagination.

**Query Parameters**:
- `status`: Filter by status (open, in_progress, resolved, closed)
- `assignee`: Filter by assignee ID
- `limit`: Results per page (default: 50)
- `offset`: Results offset (default: 0)
- `search`: Text search in title/description

**Example Request**:
```bash
curl -H "Cookie: connect.sid=session_id" \
  "https://api.ticketflow.com/api/tasks?status=open&limit=25"
```

**Response**:
```json
{
  "tasks": [
    {
      "id": 1,
      "ticketNumber": "TKT-2024-0001",
      "title": "Login page not responsive",
      "status": "open",
      "priority": "high",
      "assigneeId": "user-uuid",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 156,
  "hasMore": true
}
```

#### POST /api/tasks
Creates new ticket with optional AI analysis.

**Request**:
```json
{
  "title": "Database connection timeout",
  "description": "Users experiencing timeout errors when logging in",
  "category": "bug",
  "priority": "high",
  "assigneeId": "user-uuid",
  "dueDate": "2024-02-01T00:00:00Z",
  "tags": ["database", "authentication"]
}
```

**Response**:
```json
{
  "id": 2,
  "ticketNumber": "TKT-2024-0002",
  "title": "Database connection timeout",
  "status": "open",
  "aiAnalysis": {
    "confidence": 0.85,
    "suggestedResponse": "This appears to be a database connectivity issue...",
    "autoResponseGenerated": true
  }
}
```

### AI Endpoints

#### GET /api/admin/ai-analytics
Retrieves AI performance metrics.

**Authentication**: Admin role required

**Response**:
```json
{
  "autoResponsesSent": 45,
  "avgConfidence": 0.78,
  "ticketsResolvedByAI": 12,
  "knowledgeArticlesCreated": 8,
  "topCategories": [
    {"category": "Database", "count": 15},
    {"category": "Authentication", "count": 12}
  ]
}
```

#### POST /api/admin/ai-settings
Updates AI configuration parameters.

**Request**:
```json
{
  "confidenceThreshold": 0.75,
  "autoResponseEnabled": true,
  "maxResponseLength": 1000,
  "bedrockModel": "anthropic.claude-3-sonnet-20240229-v1:0"
}
```

### Error Responses

All endpoints return consistent error format:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid input parameters",
  "details": [
    {
      "field": "email",
      "message": "Valid email address required"
    }
  ],
  "timestamp": "2024-01-15T10:00:00Z"
}
```

**HTTP Status Codes**:
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication required)
- `403`: Forbidden (insufficient permissions)  
- `404`: Not Found
- `429`: Too Many Requests (rate limited)
- `500`: Internal Server Error

## Configuration & Environment

### Environment Variables

#### Required Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/ticketflow
PGHOST=localhost
PGPORT=5432
PGUSER=ticketflow_user
PGPASSWORD=secure_password
PGDATABASE=ticketflow

# Authentication
SESSION_SECRET=long-random-string-for-session-encryption

# AWS Integration
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=secret-key
AWS_REGION=us-east-1

# Microsoft SSO (Optional)
MICROSOFT_CLIENT_ID=your-azure-app-id
MICROSOFT_CLIENT_SECRET=azure-app-secret
MICROSOFT_TENANT_ID=azure-tenant-id
```

#### Optional Variables

```bash
# Development
NODE_ENV=development
PORT=5000
REPL_ID=replit-deployment-id

# Email (if not using AWS SES)
SENDGRID_API_KEY=SG.xxx

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Configuration Files

#### `drizzle.config.ts`
Database configuration for migrations:

```typescript
export default {
  schema: "./shared/schema.ts",
  out: "./migrations",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
};
```

#### `vite.config.ts`
Frontend build configuration:

```typescript
export default defineConfig({
  plugins: [react(), runtimeErrorOverlay()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
```

### Third-party Service Integration

#### AWS Bedrock Setup
1. Create IAM user with Bedrock permissions
2. Configure access keys in environment
3. Test connection via admin panel

#### Microsoft 365 Integration
1. Register application in Azure Portal
2. Configure redirect URLs
3. Add Microsoft Graph API permissions
4. Set environment variables

### Deployment Requirements

#### Server Specifications
- **CPU**: 2+ cores
- **RAM**: 4GB minimum, 8GB recommended  
- **Storage**: 20GB for application, additional for file uploads
- **Network**: HTTPS required for production

#### Dependencies
- Node.js 18+ with npm
- PostgreSQL 13+ with extensions: `uuid-ossp`, `pg_trgm`
- SSL certificate for production deployment

## Maintenance Guidelines

### Common Maintenance Tasks

#### Database Maintenance

```bash
# Backup database
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Analyze table performance
ANALYZE tasks;
ANALYZE knowledge_articles;

# Vacuum tables weekly
VACUUM ANALYZE;

# Reindex search columns monthly
REINDEX INDEX idx_tasks_title_gin;
```

#### Log Management

```bash
# Rotate application logs
logrotate /var/log/ticketflow/app.log

# Archive old audit trails (90+ days)
DELETE FROM task_history WHERE created_at < NOW() - INTERVAL '90 days';

# Clean expired sessions
DELETE FROM sessions WHERE expire < NOW();
```

### Adding New Features

#### 1. Database Changes
```typescript
// 1. Add to shared/schema.ts
export const newTable = pgTable("new_table", {
  id: serial("id").primaryKey(),
  // ... fields
});

// 2. Generate migration
npm run db:generate

// 3. Apply to development
npm run db:push
```

#### 2. API Endpoints
```typescript
// Add to server/routes.ts
app.get('/api/new-feature', isAuthenticated, async (req, res) => {
  try {
    const result = await storage.getNewFeatureData();
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
```

#### 3. Frontend Components
```typescript
// Create in client/src/pages/
export default function NewFeaturePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/new-feature'],
  });
  
  // Component logic
}
```

### Testing Approach

#### Unit Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- auth.test.ts

# Coverage report
npm test -- --coverage
```

#### Integration Tests
```typescript
// Example: __tests__/integration/api.test.ts
describe('Task API', () => {
  it('should create task with valid data', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .send(validTaskData)
      .expect(201);
    
    expect(response.body.ticketNumber).toMatch(/TKT-\d{4}-\d{4}/);
  });
});
```

#### Load Testing
```bash
# Install k6
curl https://github.com/grafana/k6/releases/download/v0.40.0/k6-v0.40.0-linux-amd64.tar.gz

# Run load test
k6 run load-test.js
```

### Debugging Tips

#### Common Issues

1. **Database Connection Timeouts**
   ```bash
   # Check connection pool
   SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
   
   # Increase pool size in storage.ts
   const pool = new Pool({ max: 20 });
   ```

2. **AI Analysis Failures**
   ```bash
   # Check AWS credentials
   aws sts get-caller-identity
   
   # Verify Bedrock model access
   aws bedrock list-foundation-models --region us-east-1
   ```

3. **Session Issues**
   ```bash
   # Clear Redis/session store
   DELETE FROM sessions WHERE expire < NOW();
   
   # Check session configuration
   console.log(req.sessionID, req.session);
   ```

#### Logging

```typescript
// Structured logging example
import { logger } from './utils/logger';

logger.info('Task created', {
  taskId: task.id,
  userId: req.user.id,
  category: task.category
});

logger.error('AI analysis failed', {
  taskId: task.id,
  error: error.message,
  retryCount: 3
});
```

### Code Style Guidelines

#### TypeScript/JavaScript

```typescript
// Use explicit types
interface TaskCreateRequest {
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

// Prefer async/await over promises
async function createTask(data: TaskCreateRequest): Promise<Task> {
  try {
    return await storage.createTask(data);
  } catch (error) {
    logger.error('Task creation failed', error);
    throw error;
  }
}

// Use descriptive variable names
const unassignedHighPriorityTasks = tasks.filter(
  task => !task.assigneeId && task.priority === 'high'
);
```

#### React Components

```typescript
// Use function components with hooks
interface TaskListProps {
  status?: TaskStatus;
  onTaskSelect: (task: Task) => void;
}

export function TaskList({ status, onTaskSelect }: TaskListProps) {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['/api/tasks', { status }],
  });

  if (isLoading) return <LoadingSpinner />;
  
  return (
    <div className="space-y-2">
      {tasks?.map(task => (
        <TaskCard
          key={task.id}
          task={task}
          onClick={() => onTaskSelect(task)}
        />
      ))}
    </div>
  );
}
```

## Security Considerations

### Authentication & Authorization

#### Password Security
- **Hashing**: bcrypt with 12 salt rounds
- **Complexity**: Minimum 8 characters, mixed case, numbers, symbols
- **Reset**: Secure token-based password reset with expiration
- **Lockout**: Account locked after 5 failed attempts for 15 minutes

#### Session Management
- **Storage**: PostgreSQL session store for persistence
- **Expiration**: 7-day sliding expiration
- **Security**: HttpOnly, Secure cookies in production
- **CSRF**: Protection via express-session and helmet

#### Role-Based Access Control

```typescript
// Middleware example
function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

// Usage
app.delete('/api/admin/users/:id', requireRole(['admin']), deleteUser);
```

### Data Validation & Sanitization

#### Input Validation
```typescript
// Zod schemas for validation
const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assigneeId: z.string().uuid().optional(),
});

// Express validator middleware
app.post('/api/tasks', 
  validate(createTaskSchema),
  createTask
);
```

#### SQL Injection Prevention
- **Drizzle ORM**: Parameterized queries prevent SQL injection
- **Input Sanitization**: All user input validated and sanitized
- **Least Privilege**: Database user has minimal required permissions

### API Security

#### Rate Limiting
```typescript
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', rateLimiter);
```

#### Security Headers
```typescript
// Helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

### AWS Security

#### IAM Configuration
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-*"
    },
    {
      "Effect": "Allow", 
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Data Encryption
- **In Transit**: TLS 1.3 for all API communication
- **At Rest**: PostgreSQL encryption with AWS RDS
- **Credentials**: AWS Secrets Manager for production secrets
- **File Uploads**: Virus scanning before storage

### Audit & Monitoring

#### Security Audit Logging
```typescript
// Security event logging
function logSecurityEvent(event: string, details: any) {
  logger.warn('Security Event', {
    event,
    userId: details.userId,
    ip: details.ip,
    userAgent: details.userAgent,
    timestamp: new Date().toISOString(),
    ...details
  });
}

// Usage examples
logSecurityEvent('LOGIN_FAILED', { email, ip, attempts: 3 });
logSecurityEvent('ADMIN_ACTION', { action: 'USER_DELETED', targetId });
```

#### Vulnerability Scanning
```bash
# Regular dependency audits
npm audit
npm audit fix

# Security scanning
npm install -g snyk
snyk test
snyk monitor
```

### Potential Security Risks

1. **File Upload Vulnerabilities**
   - **Mitigation**: File type validation, size limits, virus scanning
   - **Storage**: Isolated from application directory

2. **AI Prompt Injection**
   - **Mitigation**: Input sanitization, prompt templates, output validation
   - **Monitoring**: Log suspicious AI requests

3. **Session Hijacking**
   - **Mitigation**: Secure cookies, IP validation, session rotation
   - **Detection**: Monitor for concurrent sessions

4. **Data Exposure**
   - **Mitigation**: Column-level permissions, data masking for sensitive fields
   - **Compliance**: GDPR-compliant data handling

This documentation provides a comprehensive guide for maintaining and extending the TicketFlow codebase. Keep it updated as the application evolves and new features are added.