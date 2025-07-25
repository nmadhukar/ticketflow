# TicketFlow API Documentation

## Base URL
```
Development: http://localhost:5000/api
Production: https://your-domain.com/api
```

## Authentication

All API endpoints require authentication unless specified otherwise. The API uses session-based authentication with cookies.

### Authentication Headers
```http
Cookie: connect.sid=s%3ASessionID.Signature
```

## API Endpoints

### Authentication Endpoints

#### Register User
Creates a new user account. Users require admin approval unless invited.

**Endpoint:** `POST /api/auth/register`  
**Authentication:** Not required  
**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```
**Response:** `201 Created`
```json
{
  "message": "Registration successful! Your account is pending admin approval.",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "customer",
    "isApproved": false
  }
}
```

#### Login
Authenticates a user and creates a session.

**Endpoint:** `POST /api/auth/login`  
**Authentication:** Not required  
**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```
**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "user",
  "isActive": true,
  "isApproved": true
}
```

#### Logout
Ends the current user session.

**Endpoint:** `POST /api/auth/logout`  
**Authentication:** Required  
**Response:** `200 OK`
```json
{
  "message": "Logged out successfully"
}
```

#### Get Current User
Returns the authenticated user's information.

**Endpoint:** `GET /api/auth/user`  
**Authentication:** Required  
**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "admin",
  "departmentId": 1,
  "isActive": true,
  "isApproved": true,
  "profileImageUrl": "https://example.com/profile.jpg",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

#### Forgot Password
Sends a password reset email to the user.

**Endpoint:** `POST /api/auth/forgot-password`  
**Authentication:** Not required  
**Request Body:**
```json
{
  "email": "user@example.com"
}
```
**Response:** `200 OK`
```json
{
  "message": "If an account exists with this email, a password reset link has been sent."
}
```

#### Reset Password
Resets the user's password using a reset token.

**Endpoint:** `POST /api/auth/reset-password`  
**Authentication:** Not required  
**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "password": "NewSecurePassword123"
}
```
**Response:** `200 OK`
```json
{
  "message": "Password reset successfully"
}
```

### Ticket Management

#### Create Ticket
Creates a new ticket in the system.

**Endpoint:** `POST /api/tasks`  
**Authentication:** Required  
**Request Body:**
```json
{
  "title": "Bug in login system",
  "description": "Users cannot login with special characters in password",
  "priority": "high",
  "severity": "major",
  "category": "bug",
  "assignedTo": "user-uuid",
  "teamId": 1,
  "tags": ["login", "authentication", "urgent"],
  "estimatedHours": 4,
  "dueDate": "2024-12-31T23:59:59Z"
}
```
**Response:** `201 Created`
```json
{
  "id": 1,
  "ticketNumber": "TKT-2024-0001",
  "title": "Bug in login system",
  "description": "Users cannot login with special characters in password",
  "status": "open",
  "priority": "high",
  "severity": "major",
  "category": "bug",
  "createdBy": "user-uuid",
  "assignedTo": "user-uuid",
  "teamId": 1,
  "tags": ["login", "authentication", "urgent"],
  "estimatedHours": 4,
  "actualHours": null,
  "dueDate": "2024-12-31T23:59:59Z",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

#### Get Tickets
Retrieves tickets with optional filters.

**Endpoint:** `GET /api/tasks`  
**Authentication:** Required  
**Query Parameters:**
- `status` (optional): Filter by status (open, in_progress, resolved, closed, on_hold)
- `priority` (optional): Filter by priority (low, medium, high, urgent)
- `severity` (optional): Filter by severity (minor, normal, major, critical)
- `assignedTo` (optional): Filter by assigned user ID
- `teamId` (optional): Filter by team ID
- `category` (optional): Filter by category
- `search` (optional): Search in title and description
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "ticketNumber": "TKT-2024-0001",
    "title": "Bug in login system",
    "status": "open",
    "priority": "high",
    "severity": "major",
    "assignedUser": {
      "id": "uuid",
      "firstName": "John",
      "lastName": "Doe"
    },
    "team": {
      "id": 1,
      "name": "Development Team"
    },
    "createdBy": "user-uuid",
    "createdAt": "2024-01-01T00:00:00Z",
    "dueDate": "2024-12-31T23:59:59Z"
  }
]
```

#### Get Single Ticket
Retrieves detailed information about a specific ticket.

