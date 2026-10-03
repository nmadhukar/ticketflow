# TicketFlow Database Schema Guide

## Overview

This document provides a comprehensive guide to the TicketFlow database schema, including table structures, relationships, indexes, and best practices for database operations.

## Core Tables

### Users Table

**Purpose**: Stores user account information and authentication data

```sql
CREATE TABLE users (
  id VARCHAR PRIMARY KEY,                    -- UUID from auth provider
  email VARCHAR UNIQUE NOT NULL,            -- User email address
  password VARCHAR,                          -- bcrypt hashed password (nullable for SSO users)
  password_reset_token VARCHAR,             -- Token for password reset
  password_reset_expires TIMESTAMP,         -- Reset token expiration
  first_name VARCHAR(100),                  -- User first name
  last_name VARCHAR(100),                   -- User last name
  profile_image_url VARCHAR(500),           -- URL to profile image
  role VARCHAR(50) DEFAULT 'user',          -- user, manager, admin, customer
  department VARCHAR(100),                  -- User department
  is_active BOOLEAN DEFAULT true,           -- Account active status
  is_approved BOOLEAN DEFAULT false,        -- Admin approval status
  failed_login_attempts INTEGER DEFAULT 0,  -- Failed login counter
  locked_until TIMESTAMP,                   -- Account lockout expiration
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_department ON users(department);
CREATE INDEX idx_users_is_active ON users(is_active, is_approved);
```

**Key Fields**:

- `id`: Primary key, UUID from authentication provider
- `role`: Determines access permissions (customer < user < manager < admin)
- `is_approved`: New registrations require admin approval
- `failed_login_attempts`: Account lockout protection

### Tasks Table

**Purpose**: Core ticketing system with comprehensive task management

```sql
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  ticket_number VARCHAR(20) UNIQUE NOT NULL,     -- TKT-YYYY-XXXX format
  title VARCHAR(255) NOT NULL,                   -- Task title
  description TEXT,                              -- Detailed description
  category VARCHAR(50) NOT NULL,                 -- bug, feature, support, etc.
  status VARCHAR(50) DEFAULT 'open',             -- open, in_progress, resolved, etc.
  priority VARCHAR(20) DEFAULT 'medium',         -- low, medium, high, urgent
  severity VARCHAR(20) DEFAULT 'normal',         -- minor, normal, major, critical

  -- Assignment
  assignee_id VARCHAR REFERENCES users(id),     -- Assigned user
  assignee_type VARCHAR(10) DEFAULT 'user',     -- 'user' or 'team'
  assigned_team_id INTEGER REFERENCES teams(id), -- Assigned team

  -- Metadata
  created_by VARCHAR REFERENCES users(id) NOT NULL,
  last_updated_by VARCHAR REFERENCES users(id),
  due_date TIMESTAMP,

  -- Time tracking
  estimated_hours DECIMAL(5,2),
  actual_hours DECIMAL(5,2),

  -- Organization
  tags TEXT[],                                   -- Array of tags

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  closed_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_created_by ON tasks(created_by);
CREATE INDEX idx_tasks_category ON tasks(category);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_ticket_number ON tasks(ticket_number);

-- Full-text search index
CREATE INDEX idx_tasks_search ON tasks USING gin(
  to_tsvector('english', title || ' ' || COALESCE(description, ''))
);
```

**Key Features**:

- Unique ticket numbering with year prefix
- Flexible assignment (user or team)
- Time tracking capabilities
- Full-text search support
- Comprehensive status tracking

### Teams Table

**Purpose**: Organizational structure for task assignment and collaboration

```sql
CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  manager_id VARCHAR REFERENCES users(id),      -- Team manager
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Junction table for team membership
CREATE TABLE team_members (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member',            -- member, admin
  joined_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(team_id, user_id)
);

-- Indexes
CREATE INDEX idx_teams_manager ON teams(manager_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
```

### Task Comments Table

**Purpose**: Conversation history and collaboration on tasks

```sql
CREATE TABLE task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) NOT NULL,
  content TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,            -- Internal notes vs public comments
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_task_comments_task ON task_comments(task_id);
CREATE INDEX idx_task_comments_user ON task_comments(user_id);
CREATE INDEX idx_task_comments_created ON task_comments(created_at);
```

### Task History Table

**Purpose**: Audit trail for all task changes

```sql
CREATE TABLE task_history (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) NOT NULL,
  field VARCHAR(50) NOT NULL,                   -- Changed field name
  old_value TEXT,                               -- Previous value
  new_value TEXT,                               -- New value
  change_type VARCHAR(20) NOT NULL,             -- created, updated, deleted
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_task_history_task ON task_history(task_id);
CREATE INDEX idx_task_history_user ON task_history(user_id);
CREATE INDEX idx_task_history_created ON task_history(created_at);
```

## AI Integration Tables

### Ticket Auto Responses

**Purpose**: Track AI-generated automatic responses

