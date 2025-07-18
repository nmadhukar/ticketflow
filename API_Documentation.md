# TicketFlow API Documentation

## Overview

TicketFlow is a comprehensive ticketing system designed for small business use. This documentation covers all available API endpoints, authentication methods, request/response formats, and example usage.

**Base URL:** `https://your-replit-app.replit.app`

## Table of Contents

1. [Authentication](#authentication)
2. [API Endpoints](#api-endpoints)
   - [Authentication Endpoints](#authentication-endpoints)
   - [Task Management](#task-management)
   - [Task Comments](#task-comments)
   - [User Management](#user-management)
   - [Team Management](#team-management)
   - [Statistics](#statistics)
   - [Activity Tracking](#activity-tracking)
   - [Admin Operations](#admin-operations)
3. [Data Models](#data-models)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)
6. [Postman Collection](#postman-collection)

## Authentication

TicketFlow uses Replit's OpenID Connect (OIDC) for authentication. The application handles authentication through session-based cookies.

### Authentication Flow

1. **Login**: Navigate to `/api/login` to initiate OAuth flow
2. **Callback**: Replit redirects to `/api/callback` after successful authentication
3. **Session**: Authenticated sessions are stored server-side with PostgreSQL
4. **Logout**: Navigate to `/api/logout` to clear session and redirect

### Session Management

- Sessions are stored in PostgreSQL for reliability
- Session TTL: 7 days
- Automatic token refresh for expired sessions
- Secure cookies with HTTPOnly flag

---

## API Endpoints

### Authentication Endpoints

#### Get Current User
```http
GET /api/auth/user
```

**Description:** Retrieve the current authenticated user's profile information.

**Authentication:** Required

**Response:**
```json
{
  "id": "38849441",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "profileImageUrl": "https://replit.com/public/images/profile.png",
  "role": "user",
  "department": "Engineering",
  "phone": "+1-555-123-4567",
  "isActive": true,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

#### Login
```http
GET /api/login
```

**Description:** Redirect to Replit OAuth login page.

**Authentication:** None

**Response:** Redirect to Replit OAuth

#### Logout
```http
GET /api/logout
```

**Description:** Clear session and redirect to home page.

**Authentication:** Required

**Response:** Redirect to home page

---

### Task Management

#### Get All Tasks
```http
GET /api/tasks
```

**Description:** Retrieve all tasks with optional filtering and pagination.

**Authentication:** Required

**Query Parameters:**
- `status` (optional): Filter by status (open, in_progress, resolved, closed, on_hold)
- `category` (optional): Filter by category (bug, feature, support, enhancement, incident, request)
- `assigneeId` (optional): Filter by assignee user ID
- `search` (optional): Search in title and description
- `limit` (optional): Number of results to return (default: no limit)
- `offset` (optional): Number of results to skip for pagination (default: 0)

**Example Request:**
```http
GET /api/tasks?status=open&category=bug&limit=10&offset=0
```

**Response:**
```json
[
  {
    "id": 1,
    "ticketNumber": "TKT-2024-0001",
    "title": "Fix login issue",
    "description": "Users unable to login with correct credentials",
    "category": "bug",
    "status": "open",
    "priority": "high",
    "severity": "major",
    "notes": null,
    "assigneeId": "user123",
    "assigneeType": "user",
    "assigneeTeamId": null,
    "createdBy": "admin123",
    "dueDate": "2024-12-31T23:59:59Z",
    "resolvedAt": null,
    "closedAt": null,
    "estimatedHours": 8,
    "actualHours": null,
    "tags": ["authentication", "urgent"],
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
]
```

#### Get My Tasks
```http
GET /api/tasks/my
```

**Description:** Retrieve tasks assigned to the current user.

**Authentication:** Required

**Query Parameters:** Same as "Get All Tasks"

**Response:** Same format as "Get All Tasks"

#### Get Task by ID
```http
GET /api/tasks/{id}
```

**Description:** Retrieve a specific task by its ID.

**Authentication:** Required

**Path Parameters:**
- `id` (required): Task ID

**Response:** Single task object (same format as array item above)

#### Create Task
```http
POST /api/tasks
```

**Description:** Create a new task.

**Authentication:** Required

**Request Body:**
```json
{
  "title": "Fix login issue",
  "description": "Users are unable to login with their credentials",
  "category": "bug",
  "status": "open",
  "priority": "high",
  "severity": "major",
  "assigneeId": "user123",
  "assigneeType": "user",
  "assigneeTeamId": null,
  "dueDate": "2024-12-31T23:59:59.999Z",
  "estimatedHours": 8,
  "tags": ["authentication", "urgent"]
}
```

**Required Fields:**
- `title`: String (max 255 characters)
- `category`: String (bug, feature, support, enhancement, incident, request)

**Optional Fields:**
- `description`: Text
- `status`: String (default: "open")
- `priority`: String (default: "medium") - low, medium, high, urgent
- `severity`: String (default: "normal") - minor, normal, major, critical
- `notes`: Text
- `assigneeId`: String (user ID)
- `assigneeType`: String (default: "user") - user, team
- `assigneeTeamId`: Integer (team ID)
- `dueDate`: ISO 8601 datetime
- `estimatedHours`: Integer
- `tags`: Array of strings

**Response:** Created task object

#### Update Task
```http
PATCH /api/tasks/{id}
```

**Description:** Update an existing task.

**Authentication:** Required

**Path Parameters:**
- `id` (required): Task ID

**Request Body:** Same as Create Task (all fields optional)

**Example Request:**
```json
{
  "status": "in_progress",
  "priority": "urgent",
  "notes": "Started investigating the issue",
  "actualHours": 2
}
```

**Response:** Updated task object

#### Delete Task
```http
DELETE /api/tasks/{id}
```

**Description:** Delete a task.

**Authentication:** Required

**Path Parameters:**
- `id` (required): Task ID

**Response:** `204 No Content`

---

### Task Comments

#### Get Task Comments
```http
GET /api/tasks/{id}/comments
```

**Description:** Retrieve all comments for a specific task.

**Authentication:** Required

**Path Parameters:**
- `id` (required): Task ID

**Response:**
```json
[
  {
    "id": 1,
    "taskId": 1,
    "userId": "user123",
    "userName": "John Doe",
    "content": "I'm working on this issue and will provide an update soon.",
    "createdAt": "2024-01-15T11:00:00Z"
  }
]
```

#### Add Task Comment
```http
POST /api/tasks/{id}/comments
```

**Description:** Add a comment to a task.

**Authentication:** Required

**Path Parameters:**
- `id` (required): Task ID

**Request Body:**
```json
{
  "content": "I'm working on this issue and will provide an update soon."
}
```

**Required Fields:**
- `content`: String (non-empty)

**Response:** Created comment object

---

### User Management

#### Get All Users
```http
GET /api/users
```

**Description:** Retrieve all users in the system.

**Authentication:** Required

**Response:**
```json
[
  {
    "id": "user123",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "profileImageUrl": "https://replit.com/public/images/profile.png",
    "role": "user",
    "department": "Engineering",
    "phone": "+1-555-123-4567",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
]
```

---

### Team Management

#### Get All Teams
```http
GET /api/teams
```

**Description:** Retrieve all teams.

**Authentication:** Required

**Response:**
```json
[
  {
    "id": 1,
    "name": "Frontend Development Team",
    "description": "Team responsible for frontend development and UI/UX",
    "createdAt": "2024-01-15T10:30:00Z",
    "createdBy": "admin123"
  }
]
```

#### Get My Teams
```http
GET /api/teams/my
```

**Description:** Retrieve teams that the current user is a member of.

**Authentication:** Required

**Response:** Same format as "Get All Teams"

#### Get Team by ID
```http
GET /api/teams/{id}
```

**Description:** Retrieve a specific team by its ID.

**Authentication:** Required

**Path Parameters:**
- `id` (required): Team ID

**Response:** Single team object

#### Create Team
```http
POST /api/teams
```

**Description:** Create a new team.

**Authentication:** Required

**Request Body:**
```json
{
  "name": "Frontend Development Team",
  "description": "Team responsible for frontend development and UI/UX"
}
```

**Required Fields:**
- `name`: String (max 255 characters)

**Optional Fields:**
- `description`: Text

**Response:** Created team object

#### Get Team Members
```http
GET /api/teams/{id}/members
```

**Description:** Retrieve all members of a specific team.

**Authentication:** Required

**Path Parameters:**
- `id` (required): Team ID

**Response:**
```json
[
  {
    "id": 1,
    "teamId": 1,
    "userId": "user123",
    "role": "member",
    "joinedAt": "2024-01-15T10:30:00Z",
    "user": {
      "id": "user123",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "profileImageUrl": "https://replit.com/public/images/profile.png",
      "role": "user",
      "department": "Engineering",
      "isActive": true
    }
  }
]
```

#### Update Team Member Role
```http
PATCH /api/teams/{teamId}/members/{userId}
```

**Description:** Update a team member's role (admin only).

**Authentication:** Required (Admin role)

**Path Parameters:**
- `teamId` (required): Team ID
- `userId` (required): User ID

**Request Body:**
```json
{
  "role": "admin"
}
```

**Available Roles:**
- `member`: Regular team member
- `admin`: Team administrator

**Response:** Updated team member object

---

### Statistics

#### Get User Statistics
```http
GET /api/stats
```

**Description:** Get task statistics for the current user.

**Authentication:** Required

**Response:**
```json
{
  "total": 25,
  "open": 8,
  "inProgress": 5,
  "resolved": 10,
  "closed": 2,
  "highPriority": 3
}
```

#### Get Global Statistics
```http
GET /api/stats/global
```

**Description:** Get global task statistics.

**Authentication:** Required

**Response:** Same format as "Get User Statistics"

---

### Activity Tracking

#### Get Recent Activity
```http
GET /api/activity
```

**Description:** Retrieve recent activity across all tasks.

**Authentication:** Required

**Query Parameters:**
- `limit` (optional): Number of activity items to return (default: 10)

**Response:**
```json
[
  {
    "id": 1,
    "taskId": 1,
    "userId": "user123",
    "action": "status_changed",
    "oldValue": "open",
    "newValue": "in_progress",
    "field": "status",
    "createdAt": "2024-01-15T11:00:00Z"
  }
]
```

---

### Admin Operations

All admin endpoints require the authenticated user to have the "admin" role.

#### Get All Users (Admin)
```http
GET /api/admin/users
```

**Description:** Get all users with admin privileges.

**Authentication:** Required (Admin role)

**Response:** Same format as "Get All Users"

#### Get Admin Statistics
```http
GET /api/admin/stats
```

**Description:** Get comprehensive system statistics.

**Authentication:** Required (Admin role)

**Response:**
```json
{
  "totalUsers": 45,
  "activeUsers": 42,
  "totalTeams": 8,
  "openTickets": 23,
  "urgentTickets": 5,
  "avgResolutionTime": 12
}
```

#### Update User Profile
```http
PATCH /api/admin/users/{userId}
```

**Description:** Update a user's profile.

**Authentication:** Required (Admin role)

**Path Parameters:**
- `userId` (required): User ID to update

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "role": "manager",
  "department": "Engineering",
  "phone": "+1-555-123-4567",
  "isActive": true
}
```

**Available Roles:**
- `user`: Regular user
- `agent`: Support agent
- `manager`: Team manager
- `admin`: System administrator

**Response:** Updated user object

#### Toggle User Status
```http
POST /api/admin/users/{userId}/toggle-status
```

**Description:** Toggle a user's active/inactive status.

**Authentication:** Required (Admin role)

**Path Parameters:**
- `userId` (required): User ID

**Response:** Updated user object

#### Assign User to Team
```http
POST /api/admin/users/{userId}/assign-team
```

**Description:** Assign a user to a team.

**Authentication:** Required (Admin role)

**Path Parameters:**
- `userId` (required): User ID

**Request Body:**
```json
{
  "teamId": 1,
  "role": "member"
}
```

**Response:** Created team member object

#### Remove User from Team
```http
DELETE /api/admin/users/{userId}/remove-team/{teamId}
```

**Description:** Remove a user from a team.

**Authentication:** Required (Admin role)

**Path Parameters:**
- `userId` (required): User ID
- `teamId` (required): Team ID

**Response:** `204 No Content`

#### Get Departments
```http
GET /api/admin/departments
```

**Description:** Get all departments.

**Authentication:** Required (Admin role)

**Response:**
```json
[
  "Engineering",
  "Product",
  "Sales",
  "Marketing",
  "Support",
  "HR",
  "Finance"
]
```

#### Reset User Password
```http
POST /api/admin/users/{userId}/reset-password
```

**Description:** Reset a user's password.

**Authentication:** Required (Admin role)

**Path Parameters:**
- `userId` (required): User ID

**Response:**
```json
{
  "tempPassword": "temp123abc"
}
```

---

## Data Models

### User
```typescript
interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string; // user, agent, manager, admin
  department: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Task
```typescript
interface Task {
  id: number;
  ticketNumber: string; // TKT-YYYY-XXXX format
  title: string;
  description: string | null;
  category: string; // bug, feature, support, enhancement, incident, request
  status: string; // open, in_progress, resolved, closed, on_hold
  priority: string; // low, medium, high, urgent
  severity: string; // minor, normal, major, critical
  notes: string | null;
  assigneeId: string | null;
  assigneeType: string; // user, team
  assigneeTeamId: number | null;
  createdBy: string;
  dueDate: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  estimatedHours: number | null;
  actualHours: number | null;
  tags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Team
```typescript
interface Team {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date;
  createdBy: string;
}
```

### TeamMember
```typescript
interface TeamMember {
  id: number;
  teamId: number;
  userId: string;
  role: string; // admin, member
  joinedAt: Date;
}
```

### TaskComment
```typescript
interface TaskComment {
  id: number;
  taskId: number;
  userId: string;
  content: string;
  createdAt: Date;
}
```

### TaskHistory
```typescript
interface TaskHistory {
  id: number;
  taskId: number;
  userId: string;
  action: string; // created, updated, assigned, status_changed, etc.
  oldValue: string | null;
  newValue: string | null;
  field: string | null; // status, assignee, priority, etc.
  createdAt: Date;
}
```

---

## Error Handling

The API uses standard HTTP status codes and returns consistent error responses.

### HTTP Status Codes

- `200 OK`: Request successful
- `201 Created`: Resource created successfully
- `204 No Content`: Request successful, no content returned
- `400 Bad Request`: Invalid request data
- `401 Unauthorized`: Authentication required or failed
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

### Error Response Format

```json
{
  "message": "Error description",
  "errors": [
    {
      "field": "fieldName",
      "message": "Field-specific error message"
    }
  ]
}
```

### Common Error Scenarios

#### Authentication Errors
```json
{
  "message": "Unauthorized"
}
```

#### Validation Errors
```json
{
  "message": "Invalid task data",
  "errors": [
    {
      "field": "title",
      "message": "Title is required"
    },
    {
      "field": "category",
      "message": "Invalid category value"
    }
  ]
}
```

#### Permission Errors
```json
{
  "message": "Forbidden"
}
```

#### Not Found Errors
```json
{
  "message": "Task not found"
}
```

---

## Rate Limiting

Currently, there are no rate limits implemented. However, the application is designed to handle reasonable traffic loads through:

- Efficient database queries with proper indexing
- Session-based authentication to reduce authentication overhead
- Optimized API responses with minimal data transfer

---

## Postman Collection

A complete Postman collection is provided with this documentation (`TicketFlow_API_Collection.postman_collection.json`). The collection includes:

### Features
- **Environment Variables**: Configurable base URL and authentication
- **Pre-configured Requests**: All endpoints with sample data
- **Example Responses**: Expected response formats
- **Authorization**: Automatic session-based authentication
- **Variables**: Reusable IDs for testing different resources

### Setup Instructions

1. **Import Collection**: Import `TicketFlow_API_Collection.postman_collection.json` into Postman
2. **Set Base URL**: Update the `baseUrl` variable to your Replit app URL
3. **Authentication**: 
   - Navigate to your app in a browser and log in
   - Copy session cookies to Postman if needed
   - Alternatively, use Postman's built-in browser for automatic cookie handling

### Collection Structure

- **Authentication**: Login, logout, and user profile endpoints
- **Tasks**: Complete CRUD operations with filtering and pagination
- **Task Comments**: Comment management for tasks
- **Users**: User information retrieval
- **Teams**: Team management and membership operations
- **Statistics**: User and global statistics
- **Activity**: Recent activity tracking
- **Admin**: Administrative operations (requires admin role)

### Variables

The collection includes these variables for easy testing:
- `baseUrl`: Your application's base URL
- `taskId`: Sample task ID (1)
- `teamId`: Sample team ID (1)
- `userId`: Sample user ID (user123)

Update these variables based on your actual data for testing.

---

## Additional Notes

### Database Schema
The application uses PostgreSQL with Drizzle ORM. The schema includes:
- Proper foreign key relationships
- Indexed columns for performance
- Audit trails for all task changes
- Session storage for authentication

### Security Features
- Session-based authentication with secure cookies
- Role-based access control (RBAC)
- SQL injection prevention through ORM
- Input validation using Zod schemas
- HTTPS enforcement in production

### Performance Considerations
- Database connection pooling
- Efficient query patterns with proper joins
- Pagination support for large datasets
- Indexed columns for frequently queried fields

This documentation covers all available API endpoints in the TicketFlow application. For additional support or questions, please refer to the application's source code or contact the development team.