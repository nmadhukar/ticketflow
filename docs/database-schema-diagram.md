# TicketFlow Database Schema Diagram

## Entity Relationship Diagram

```mermaid
erDiagram
    users ||--o{ tasks : creates
    users ||--o{ tasks : "assigned to"
    users ||--o{ teamMembers : "belongs to"
    users ||--o{ taskComments : writes
    users ||--o{ taskHistory : logs
    users ||--o{ taskAttachments : uploads
    users ||--o{ apiKeys : owns
    users ||--o{ userInvitations : invites
    users ||--o{ aiChatMessages : chats
    users ||--o{ helpDocuments : uploads
    users ||--o{ userGuides : creates
    users ||--o{ teamsIntegrationSettings : configures
    
    teams ||--o{ teamMembers : has
    teams ||--o{ tasks : "assigned to"
    teams }o--|| users : "created by"
    
    departments ||--o{ users : contains
    
    tasks ||--o{ taskComments : has
    tasks ||--o{ taskHistory : tracks
    tasks ||--o{ taskAttachments : contains
    
    userGuideCategories ||--o{ userGuides : categorizes
    
    helpDocuments ||--o{ aiChatMessages : "referenced in"

    users {
        varchar id PK
        varchar email UK
        varchar firstName
        varchar lastName
        varchar profileImageUrl
        varchar role
        varchar department
        varchar phone
        boolean isActive
        timestamp createdAt
        timestamp updatedAt
    }

    departments {
        serial id PK
        varchar name UK
        text description
        boolean isActive
        timestamp createdAt
        timestamp updatedAt
    }

    teams {
        serial id PK
        varchar name
        text description
        varchar createdBy FK
        timestamp createdAt
    }

    teamMembers {
        serial id PK
        integer teamId FK
        varchar userId FK
        varchar role
        timestamp joinedAt
    }

    tasks {
        serial id PK
        varchar ticketNumber UK
        varchar title
        text description
        varchar category
        varchar status
        varchar priority
        varchar severity
        text notes
        varchar assigneeId FK
        varchar assigneeType
        integer assigneeTeamId FK
        varchar createdBy FK
        timestamp dueDate
        timestamp resolvedAt
        timestamp closedAt
        integer estimatedHours
        integer actualHours
        text[] tags
        timestamp createdAt
        timestamp updatedAt
    }

    taskComments {
        serial id PK
        integer taskId FK
        varchar userId FK
        text content
        timestamp createdAt
    }

    taskHistory {
        serial id PK
        integer taskId FK
        varchar userId FK
        varchar action
        text oldValue
        text newValue
        varchar field
        timestamp createdAt
    }

    taskAttachments {
        serial id PK
        integer taskId FK
        varchar userId FK
        varchar fileName
        integer fileSize
        varchar fileType
        text fileUrl
        timestamp createdAt
    }

    companySettings {
        serial id PK
        varchar companyName
        text logoUrl
        varchar primaryColor
        varchar updatedBy FK
        timestamp updatedAt
    }

    apiKeys {
        serial id PK
        varchar userId FK
        varchar name
        varchar keyHash
        varchar keyPrefix
        text[] permissions
        timestamp lastUsedAt
        timestamp expiresAt
        boolean isActive
        timestamp createdAt
    }

    smtpSettings {
        serial id PK
        varchar host
        integer port
        varchar username
        varchar password
        varchar fromEmail
        varchar fromName
        varchar encryption
        boolean isActive
        varchar updatedBy FK
        timestamp updatedAt
    }

    emailTemplates {
        serial id PK
        varchar name UK
        varchar subject
        text body
        text[] variables
        boolean isActive
        varchar updatedBy FK
        timestamp updatedAt
    }

    helpDocuments {
        serial id PK
        varchar title
        varchar filename
        text content
        text fileData
        varchar uploadedBy FK
        varchar category
        text[] tags
        integer viewCount
        timestamp createdAt
        timestamp updatedAt
    }

    aiChatMessages {
        serial id PK
        varchar userId FK
        varchar sessionId
        varchar role
        text content
        integer[] relatedDocumentIds
        timestamp createdAt
    }

    userInvitations {
        serial id PK
        varchar email
        varchar firstName
        varchar lastName
        varchar role
        varchar department
        varchar invitedBy FK
        varchar invitationToken UK
        varchar status
        timestamp expiresAt
        timestamp acceptedAt
        timestamp createdAt
    }

    userGuides {
        serial id PK
        varchar title
        text description
        varchar category
        varchar type
        text content
        varchar scribehowUrl
        varchar videoUrl
        text[] tags
        boolean isPublished
        integer viewCount
        varchar createdBy FK
        timestamp createdAt
        timestamp updatedAt
    }

    userGuideCategories {
        serial id PK
        varchar name UK
        text description
        integer displayOrder
        boolean isActive
        timestamp createdAt
    }

    teamsIntegrationSettings {
        serial id PK
        varchar userId FK UK
        boolean enabled
        varchar teamId
        varchar teamName
        varchar channelId
        varchar channelName
        text webhookUrl
        text[] notificationTypes
        timestamp createdAt
        timestamp updatedAt
    }

    sessions {
        varchar sid PK
        jsonb sess
        timestamp expire
    }
```

## Table Relationships Summary

### Core Relationships
1. **Users** are the central entity connecting to most other tables
2. **Tasks** can be assigned to either Users or Teams
3. **Teams** have multiple members through the TeamMembers junction table
4. **Departments** group users organizationally

### Audit & History
1. **TaskHistory** tracks all changes to tasks
2. **TaskComments** provides discussion threads
3. **TaskAttachments** stores file references

### Configuration
1. **CompanySettings** stores global branding
2. **SmtpSettings** configures email delivery
3. **EmailTemplates** defines notification formats

### Integration
1. **ApiKeys** manages third-party access
2. **TeamsIntegrationSettings** configures Microsoft Teams
3. **UserInvitations** handles onboarding

### Help System
1. **HelpDocuments** stores admin documentation
2. **UserGuides** provides user tutorials
3. **AiChatMessages** tracks AI assistance conversations

## Key Design Patterns

### 1. Soft Deletes
Tables use `isActive` boolean flags instead of hard deletes to maintain data integrity and audit trails.

### 2. Audit Timestamps
Most tables include `createdAt` and `updatedAt` timestamps for tracking.

### 3. Polymorphic Associations
Tasks can be assigned to either users or teams using `assigneeType` field.

### 4. Array Columns
PostgreSQL arrays are used for:
- Task tags
- API permissions
- Email template variables
- Help document tags
- Notification types

### 5. Junction Tables
- **teamMembers**: Links users to teams with roles
- **aiChatMessages**: Links chats to help documents

## Index Strategy

### Primary Indexes
- All primary keys are automatically indexed

### Unique Constraints
- users.email
- tasks.ticketNumber
- departments.name
- userInvitations.invitationToken
- emailTemplates.name
- userGuideCategories.name
- teamsIntegrationSettings.userId

### Foreign Key Indexes
All foreign keys have indexes for join performance

### Additional Indexes
- sessions.expire (for cleanup queries)
- tasks.status (for filtering)
- tasks.assigneeId (for user task lists)
- tasks.createdAt (for sorting)