```sql
CREATE TABLE ticket_auto_responses (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  confidence_score DECIMAL(3,2) NOT NULL,       -- 0.00 to 1.00
  model_used VARCHAR(100),                      -- AI model identifier
  prompt_tokens INTEGER,                        -- Token usage tracking
  completion_tokens INTEGER,
  was_helpful BOOLEAN,                          -- User feedback
  feedback_reason TEXT,                         -- Why helpful/not helpful
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_auto_responses_task ON ticket_auto_responses(task_id);
CREATE INDEX idx_auto_responses_confidence ON ticket_auto_responses(confidence_score);
CREATE INDEX idx_auto_responses_helpful ON ticket_auto_responses(was_helpful);
```

### Ticket Complexity Scores

**Purpose**: AI-driven complexity analysis for escalation

```sql
CREATE TABLE ticket_complexity_scores (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  complexity_score INTEGER NOT NULL,            -- 0-100 scale
  factors JSONB,                                -- Contributing factors
  escalation_recommended BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_complexity_task ON ticket_complexity_scores(task_id);
CREATE INDEX idx_complexity_score ON ticket_complexity_scores(complexity_score);
CREATE INDEX idx_complexity_escalation ON ticket_complexity_scores(escalation_recommended);
```

### Knowledge Articles

**Purpose**: AI-generated and manually created knowledge base

```sql
CREATE TABLE knowledge_articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(100),
  tags TEXT[],
  status VARCHAR(20) DEFAULT 'draft',           -- draft, published, archived
  source VARCHAR(20) DEFAULT 'manual',          -- manual, ai_generated
  source_task_id INTEGER REFERENCES tasks(id), -- If generated from task
  effectiveness_score DECIMAL(3,2),            -- User rating 0-1
  view_count INTEGER DEFAULT 0,
  helpful_votes INTEGER DEFAULT 0,
  unhelpful_votes INTEGER DEFAULT 0,
  created_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_knowledge_category ON knowledge_articles(category);
CREATE INDEX idx_knowledge_status ON knowledge_articles(status);
CREATE INDEX idx_knowledge_source ON knowledge_articles(source);
CREATE INDEX idx_knowledge_effectiveness ON knowledge_articles(effectiveness_score);

-- Full-text search
CREATE INDEX idx_knowledge_search ON knowledge_articles USING gin(
  to_tsvector('english', title || ' ' || content)
);
```

### AI Analytics

**Purpose**: Track AI service usage and performance metrics

```sql
CREATE TABLE ai_analytics (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  metric_name VARCHAR(50) NOT NULL,
  metric_value DECIMAL(10,2),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(date, metric_name)
);

-- Indexes
CREATE INDEX idx_ai_analytics_date ON ai_analytics(date);
CREATE INDEX idx_ai_analytics_metric ON ai_analytics(metric_name);
```

## Configuration Tables

### Company Settings

**Purpose**: System-wide configuration and branding

```sql
CREATE TABLE company_settings (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(255),
  logo_data TEXT,                               -- Base64 encoded logo
  logo_mime_type VARCHAR(50),
  ticket_prefix VARCHAR(10) DEFAULT 'TKT',     -- Customizable ticket prefix

  -- AWS Configuration
  aws_access_key_id_ses VARCHAR(100),          -- SES credentials
  aws_secret_access_key_ses VARCHAR(100),
  aws_region_ses VARCHAR(20) DEFAULT 'us-east-1',

  aws_access_key_id_bedrock VARCHAR(100),      -- Bedrock credentials
  aws_secret_access_key_bedrock VARCHAR(100),
  aws_region_bedrock VARCHAR(20) DEFAULT 'us-east-1',

  -- Microsoft SSO
  microsoft_client_id VARCHAR(100),
  microsoft_client_secret VARCHAR(100),
  microsoft_tenant_id VARCHAR(100),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### API Keys Management

**Purpose**: Secure API key storage for integrations

```sql
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,              -- Hashed API key
  is_active BOOLEAN DEFAULT true,
  created_by VARCHAR REFERENCES users(id),
  last_used TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_api_keys_service ON api_keys(service);
CREATE INDEX idx_api_keys_active ON api_keys(is_active);
```

## Session Management

### Sessions Table

**Purpose**: User session persistence (required for authentication)

```sql
CREATE TABLE sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL
);

-- Index for cleanup
CREATE INDEX idx_sessions_expire ON sessions(expire);
```

## Departments & User Management

### Departments

**Purpose**: Organizational structure for user management

```sql
CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  manager_id VARCHAR REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### User Invitations

**Purpose**: Email-based user invitation system

```sql
CREATE TABLE user_invitations (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(50) NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  invited_by VARCHAR REFERENCES users(id) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',        -- pending, accepted, expired, cancelled
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_invitations_email ON user_invitations(email);
CREATE INDEX idx_invitations_token ON user_invitations(token);
CREATE INDEX idx_invitations_status ON user_invitations(status);
```

## Attachments & File Management

### Task Attachments

**Purpose**: File attachments for tasks

