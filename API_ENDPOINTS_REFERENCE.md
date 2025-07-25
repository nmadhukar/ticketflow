# TicketFlow API Endpoints Reference

## Authentication Endpoints

### POST /api/register
**Description**: Register new user account  
**Authentication**: None  
**Rate Limit**: 5 requests per 15 minutes per IP

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "department": "Engineering"
}
```

**Success Response (201)**:
```json
{
  "id": "uuid-string",
  "email": "user@example.com",
  "isApproved": false,
  "message": "Account created. Awaiting admin approval."
}
```

**cURL Example**:
```bash
curl -X POST https://your-domain.com/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@company.com",
    "password": "SecurePass123!",
    "firstName": "John", 
    "lastName": "Doe"
  }'
```

### POST /api/login
**Description**: Authenticate user and create session  
**Authentication**: None  
**Rate Limit**: 10 requests per 15 minutes per IP

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Success Response (200)**:
```json
{
  "id": "uuid-string",
  "email": "user@example.com",
  "role": "user",
  "firstName": "John",
  "lastName": "Doe",
  "isApproved": true
}
```

**cURL Example**:
```bash
curl -X POST https://your-domain.com/api/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "john@company.com",
    "password": "SecurePass123!"
  }'
```

### POST /api/logout
**Description**: End user session  
**Authentication**: Required  

**cURL Example**:
```bash
curl -X POST https://your-domain.com/api/logout \
  -b cookies.txt