**Endpoint:** `GET /api/tasks/:id`  
**Authentication:** Required  
**Response:** `200 OK`
```json
{
  "id": 1,
  "ticketNumber": "TKT-2024-0001",
  "title": "Bug in login system",
  "description": "Full description...",
  "status": "in_progress",
  "priority": "high",
  "severity": "major",
  "category": "bug",
  "createdBy": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Smith"
  },
  "assignedTo": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe"
  },
  "team": {
    "id": 1,
    "name": "Development Team"
  },
  "tags": ["login", "authentication"],
  "estimatedHours": 4,
  "actualHours": 2,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-02T00:00:00Z",
  "lastUpdatedBy": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

#### Update Ticket
Updates an existing ticket.

**Endpoint:** `PUT /api/tasks/:id`  
**Authentication:** Required  
**Request Body:** (all fields optional)
```json
{
  "title": "Updated title",
  "description": "Updated description",
  "status": "in_progress",
  "priority": "urgent",
  "severity": "critical",
  "assignedTo": "user-uuid",
  "teamId": 2,
  "tags": ["updated", "tags"],
  "actualHours": 3
}
```
**Response:** `200 OK`
```json
{
  "id": 1,
  "ticketNumber": "TKT-2024-0001",
  // ... updated ticket data
}
```

#### Delete Ticket
Deletes a ticket (admin only).

**Endpoint:** `DELETE /api/tasks/:id`  
**Authentication:** Required (Admin role)  
**Response:** `200 OK`
```json
{
  "message": "Task deleted successfully"
}
```

### Comments

#### Add Comment
Adds a comment to a ticket.

**Endpoint:** `POST /api/tasks/:taskId/comments`  
**Authentication:** Required  
**Request Body:**
```json
{
  "content": "I've started working on this issue. Found the problem in the authentication module."
}
```
**Response:** `201 Created`
```json
{
  "id": 1,
  "taskId": 1,
  "userId": "uuid",
  "content": "I've started working on this issue. Found the problem in the authentication module.",
  "createdAt": "2024-01-01T10:00:00Z"
}
```

#### Get Comments
Retrieves all comments for a ticket.

**Endpoint:** `GET /api/tasks/:taskId/comments`  
**Authentication:** Required  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "content": "Started investigation",
    "createdAt": "2024-01-01T10:00:00Z",
    "user": {
      "firstName": "John",
      "lastName": "Doe"
    }
  }
]
```

### Teams

#### Create Team
Creates a new team.

**Endpoint:** `POST /api/teams`  
**Authentication:** Required  
**Request Body:**
```json
{
  "name": "Frontend Team",
  "description": "Responsible for UI/UX development"
}
```
**Response:** `201 Created`
```json
{
  "id": 1,
  "name": "Frontend Team",
  "description": "Responsible for UI/UX development",
  "createdBy": "uuid",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### Get Teams
Retrieves all teams.

**Endpoint:** `GET /api/teams`  
**Authentication:** Required  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "name": "Frontend Team",
    "description": "Responsible for UI/UX development",
    "memberCount": 5
  }
]
```

#### Get My Teams
Retrieves teams the current user is a member of.

