# TicketFlow - Enterprise Ticketing System

A comprehensive enterprise-grade ticketing system designed for small to medium businesses, featuring advanced task management, team collaboration, and AI-powered assistance.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Setup](#environment-setup)
- [Development](#development)
- [Testing](#testing)
- [API Documentation](#api-documentation)
- [Security](#security)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## Features

### Core Features

- **Advanced Ticket Management**: Create, track, and manage tickets with custom numbering (configurable prefix)
- **Role-Based Access Control**: Admin, Manager, User, and Customer roles with granular permissions
- **Team Collaboration**: Create teams, assign tickets, and collaborate with comments
- **File Attachments**: Upload and manage file attachments for tickets
- **Audit Trail**: Complete history tracking for all ticket changes
- **Real-time Activity Feed**: Track recent activities across the system

### Enterprise Features

- **Microsoft 365 SSO Integration**: Seamless authentication with Microsoft accounts
- **Microsoft Teams Integration**: Automatic notifications to Teams channels
- **Email Integration**: Send and receive emails using AWS SES
- **AI-Powered Assistant**: AWS Bedrock-powered chatbot that learns from your documentation
- **Company Branding**: Custom logos and branding configuration
- **Department Management**: Organize users into departments with managers
- **User Invitation System**: Invite users via email with auto-approval

### Advanced Features

- **Help Documentation System**: Upload and manage help documents (Word, PDF)
- **User Guide Management**: Create and organize user guides by category
- **Company Policy Management**: Upload and manage company policy documents
- **Customizable Email Templates**: Design and manage email templates
- **API Key Management**: Secure management of third-party API integrations
- **Usage Monitoring**: Track AI usage and costs

## Architecture

### Technology Stack

#### Frontend

- **Framework**: React 18 with TypeScript
- **UI Components**: shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS with CSS variables
- **State Management**: TanStack Query v5
- **Routing**: Wouter
- **Build Tool**: Vite
- **Icons**: Lucide React & React Icons

#### Backend

- **Runtime**: Node.js with Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL (Neon Serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js with local strategy & Microsoft OAuth
- **Session Management**: Express sessions with PostgreSQL store
- **Email Service**: AWS SES
- **AI Service**: AWS Bedrock (Claude 3 Sonnet)

### Database Schema

The system uses a comprehensive relational database schema:

- **Users**: User profiles with roles and permissions
- **Tasks**: Tickets with status, priority, severity tracking
- **Teams**: Team organization and membership
- **Comments**: Ticket discussions and updates
- **Attachments**: File attachments for tickets
- **Task History**: Audit trail for all changes
- **Departments**: Organizational structure
- **User Invitations**: Email-based user invitations
- **Email Templates**: Customizable email templates
- **Help Documents**: Help and policy documentation
- **User Guides**: Categorized user guides
- **AI Chat Messages**: AI assistant conversation history

## Prerequisites

- Node.js 22.12+ (the Docker image uses Node 24)
- PostgreSQL database (provided by Neon)
- AWS Account (for SES and Bedrock)
- Microsoft Azure AD App Registration (optional, for SSO)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/your-org/ticketflow.git
cd ticketflow
```

2. Install dependencies:

```bash
npm install
```

3. Set up the database:

```bash
npm run db:push
```

4. Seed email templates:

```bash
# Email templates are automatically seeded on first run
```

## Environment Setup

Create a `.env` file in the root directory with the following variables:

### Required Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@host:port/database
PGDATABASE=your_db_name
PGHOST=your_host
PGPASSWORD=your_password
PGPORT=5432
PGUSER=your_user

# Session Secret
SESSION_SECRET=your-super-secret-session-key

# Application
NODE_ENV=development
REPL_ID=your-repl-id
MICROSOFT_REDIRECT_URL=http://localhost:5000/api/auth/microsoft/callback
```

### Optional Environment Variables

```env
# AWS SES (for email)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1

# AWS Bedrock (for AI assistant)
AWS_BEDROCK_ACCESS_KEY_ID=your-bedrock-access-key
AWS_BEDROCK_SECRET_ACCESS_KEY=your-bedrock-secret-key
AWS_BEDROCK_REGION=us-east-1

# Microsoft OAuth (for SSO)
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_TENANT_ID=your-tenant-id
```

## Development

### Starting the Development Server

```bash
npm run dev
```

This starts both the frontend (Vite) and backend (Express) servers concurrently.

- Frontend: http://localhost:5000
- Backend API: http://localhost:5000/api

### Project Structure

```
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utilities and helpers
│   │   └── pages/       # Page components
├── server/              # Express backend
│   ├── auth.ts          # Authentication logic
│   ├── routes.ts        # API routes
│   ├── storage.ts       # Database operations
│   └── index.ts         # Server entry point
├── shared/              # Shared types and schemas
│   └── schema.ts        # Database schema definitions
└── migrations/          # Database migrations
```

### Code Style

The project uses TypeScript with strict type checking. Follow these conventions:

- Use functional components with hooks for React
- Implement proper error boundaries
- Use Zod for runtime validation
- Follow RESTful API design principles
- Write self-documenting code with clear naming

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Structure

- **Unit Tests**: Located in `__tests__` directories
- **Integration Tests**: API endpoint testing with Supertest
- **Component Tests**: React Testing Library for UI components

### Writing Tests

Example unit test:

```typescript
describe("TaskService", () => {
  it("should create a task with proper ticket number", async () => {
    const task = await taskService.create({
      title: "Test Task",
      description: "Test Description",
    });

    expect(task.ticketNumber).toMatch(/^TKT-\d{4}-\d{4}$/);
  });
});
```

## API Documentation

### Authentication Endpoints

#### Register User

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

#### Logout

```http
POST /api/auth/logout
```

### Ticket Management

#### Create Ticket

```http
POST /api/tasks
Content-Type: application/json

{
  "title": "Bug in login system",
  "description": "Users cannot login with special characters",
  "priority": "high",
  "severity": "major",
  "category": "bug",
  "assignedTo": "user-id",
  "teamId": 1,
  "tags": ["login", "authentication"]
}
```

#### Get Tickets

```http
GET /api/tasks?status=open&priority=high&page=1&limit=20
```

#### Update Ticket

```http
PUT /api/tasks/:id
Content-Type: application/json

{
  "status": "in_progress",
  "assignedTo": "user-id"
}
```

### Team Management

#### Create Team

```http
POST /api/teams
Content-Type: application/json

{
  "name": "Development Team",
  "description": "Frontend and backend developers"
}
```

#### Add Team Member

```http
POST /api/teams/:teamId/members
Content-Type: application/json

{
  "userId": "user-id",
  "role": "member"
}
```

### Complete API documentation is available at `/api-docs` when running the application.

## Security

### Zero-Trust Security Model

The application implements a zero-trust security architecture:

1. **Authentication**: All routes require authentication except public endpoints
2. **Authorization**: Role-based access control at API and UI levels
3. **Session Management**: Secure session storage in PostgreSQL
4. **Input Validation**: Zod schemas validate all user input
5. **SQL Injection Prevention**: Parameterized queries via Drizzle ORM
6. **XSS Protection**: React's built-in XSS protection
7. **CSRF Protection**: Session-based CSRF tokens
8. **Secrets Management**: Environment variables for sensitive data
9. **Encryption**: Passwords hashed with bcrypt (10 rounds)
10. **HTTPS**: Enforced in production

### Security Best Practices

- No sensitive data stored in local storage
- API keys never exposed to frontend
- Rate limiting on authentication endpoints
- Audit logging for sensitive operations
- Regular security dependency updates

### Data Protection

- **Personal Data**: Encrypted at rest in database
- **File Uploads**: Scanned and stored securely
- **API Keys**: Encrypted before storage
- **Sessions**: Expire after 7 days
- **Password Reset**: Tokens expire after 1 hour

## Deployment

### Production Build

```bash
# Build frontend and backend
npm run build

# Start production server (NODE_ENV must be set, see below)
NODE_ENV=production npm start
```

### Docker and compose (the supported production path)

The image is built on Node 24 (`node:24-alpine`; `package.json` requires Node >= 22.12). Deploy
with `docker-compose.yml` or the Dockerfile alone: both run the same three steps in the same order
(a unit test keeps them identical), so a deploy always migrates before it serves, and the server
refuses to boot if a required schema object is still missing. The command is:

```bash
npm run db:migrate-sql && npm run db:push && exec node dist/index.js
```

`exec` makes node PID 1, so it receives SIGTERM from `docker stop`.

### Environment Configuration

Ensure all production environment variables are set:

- `NODE_ENV=production` (required: the built server, `node dist/index.js`, refuses to start when it is unset)
- `DATABASE_URL`
- `SESSION_SECRET` and `JWT_SECRET` (strong, unique)
- `APP_BASE_URL` (public origin, e.g. `https://tickets.example.com`; the server refuses to boot without it in production)
- Enable HTTPS and configure proper CORS origins
- Use production database credentials

Optional, with their defaults:

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_MAX_REQUESTS` | `600` | General per-IP limit on `/api` per `RATE_LIMIT_WINDOW_MS` (15 minutes). |
| `TRUST_PROXY_HOPS` | `1` | Reverse proxies in front of the app (Express `trust proxy`). Set `2` behind Coolify/Traefik plus nginx. |
| `TEAMS_WEBHOOKS_ENABLED` | off | Teams webhooks send only when this is exactly `true`. |
| `SSO_DEFAULT_ROLE` | `customer` | Role of a new Microsoft SSO account: `customer` or `agent`. It always waits for admin approval. |
| `INBOUND_EMAIL_MAX_HEADER_BYTES` | `65536` | Largest accepted inbound email header block, 1 to 262144. |
| `PG_POOL_MAX` | `10` | Database connection pool size. |

### Database Migrations

```bash
# Hand-written idempotent SQL migrations (migrations/0007_* onwards), then the schema push
npm run db:migrate-sql
npm run db:push
```

A migration file that is not idempotent is listed in `NOT_RUN` (with the reason) in
`scripts/apply-sql-migrations.mjs`, which is skipped on every run; add a future non-idempotent
file there, or make it idempotent, or every deploy fails.

### Monitoring

The application includes:

- Request logging
- Error tracking
- Performance monitoring
- AI usage tracking

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Write/update tests
5. Run tests: `npm test`
6. Commit changes: `git commit -m 'Add your feature'`
7. Push to branch: `git push origin feature/your-feature`
8. Create a Pull Request

### Code Review Process

- All code must be reviewed before merging
- Tests must pass
- Code coverage must not decrease
- Follow TypeScript and React best practices

## License

This project is proprietary software. All rights reserved.

---

For support, please contact support@ticketflow.com or create a ticket in the system.
