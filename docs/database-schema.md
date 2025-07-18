# TicketFlow Database Schema Documentation

## Overview
TicketFlow uses PostgreSQL as its primary database with Drizzle ORM for type-safe database operations. The schema is designed to support a comprehensive ticketing system with role-based access control, team collaboration, audit trails, and third-party integrations.

## Database Tables

### 1. Authentication & User Management

#### sessions
Stores authentication sessions for users (managed by Replit Auth).
- **sid** (varchar, PK): Session ID
- **sess** (jsonb): Session data
- **expire** (timestamp): Session expiration time
- **Index**: IDX_session_expire on expire column

#### users
Core user information synchronized from authentication providers.
- **id** (varchar, PK): Unique user identifier
- **email** (varchar, unique): User email address
- **firstName** (varchar): User's first name
- **lastName** (varchar): User's last name
- **profileImageUrl** (varchar): URL to profile picture
- **role** (varchar): User role (admin, manager, user, customer)
- **department** (varchar): Department assignment
- **phone** (varchar): Contact phone number
- **isActive** (boolean): Account active status
- **createdAt** (timestamp): Account creation date
- **updatedAt** (timestamp): Last update date

#### userInvitations
Manages user invitations for onboarding new team members.
- **id** (serial, PK): Invitation ID
- **email** (varchar): Invitee email
- **firstName** (varchar): Invitee first name
- **lastName** (varchar): Invitee last name
- **role** (varchar): Assigned role
- **department** (varchar): Assigned department
- **invitedBy** (varchar, FK->users.id): Inviter user ID
- **invitationToken** (varchar, unique): Secure invitation token
- **status** (varchar): Invitation status (pending, accepted, expired)
- **expiresAt** (timestamp): Invitation expiration
- **acceptedAt** (timestamp): Acceptance timestamp
- **createdAt** (timestamp): Invitation creation date

### 2. Organization Structure

#### departments
Organizational departments for user grouping.
- **id** (serial, PK): Department ID
- **name** (varchar, unique): Department name
- **description** (text): Department description
- **isActive** (boolean): Active status
- **createdAt** (timestamp): Creation date
- **updatedAt** (timestamp): Last update date

#### teams
Project teams for task assignment and collaboration.
- **id** (serial, PK): Team ID
- **name** (varchar): Team name
- **description** (text): Team description
- **createdBy** (varchar, FK->users.id): Creator user ID
- **createdAt** (timestamp): Creation date

#### teamMembers
Junction table for team membership.
- **id** (serial, PK): Membership ID
- **teamId** (integer, FK->teams.id): Team ID
- **userId** (varchar, FK->users.id): User ID
- **role** (varchar): Role in team (admin, member)
- **joinedAt** (timestamp): Join date

### 3. Core Ticketing System

#### tasks
Main ticket/task table containing all issue tracking data.
- **id** (serial, PK): Task ID
- **ticketNumber** (varchar, unique): Formatted ticket number (e.g., TKT-2024-0001)
- **title** (varchar): Task title
- **description** (text): Detailed description
- **category** (varchar): Category (bug, feature, support, enhancement, incident, request)
- **status** (varchar): Current status (open, in_progress, resolved, closed, on_hold)
- **priority** (varchar): Priority level (low, medium, high, urgent)
- **severity** (varchar): Severity level (minor, normal, major, critical)
- **notes** (text): Internal progress notes
- **assigneeId** (varchar, FK->users.id): Assigned user
- **assigneeType** (varchar): Assignment type (user, team)
- **assigneeTeamId** (integer, FK->teams.id): Assigned team
- **createdBy** (varchar, FK->users.id): Task creator
- **dueDate** (timestamp): Due date
- **resolvedAt** (timestamp): Resolution timestamp
- **closedAt** (timestamp): Closure timestamp
- **estimatedHours** (integer): Estimated work hours
- **actualHours** (integer): Actual work hours
- **tags** (text[]): Array of tags
- **createdAt** (timestamp): Creation date
- **updatedAt** (timestamp): Last update date

#### taskComments
User comments and discussions on tasks.
- **id** (serial, PK): Comment ID
- **taskId** (integer, FK->tasks.id): Parent task
- **userId** (varchar, FK->users.id): Commenter
- **content** (text): Comment content
- **createdAt** (timestamp): Comment date

#### taskHistory
Audit trail for all task modifications.
- **id** (serial, PK): History entry ID
- **taskId** (integer, FK->tasks.id): Related task
- **userId** (varchar, FK->users.id): User who made change
- **action** (varchar): Action type (created, updated, assigned, status_changed, etc.)
- **oldValue** (text): Previous value
- **newValue** (text): New value
- **field** (varchar): Changed field name
- **createdAt** (timestamp): Change timestamp

#### taskAttachments
File attachments for tasks.
- **id** (serial, PK): Attachment ID
- **taskId** (integer, FK->tasks.id): Parent task
- **userId** (varchar, FK->users.id): Uploader
- **fileName** (varchar): Original filename
- **fileSize** (integer): File size in bytes
- **fileType** (varchar): MIME type
- **fileUrl** (text): Storage URL
- **createdAt** (timestamp): Upload date

### 4. Configuration & Settings

#### companySettings
Global company branding and configuration.
- **id** (serial, PK): Settings ID
- **companyName** (varchar): Company name
- **logoUrl** (text): Company logo URL
- **primaryColor** (varchar): Primary theme color (hex)
- **updatedBy** (varchar, FK->users.id): Last updater
- **updatedAt** (timestamp): Last update date