**Endpoint:** `GET /api/teams/my`  
**Authentication:** Required  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "name": "Frontend Team",
    "role": "admin"
  }
]
```

#### Add Team Member
Adds a user to a team.

**Endpoint:** `POST /api/teams/:teamId/members`  
**Authentication:** Required  
**Request Body:**
```json
{
  "userId": "user-uuid",
  "role": "member"
}
```
**Response:** `200 OK`
```json
{
  "message": "User added to team successfully"
}
```

#### Update Team Member Role
Updates a team member's role.

**Endpoint:** `PUT /api/teams/:teamId/members/:userId`  
**Authentication:** Required (Team admin)  
**Request Body:**
```json
{
  "role": "admin"
}
```
**Response:** `200 OK`
```json
{
  "message": "Member role updated successfully"
}
```

### File Attachments

#### Upload Attachment
Uploads a file attachment for a ticket.

**Endpoint:** `POST /api/tasks/:taskId/attachments`  
**Authentication:** Required  
**Content-Type:** `multipart/form-data`  
**Form Data:**
- `file`: The file to upload (max 10MB)

**Response:** `201 Created`
```json
{
  "id": 1,
  "taskId": 1,
  "fileName": "screenshot.png",
  "fileType": "image/png",
  "fileSize": 245632,
  "uploadedBy": "uuid",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### Get Attachments
Retrieves all attachments for a ticket.

**Endpoint:** `GET /api/tasks/:taskId/attachments`  
**Authentication:** Required  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "fileName": "screenshot.png",
    "fileType": "image/png",
    "fileSize": 245632,
    "uploadedBy": {
      "firstName": "John",
      "lastName": "Doe"
    },
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### Download Attachment
Downloads a specific attachment.

**Endpoint:** `GET /api/attachments/:id`  
**Authentication:** Required  
**Response:** Binary file data with appropriate Content-Type header

#### Delete Attachment
Deletes an attachment.

**Endpoint:** `DELETE /api/attachments/:id`  
**Authentication:** Required (Uploader or Admin)  
**Response:** `200 OK`
```json
{
  "message": "Attachment deleted successfully"
}
```

### Admin Endpoints

#### Get All Users
Retrieves all users in the system.

**Endpoint:** `GET /api/admin/users`  
**Authentication:** Required (Admin role)  
**Query Parameters:**
- `role` (optional): Filter by role
- `isApproved` (optional): Filter by approval status
- `departmentId` (optional): Filter by department

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user",
    "isActive": true,
    "isApproved": true,
    "department": {
      "id": 1,
      "name": "Engineering"
    },
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### Update User
Updates user information.

**Endpoint:** `PUT /api/admin/users/:id`  
**Authentication:** Required (Admin role)  
**Request Body:**
```json
{
  "role": "manager",
  "isActive": true,
  "isApproved": true,
  "departmentId": 2
}
```
**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  // ... updated user data
}
```

#### Create Department
Creates a new department.

**Endpoint:** `POST /api/admin/departments`  
**Authentication:** Required (Admin role)  
**Request Body:**
```json
{
  "name": "Engineering",
  "description": "Software development department",
  "managerId": "manager-uuid"
}
```
**Response:** `201 Created`
```json
{
  "id": 1,
  "name": "Engineering",
  "description": "Software development department",
  "managerId": "manager-uuid",
  "isActive": true
}
```

#### Send User Invitation
Sends an invitation email to a new user.

**Endpoint:** `POST /api/admin/invitations`  
**Authentication:** Required (Admin role)  
**Request Body:**
```json
{
  "email": "newuser@example.com",
  "role": "user",
  "departmentId": 1,
  "expiresAt": "2024-12-31T23:59:59Z"
}
```
**Response:** `201 Created`
```json
{
  "id": 1,
  "email": "newuser@example.com",
  "role": "user",
  "status": "pending",
  "invitationToken": "token-string",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

### Statistics & Activity

#### Get Dashboard Statistics
Retrieves statistics for the dashboard.

**Endpoint:** `GET /api/stats`  
**Authentication:** Required  
**Response:** `200 OK`
```json
{
  "total": 150,
  "open": 45,
  "inProgress": 30,
  "resolved": 60,
  "closed": 15,
  "myTickets": {
    "total": 25,
    "open": 10,
    "inProgress": 8
  },
  "overdue": 5,
  "dueSoon": 12
}
```

#### Get Recent Activity
Retrieves recent activity across the system.

**Endpoint:** `GET /api/activity`  
**Authentication:** Required  
**Query Parameters:**
- `limit` (optional): Number of activities to return (default: 10)

**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "taskId": 1,
    "userId": "uuid",
    "action": "status_changed",
    "description": "Status changed from open to in_progress",
    "createdAt": "2024-01-01T10:00:00Z",
    "task": {
      "ticketNumber": "TKT-2024-0001",
      "title": "Bug in login system"
    },
    "user": {
      "firstName": "John",
      "lastName": "Doe"
    }
  }
]
```

### Company Settings

#### Get Company Settings
Retrieves company settings and branding.

**Endpoint:** `GET /api/company-settings`  
**Authentication:** Required  
**Response:** `200 OK`
```json
{
  "id": 1,
  "companyName": "TicketFlow Inc",
  "logo": "base64-encoded-image-data",
  "ticketPrefix": "TKT"
}
```

#### Update Company Settings
Updates company settings (admin only).

**Endpoint:** `PUT /api/company-settings`  
**Authentication:** Required (Admin role)  
**Request Body:**
```json
{
  "companyName": "New Company Name",
  "ticketPrefix": "TCK"
}
```
**Response:** `200 OK`
```json
{
  "id": 1,
  "companyName": "New Company Name",
  "ticketPrefix": "TCK"
}
```

### Email Templates

#### Get Email Templates
Retrieves all email templates.

**Endpoint:** `GET /api/email-templates`  
**Authentication:** Required (Admin role)  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "name": "user_invitation",
    "subject": "You're invited to join {{companyName}}",
    "body": "HTML template content...",
    "variables": ["companyName", "inviterName", "registrationUrl"]
  }
]
```