```

### GET /api/auth/user
**Description**: Get current authenticated user  
**Authentication**: Required

**Success Response (200)**:
```json
{
  "id": "uuid-string",
  "email": "user@example.com",
  "role": "user",
  "firstName": "John",
  "lastName": "Doe"
}
```

## Task Management Endpoints

### GET /api/tasks
**Description**: Get all tasks with filtering  
**Authentication**: Required  
**Permissions**: Users see assigned tasks, admins see all

**Query Parameters**:
- `status`: Filter by status (open, in_progress, resolved, closed, on_hold)
- `priority`: Filter by priority (low, medium, high, urgent)  
- `assignee`: Filter by assignee ID
- `category`: Filter by category (bug, feature, support, enhancement, incident, request)
- `search`: Text search in title and description
- `limit`: Results per page (default: 50, max: 100)
- `offset`: Pagination offset (default: 0)

**Success Response (200)**:
```json
{
  "tasks": [
    {
      "id": 1,
      "ticketNumber": "TKT-2024-0001",
      "title": "Login page not responsive on mobile",
      "description": "Users report login issues on mobile devices",
      "category": "bug",
      "status": "open",
      "priority": "high",
      "severity": "major",
      "assigneeId": "user-uuid",
      "createdBy": "creator-uuid",
      "dueDate": "2024-02-01T00:00:00Z",
      "tags": ["mobile", "ui", "login"],
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 156,
  "hasMore": true
}
```

**cURL Example**:
```bash
curl -X GET 'https://your-domain.com/api/tasks?status=open&priority=high&limit=25' \
  -b cookies.txt \
  -H "Accept: application/json"
```

### POST /api/tasks
**Description**: Create new task  
**Authentication**: Required  
**Rate Limit**: 50 requests per hour per user

**Request Body**:
```json
{
  "title": "Database connection timeout issue",
  "description": "Users experiencing timeout errors when accessing the dashboard",
  "category": "bug",
  "priority": "high",
  "severity": "major",
  "assigneeId": "user-uuid",
  "assigneeType": "user",
  "dueDate": "2024-02-01T00:00:00Z",
  "estimatedHours": 8,
  "tags": ["database", "performance", "urgent"]
}
```

**Success Response (201)**:
```json
{
  "id": 2,
  "ticketNumber": "TKT-2024-0002",
  "title": "Database connection timeout issue",
  "status": "open",
  "priority": "high",
  "aiAnalysis": {
    "confidence": 0.85,
    "suggestedResponse": "This appears to be a database connectivity issue. I recommend checking the connection pool settings...",
    "autoResponseGenerated": true,
    "complexityScore": 75
  },
  "createdAt": "2024-01-15T14:30:00Z"
}
```

**cURL Example**:
```bash
curl -X POST https://your-domain.com/api/tasks \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Database timeout issue",
    "description": "Users experiencing timeouts",
    "category": "bug",
    "priority": "high"
  }'
```

### GET /api/tasks/:id
**Description**: Get specific task by ID  
**Authentication**: Required  
**Permissions**: Users can view assigned or created tasks, admins see all

**Success Response (200)**:
```json
{
  "id": 1,
  "ticketNumber": "TKT-2024-0001",
  "title": "Login page not responsive",
  "description": "Detailed description...",
  "category": "bug",
  "status": "in_progress",
  "priority": "high",
  "assigneeId": "user-uuid",
  "createdBy": "creator-uuid",
  "dueDate": "2024-02-01T00:00:00Z",
  "estimatedHours": 4,
  "actualHours": 2,
  "tags": ["mobile", "ui"],
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-16T09:00:00Z",
  "assignee": {
    "id": "user-uuid",
    "firstName": "Jane",
    "lastName": "Developer"
  },
  "creator": {
    "id": "creator-uuid", 
    "firstName": "John",
    "lastName": "Reporter"
  }
}
```

### PUT /api/tasks/:id
**Description**: Update existing task  
**Authentication**: Required  
**Permissions**: Assignee, creator, or admin can update

**Request Body** (partial update):
```json
{
  "status": "in_progress",
  "priority": "urgent",
  "assigneeId": "new-assignee-uuid",
  "actualHours": 3,
  "notes": "Updated priority due to customer escalation"
}
```

**Success Response (200)**:
```json
{
  "id": 1,
  "ticketNumber": "TKT-2024-0001",
  "status": "in_progress",
  "priority": "urgent",
  "updatedAt": "2024-01-16T11:30:00Z"
}
```

### DELETE /api/tasks/:id
**Description**: Delete task (admin only)  
**Authentication**: Required  
**Permissions**: Admin only

**Success Response (204)**: No content

## Task Comments Endpoints

### GET /api/tasks/:id/comments
**Description**: Get comments for a task  
**Authentication**: Required

**Success Response (200)**:
```json
[
  {
    "id": 1,
    "taskId": 1,
    "userId": "user-uuid",
    "content": "Started investigating the mobile login issue",
    "createdAt": "2024-01-15T11:00:00Z",
    "user": {
      "firstName": "Jane",
      "lastName": "Developer"
    }
  }
]
```

### POST /api/tasks/:id/comments
**Description**: Add comment to task  
**Authentication**: Required

**Request Body**:
```json
{
  "content": "Found the root cause. The CSS media queries need adjustment."
}
```

**Success Response (201)**:
```json
{
  "id": 2,
  "taskId": 1,
  "content": "Found the root cause. The CSS media queries need adjustment.",
  "createdAt": "2024-01-15T12:00:00Z"
}
```

## Team Management Endpoints

### GET /api/teams
**Description**: Get all teams  
**Authentication**: Required

**Success Response (200)**:
```json
[
  {
    "id": 1,
    "name": "Engineering Team",
    "description": "Frontend and backend developers",
    "memberCount": 8,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

### POST /api/teams
**Description**: Create new team  
**Authentication**: Required  
**Permissions**: Admin or manager

**Request Body**:
```json
{
  "name": "QA Team",
  "description": "Quality assurance and testing team"
}
```

### GET /api/teams/:id/members
**Description**: Get team members  
**Authentication**: Required

**Success Response (200)**:
```json
[
  {
    "id": "user-uuid",
    "firstName": "John",
    "lastName": "Developer",
    "email": "john@company.com",
    "role": "member",
    "joinedAt": "2024-01-05T00:00:00Z"
  }
]
```

### POST /api/teams/:id/members
**Description**: Add member to team  
**Authentication**: Required  
**Permissions**: Team admin or system admin

**Request Body**:
```json
{
  "userId": "user-uuid",
  "role": "member"
}
```

## Admin Endpoints

### GET /api/admin/users
**Description**: Get all users (admin only)  
**Authentication**: Required  
**Permissions**: Admin only

**Success Response (200)**:
```json
[
  {
    "id": "user-uuid",
    "email": "user@company.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user",
    "department": "Engineering",
    "isActive": true,
    "isApproved": true,
    "createdAt": "2024-01-10T00:00:00Z"
  }
]
```

### PUT /api/admin/users/:id/role
**Description**: Update user role  
**Authentication**: Required  
**Permissions**: Admin only

**Request Body**:
```json
{
  "role": "manager"
}
```

### POST /api/admin/users/:id/toggle-status
**Description**: Activate/deactivate user  
**Authentication**: Required  
**Permissions**: Admin only

**Success Response (200)**:
```json
{
  "id": "user-uuid",
  "isActive": false,
  "message": "User deactivated successfully"
}
```

### GET /api/admin/stats
**Description**: Get system statistics  
**Authentication**: Required  
**Permissions**: Admin only

**Success Response (200)**:
```json
{
  "totalUsers": 45,
  "activeUsers": 42,
  "totalTeams": 6,
  "totalTasks": 156,
  "openTasks": 23,
  "resolvedTasks": 98,
  "avgResolutionTime": 3.2,
  "topCategories": [
    {"category": "bug", "count": 45},
    {"category": "feature", "count": 32}
  ]
}
```

## AI Integration Endpoints

### GET /api/admin/ai-settings
**Description**: Get AI configuration  
**Authentication**: Required  
**Permissions**: Admin only

**Success Response (200)**:
```json
{
  "autoResponseEnabled": true,
  "confidenceThreshold": 0.75,
  "maxResponseLength": 1000,
  "responseTimeout": 30,
  "autoLearnEnabled": true,
  "minResolutionScore": 0.8,
  "bedrockModel": "anthropic.claude-3-sonnet-20240229-v1:0",
  "temperature": 0.3,
  "maxTokens": 2000
}
```

### PUT /api/admin/ai-settings
**Description**: Update AI configuration  
**Authentication**: Required  
**Permissions**: Admin only

**Request Body**:
```json
{
  "confidenceThreshold": 0.8,
  "autoResponseEnabled": true,
  "maxResponseLength": 1200
}
```

### GET /api/admin/ai-analytics
**Description**: Get AI performance metrics  
**Authentication**: Required  
**Permissions**: Admin only

**Success Response (200)**:
```json
{
  "autoResponsesSent": 45,
  "avgConfidence": 0.78,
  "ticketsResolvedByAI": 12,
  "articlesCreated": 8,
  "avgEffectiveness": 0.85,
  "topCategories": [
    {"category": "Database Issues", "count": 15},
    {"category": "Authentication", "count": 12}
  ],
  "dailyUsage": [
    {"date": "2024-01-15", "requests": 23, "cost": 1.45},
    {"date": "2024-01-16", "requests": 31, "cost": 1.89}
  ]
}
```

### POST /api/admin/ai-settings/test
**Description**: Test AI connection  
**Authentication**: Required  
**Permissions**: Admin only

**Success Response (200)**:
```json
{
  "status": "connected",
  "model": "anthropic.claude-3-sonnet-20240229-v1:0",
  "responseTime": 1234,
  "message": "AI service is working correctly"
}
```

## Knowledge Base Endpoints

### GET /api/knowledge
**Description**: Search knowledge articles  
**Authentication**: Required

**Query Parameters**:
- `search`: Text search query
- `category`: Filter by category
- `status`: Filter by status (draft, published, archived)
- `limit`: Results limit (default: 20)

**Success Response (200)**:
```json
[
  {
    "id": 1,
    "title": "How to resolve database connection timeouts",
    "content": "Step 1: Check connection pool settings...",
    "category": "Database",
    "tags": ["database", "troubleshooting", "performance"],
    "status": "published",
    "effectivenessScore": 0.89,
    "createdAt": "2024-01-10T00:00:00Z"
  }
]
```

### POST /api/knowledge
**Description**: Create knowledge article  
**Authentication**: Required  
**Permissions**: Admin or manager

**Request Body**:
```json
{
  "title": "Troubleshooting Email Delivery Issues",
  "content": "When users report email delivery problems...",
  "category": "Email",
  "tags": ["email", "smtp", "troubleshooting"],
  "status": "draft"
}
```

## File Upload Endpoints

### POST /api/tasks/:id/attachments
**Description**: Upload file attachment to task  
**Authentication**: Required  
**Content-Type**: multipart/form-data  
**File Limit**: 10MB per file

**Form Data**:
- `file`: File to upload
- `description`: Optional file description

**Success Response (201)**:
```json
{
  "id": 1,
  "taskId": 1,
  "filename": "error-screenshot.png",
  "originalName": "Screenshot 2024-01-15.png",
  "mimeType": "image/png",
  "size": 245760,
  "description": "Error screenshot from user",
  "createdAt": "2024-01-15T15:00:00Z"
}
```

**cURL Example**:
```bash
curl -X POST https://your-domain.com/api/tasks/1/attachments \
  -b cookies.txt \
  -F "file=@screenshot.png" \
  -F "description=Error screenshot"
```

### GET /api/tasks/:id/attachments
**Description**: Get task attachments  
**Authentication**: Required

**Success Response (200)**:
```json
[
  {
    "id": 1,
    "filename": "error-screenshot.png",
    "originalName": "Screenshot 2024-01-15.png",
    "size": 245760,
    "mimeType": "image/png",
    "description": "Error screenshot",
    "downloadUrl": "/api/attachments/1/download",
    "createdAt": "2024-01-15T15:00:00Z"
  }
]
```

## Error Response Format

All endpoints return errors in this consistent format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable error message",
  "details": [
    {
      "field": "email",
      "message": "Valid email address is required"
    }
  ],
  "timestamp": "2024-01-15T10:00:00Z",
  "path": "/api/tasks",
  "requestId": "uuid-string"
}
```

### Common Error Codes

- `VALIDATION_ERROR`: Input validation failed
- `AUTHENTICATION_REQUIRED`: User not authenticated
- `INSUFFICIENT_PERMISSIONS`: User lacks required permissions
- `RESOURCE_NOT_FOUND`: Requested resource doesn't exist
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `INTERNAL_ERROR`: Server error
- `AI_SERVICE_UNAVAILABLE`: AI analysis temporarily unavailable

### HTTP Status Codes

- `200`: Success
- `201`: Created
- `204`: No Content
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `409`: Conflict
- `429`: Too Many Requests
- `500`: Internal Server Error
- `503`: Service Unavailable