```sql
CREATE TABLE task_attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,              -- Stored filename
  original_name VARCHAR(255) NOT NULL,         -- Original filename
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,                  -- Size in bytes
  file_path VARCHAR(500) NOT NULL,             -- Storage path
  description TEXT,
  uploaded_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_attachments_task ON task_attachments(task_id);
CREATE INDEX idx_attachments_uploaded_by ON task_attachments(uploaded_by);
```

## Notification System

### Notifications

**Purpose**: User notification management

```sql
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,                   -- task_assigned, comment_added, etc.
  related_task_id INTEGER REFERENCES tasks(id),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_type ON notifications(type);
```

## Database Relationships

### Entity Relationship Overview

```
Users (1) ←→ (N) Tasks (assignee/creator)
Users (1) ←→ (N) Team_Members ←→ (N) Teams
Tasks (1) ←→ (N) Task_Comments
Tasks (1) ←→ (N) Task_History
Tasks (1) ←→ (N) Task_Attachments
Tasks (1) ←→ (1) Ticket_Auto_Responses
Tasks (1) ←→ (1) Ticket_Complexity_Scores
Users (1) ←→ (N) Departments (manager)
Users (1) ←→ (N) User_Invitations (invited_by)
```

### Key Foreign Key Constraints

```sql
-- User relationships
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_assignee
  FOREIGN KEY (assignee_id) REFERENCES users(id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_creator
  FOREIGN KEY (created_by) REFERENCES users(id);

-- Team relationships
ALTER TABLE team_members ADD CONSTRAINT fk_team_members_team
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE team_members ADD CONSTRAINT fk_team_members_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Task relationships
ALTER TABLE task_comments ADD CONSTRAINT fk_comments_task
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE task_history ADD CONSTRAINT fk_history_task
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
```

## Performance Optimization

### Query Optimization

**Frequently Used Queries**:

1. **Task Listing with Filters**:

```sql
-- Optimized with proper indexes
SELECT t.*, u.first_name, u.last_name
FROM tasks t
LEFT JOIN users u ON t.assignee_id = u.id
WHERE t.status = 'open' AND t.priority = 'high'
ORDER BY t.created_at DESC
LIMIT 50;
```

2. **User Dashboard Statistics**:

```sql
-- Uses partial indexes for better performance
SELECT
  COUNT(*) FILTER (WHERE status = 'open') AS open_tasks,
  COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_tasks,
  COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_tasks
FROM tasks
WHERE assignee_id = $1;
```

3. **Search Functionality**:

```sql
-- Full-text search with ranking
SELECT t.*, ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
FROM (
  SELECT *, to_tsvector('english', title || ' ' || COALESCE(description, '')) AS search_vector
  FROM tasks
) t
WHERE search_vector @@ plainto_tsquery('english', $1)
ORDER BY rank DESC, created_at DESC;
```

### Database Maintenance

**Regular Maintenance Tasks**:

```sql
-- Weekly vacuum and analyze
VACUUM ANALYZE;

-- Reindex search indexes monthly
REINDEX INDEX idx_tasks_search;
REINDEX INDEX idx_knowledge_search;

-- Clean old sessions daily
DELETE FROM sessions WHERE expire < NOW();

-- Archive old task history (keep 1 year)
DELETE FROM task_history WHERE created_at < NOW() - INTERVAL '1 year';

-- Update table statistics
ANALYZE tasks;
ANALYZE users;
ANALYZE knowledge_articles;
```

## Data Migration & Backup

### Backup Strategy

```bash
# Full database backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Table-specific backups
pg_dump $DATABASE_URL -t tasks -t users > critical_tables_backup.sql

# Compressed backup
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Migration Best Practices

1. **Always backup before migrations**
2. **Test migrations on staging first**
3. **Use transactions for atomic changes**
4. **Monitor query performance after schema changes**

```sql
-- Example migration template
BEGIN;

-- Migration steps here
ALTER TABLE tasks ADD COLUMN new_field VARCHAR(100);
CREATE INDEX idx_tasks_new_field ON tasks(new_field);

-- Verify migration
SELECT COUNT(*) FROM tasks;

-- Commit if successful
COMMIT;
```

## Security Considerations

### Access Control

- **Row Level Security**: Implement for multi-tenant scenarios
- **Column Permissions**: Restrict sensitive fields to admin users
- **Connection Limits**: Configure max connections per user role

### Data Encryption

```sql
-- Enable encryption for sensitive columns
ALTER TABLE users ALTER COLUMN password SET STORAGE PLAIN;
ALTER TABLE api_keys ALTER COLUMN key_hash SET STORAGE PLAIN;

-- Use pgcrypto for additional encryption needs
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Audit Logging

```sql
-- Enable audit logging for critical operations
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, operation, user_id, old_values, new_values)
  VALUES (TG_TABLE_NAME, TG_OP, current_setting('app.current_user_id'),
          row_to_json(OLD), row_to_json(NEW));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

This database schema guide provides a comprehensive foundation for understanding and working with the TicketFlow database. Regular review and updates ensure optimal performance and maintainability.