#### Update Email Template
Updates an email template.

**Endpoint:** `PUT /api/email-templates/:id`  
**Authentication:** Required (Admin role)  
**Request Body:**
```json
{
  "subject": "Updated subject line",
  "body": "Updated HTML content"
}
```
**Response:** `200 OK`

### AI Chat

#### Send AI Message
Sends a message to the AI assistant.

**Endpoint:** `POST /api/ai/chat`  
**Authentication:** Required  
**Request Body:**
```json
{
  "message": "How do I reset my password?",
  "sessionId": "optional-session-id"
}
```
**Response:** `200 OK`
```json
{
  "response": "To reset your password, click on...",
  "sessionId": "session-id",
  "sources": [
    {
      "title": "Password Reset Guide",
      "type": "help_document",
      "id": 5
    }
  ]
}
```

#### Get Chat History
Retrieves chat history for a session.

**Endpoint:** `GET /api/ai/chat/history/:sessionId`  
**Authentication:** Required  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "role": "user",
    "content": "How do I reset my password?",
    "timestamp": "2024-01-01T10:00:00Z"
  },
  {
    "id": 2,
    "role": "assistant",
    "content": "To reset your password...",
    "timestamp": "2024-01-01T10:00:05Z"
  }
]
```

### Smart Helpdesk - AI Auto-Response

#### Get AI Auto-Response for Ticket
Retrieves the AI-generated auto-response for a specific ticket.

**Endpoint:** `GET /api/tasks/:id/auto-response`  
**Authentication:** Required  
**Response:** `200 OK`
```json
{
  "id": 1,
  "ticketId": 123,
  "response": "Based on your issue description, here's a solution...",
  "confidenceScore": 0.85,
  "wasApplied": true,
  "wasHelpful": true,
  "createdAt": "2024-01-20T10:00:00Z"
}
```

#### Provide Auto-Response Feedback
Records whether the AI auto-response was helpful.

**Endpoint:** `POST /api/tasks/:id/auto-response/feedback`  
**Authentication:** Required  
**Request Body:**
```json
{
  "wasHelpful": true
}
```
**Response:** `200 OK`
```json
{
  "message": "Feedback recorded"
}
```

### Smart Helpdesk - Knowledge Base

#### Search Knowledge Base
Searches published knowledge articles.

**Endpoint:** `GET /api/knowledge/search`  
**Authentication:** Required  
**Query Parameters:**
- `query` - Search text
- `category` - Filter by category
- `limit` - Number of results (default: 10)

**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "title": "How to Reset Your Password",
    "summary": "Step-by-step guide for password reset",
    "content": "Full article content...",
    "category": "authentication",
    "tags": ["password", "security", "login"],
    "effectivenessScore": "0.92",
    "usageCount": 45,
    "createdAt": "2024-01-15T08:00:00Z"
  }
]
```

#### Get All Knowledge Articles (Admin)
Retrieves all knowledge articles for management.