#### smtpSettings
Email server configuration for notifications.
- **id** (serial, PK): Settings ID
- **host** (varchar): SMTP host
- **port** (integer): SMTP port
- **username** (varchar): SMTP username
- **password** (varchar): Encrypted password
- **fromEmail** (varchar): Sender email
- **fromName** (varchar): Sender name
- **encryption** (varchar): Encryption type (tls, ssl, none)
- **isActive** (boolean): Active status
- **updatedBy** (varchar, FK->users.id): Last updater
- **updatedAt** (timestamp): Last update date

#### emailTemplates
Customizable email notification templates.
- **id** (serial, PK): Template ID
- **name** (varchar, unique): Template identifier
- **subject** (varchar): Email subject line
- **body** (text): HTML template body
- **variables** (text[]): Available template variables
- **isActive** (boolean): Active status
- **updatedBy** (varchar, FK->users.id): Last updater
- **updatedAt** (timestamp): Last update date

### 5. Integrations

#### apiKeys
API keys for third-party integrations.
- **id** (serial, PK): Key ID
- **userId** (varchar, FK->users.id): Owner user
- **name** (varchar): Key name/description
- **keyHash** (varchar): Hashed API key
- **keyPrefix** (varchar): Key prefix for identification
- **permissions** (text[]): Permission array
- **lastUsedAt** (timestamp): Last usage
- **expiresAt** (timestamp): Expiration date
- **isActive** (boolean): Active status
- **createdAt** (timestamp): Creation date

#### teamsIntegrationSettings
Microsoft Teams integration configuration per user.
- **id** (serial, PK): Settings ID
- **userId** (varchar, FK->users.id, unique): User ID
- **enabled** (boolean): Integration enabled
- **teamId** (varchar): Microsoft Teams team ID
- **teamName** (varchar): Team name
- **channelId** (varchar): Channel ID
- **channelName** (varchar): Channel name
- **webhookUrl** (text): Incoming webhook URL
- **notificationTypes** (text[]): Enabled notification types
- **createdAt** (timestamp): Creation date
- **updatedAt** (timestamp): Last update date

### 6. Help & Documentation

#### helpDocuments
Admin-uploaded help documentation.
- **id** (serial, PK): Document ID
- **title** (varchar): Document title
- **filename** (varchar): Original filename
- **content** (text): Extracted searchable content
- **fileData** (text): Base64 encoded file
- **uploadedBy** (varchar, FK->users.id): Uploader
- **category** (varchar): Document category
- **tags** (text[]): Search tags
- **viewCount** (integer): View counter
- **createdAt** (timestamp): Upload date
- **updatedAt** (timestamp): Last update date

#### userGuides
User-facing guides and tutorials.
- **id** (serial, PK): Guide ID
- **title** (varchar): Guide title
- **description** (text): Guide description
- **category** (varchar): Guide category
- **type** (varchar): Content type (scribehow, html, video)
- **content** (text): HTML content or embed codes
- **scribehowUrl** (varchar): Scribehow guide URL
- **videoUrl** (varchar): Video URL
- **tags** (text[]): Search tags
- **isPublished** (boolean): Published status
- **viewCount** (integer): View counter
- **createdBy** (varchar, FK->users.id): Creator
- **createdAt** (timestamp): Creation date
- **updatedAt** (timestamp): Last update date

#### userGuideCategories
Categories for organizing user guides.
- **id** (serial, PK): Category ID
- **name** (varchar, unique): Category name
- **description** (text): Category description
- **displayOrder** (integer): Sort order
- **isActive** (boolean): Active status
- **createdAt** (timestamp): Creation date

#### aiChatMessages
AI chatbot conversation history.
- **id** (serial, PK): Message ID
- **userId** (varchar, FK->users.id): User ID
- **sessionId** (varchar): Chat session ID
- **role** (varchar): Message role (user, assistant)
- **content** (text): Message content
- **relatedDocumentIds** (integer[]): Referenced help documents
- **createdAt** (timestamp): Message timestamp

## Database Relations

### User Relations
- Users → Tasks (one-to-many): Created tasks
- Users → Tasks (one-to-many): Assigned tasks
- Users → TeamMembers (one-to-many): Team memberships
- Users → TaskComments (one-to-many): Comments
- Users → TaskHistory (one-to-many): Change history
- Users → TaskAttachments (one-to-many): Uploaded files
- Users → ApiKeys (one-to-many): API keys

### Team Relations
- Teams → Users (many-to-one): Team creator
- Teams → TeamMembers (one-to-many): Team members
- Teams → Tasks (one-to-many): Assigned tasks

### Task Relations
- Tasks → Users (many-to-one): Task creator
- Tasks → Users (many-to-one): Task assignee
- Tasks → Teams (many-to-one): Assigned team
- Tasks → TaskComments (one-to-many): Comments
- Tasks → TaskHistory (one-to-many): History entries
- Tasks → TaskAttachments (one-to-many): Attachments

## Indexes

1. **sessions**: IDX_session_expire on expire column for efficient session cleanup
2. **users**: Unique index on email column
3. **tasks**: Unique index on ticketNumber column
4. **userInvitations**: Unique index on invitationToken column
5. **departments**: Unique index on name column
6. **teamsIntegrationSettings**: Unique index on userId column

## Security Considerations

1. **Password Storage**: SMTP passwords are encrypted before storage
2. **API Keys**: Stored as hashed values with only prefix visible
3. **Session Management**: Sessions expire and are cleaned up regularly
4. **File Storage**: File URLs should point to secure storage with access controls
5. **Role-Based Access**: User roles determine data access permissions

## Performance Considerations

1. **Indexes**: Strategic indexes on foreign keys and frequently queried columns
2. **JSONB Fields**: Used for flexible session data storage
3. **Array Fields**: PostgreSQL arrays for tags and permissions
4. **Timestamps**: Consistent use of timestamps for audit trails
5. **Soft Deletes**: isActive flags instead of hard deletes where appropriate