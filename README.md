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

- Node.js 18+ (recommended: Node.js 20)
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

# Start production server
npm start
```

### Environment Configuration

Ensure all production environment variables are set:

- Use strong, unique passwords
- Enable HTTPS
- Configure proper CORS origins
- Set NODE_ENV=production
- Use production database credentials

### Database Migrations

```bash
# Push schema changes to production
npm run db:push
```

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