**Endpoint:** `GET /api/admin/knowledge`  
**Authentication:** Required (Admin role)  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "title": "How to Reset Your Password",
    "summary": "Step-by-step guide",
    "isPublished": true,
    "effectivenessScore": "0.92",
    "usageCount": 45,
    "sourceTicketIds": [123, 456],
    "createdAt": "2024-01-15T08:00:00Z"
  }
]
```

#### Publish/Unpublish Knowledge Article
Changes the publication status of a knowledge article.

**Endpoint:** `PATCH /api/admin/knowledge/:id/publish`  
**Authentication:** Required (Admin role)  
**Request Body:**
```json
{
  "isPublished": true
}
```
**Response:** `200 OK`
```json
{
  "message": "Article updated"
}
```

#### Provide Knowledge Article Feedback
Records whether a knowledge article was helpful.

**Endpoint:** `POST /api/knowledge/:id/feedback`  
**Authentication:** Required  
**Request Body:**
```json
{
  "wasHelpful": true
}
```
**Response:** `200 OK`
```json
{
  "message": "Feedback recorded"
}
```

### Smart Helpdesk - AI Analytics

#### Get AI Performance Metrics
Retrieves comprehensive AI system performance analytics.

**Endpoint:** `GET /api/analytics/ai-performance`  
**Authentication:** Required (Manager or Admin role)  
**Response:** `200 OK`
```json
{
  "autoResponse": {
    "total": 500,
    "applied": 420,
    "helpful": 350,
    "avgConfidence": 0.78
  },
  "complexity": [
    { "range": "Very Low", "count": 150 },
    { "range": "Low", "count": 200 },
    { "range": "Medium", "count": 100 },
    { "range": "High", "count": 40 },
    { "range": "Very High", "count": 10 }
  ],
  "knowledgeBase": {
    "totalArticles": 85,
    "publishedArticles": 72,
    "avgEffectiveness": 0.85,
    "totalUsage": 1250
  }
}
```

### Smart Helpdesk - Escalation Rules

#### Get Escalation Rules
Retrieves all configured escalation rules.

**Endpoint:** `GET /api/admin/escalation-rules`  
**Authentication:** Required (Admin role)  
**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "ruleName": "High Complexity Escalation",
    "conditions": {
      "complexityThreshold": 80,
      "categories": ["bug", "incident"],
      "priority": ["high", "urgent"]
    },
    "actions": {
      "assignToTeam": "senior-support",
      "addTags": ["escalated", "priority"],
      "notifyManagers": true
    },
    "priority": 100,
    "isActive": true
  }
]
```

#### Create Escalation Rule
Creates a new escalation rule.

**Endpoint:** `POST /api/admin/escalation-rules`  
**Authentication:** Required (Admin role)  
**Request Body:**
```json
{
  "ruleName": "Critical Bug Escalation",
  "conditions": {
    "complexityThreshold": 70,
    "categories": ["bug"],
    "severity": ["critical"]
  },
  "actions": {
    "assignToTeam": "engineering",
    "notifyManagers": true
  },
  "priority": 90,
  "isActive": true
}
```
**Response:** `201 Created`

#### Update Escalation Rule
Updates an existing escalation rule.

**Endpoint:** `PUT /api/admin/escalation-rules/:id`  
**Authentication:** Required (Admin role)  
**Request Body:** Same as create  
**Response:** `200 OK`

#### Delete Escalation Rule
Deletes an escalation rule.

**Endpoint:** `DELETE /api/admin/escalation-rules/:id`  
**Authentication:** Required (Admin role)  
**Response:** `200 OK`
```json
{
  "message": "Rule deleted successfully"
}
```

## Error Responses

All endpoints return consistent error responses:

### 400 Bad Request
```json
{
  "message": "Validation error: Invalid email format"
}
```

### 401 Unauthorized
```json
{
  "message": "Not authenticated"
}
```

### 403 Forbidden
```json
{
  "message": "Admin access required"
}
```

### 404 Not Found
```json
{
  "message": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "message": "An unexpected error occurred"
}
```

## Rate Limiting

API endpoints are rate-limited to prevent abuse:
- Authentication endpoints: 5 requests per minute per IP
- Other endpoints: 100 requests per minute per user

## Pagination

List endpoints support pagination using query parameters:
- `page`: Page number (starts at 1)
- `limit`: Items per page (max 100)

Response includes pagination metadata in headers:
- `X-Total-Count`: Total number of items
- `X-Page-Count`: Total number of pages

## WebSocket Events

The API supports WebSocket connections for real-time updates at `/ws`.

### Connection
```javascript
const ws = new WebSocket('ws://localhost:5000/ws');
```

### Events

#### Ticket Updated
```json
{
  "type": "ticket:updated",
  "data": {
    "id": 1,
    "ticketNumber": "TKT-2024-0001",
    "changes": ["status", "assignedTo"]
  }
}
```

#### New Comment
```json
{
  "type": "comment:added",
  "data": {
    "taskId": 1,
    "commentId": 5,
    "userId": "uuid"
  }
}
```

#### Team Member Added
```json
{
  "type": "team:member:added",
  "data": {
    "teamId": 1,
    "userId": "uuid"
  }
}
```