# TicketFlow Deployment Guide

## Quick Start Deployment

### Prerequisites
- Node.js 18+ with npm
- PostgreSQL 13+ database
- AWS account with SES and Bedrock access
- HTTPS domain (required for production)

### Environment Setup

Create `.env` file with required variables:

```bash
# Database Configuration
DATABASE_URL=postgresql://user:password@host:5432/ticketflow
PGHOST=localhost
PGPORT=5432
PGUSER=ticketflow_user
PGPASSWORD=your_secure_password
PGDATABASE=ticketflow

# Authentication
SESSION_SECRET=your-long-random-session-secret-minimum-32-characters

# AWS Services (configured via admin panel)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Optional: Microsoft SSO
MICROSOFT_CLIENT_ID=your-azure-app-id
MICROSOFT_CLIENT_SECRET=your-azure-secret
MICROSOFT_TENANT_ID=your-tenant-id

# Production Settings
NODE_ENV=production
PORT=5000
```

### Installation Steps

1. **Clone and Install Dependencies**:
```bash
git clone <repository-url>
cd ticketflow
npm install
```

2. **Database Setup**:
```bash
# Apply database schema
npm run db:push

# Verify database connection
npm run db:studio
```

3. **Build Application**:
```bash
# Build frontend and backend
npm run build
```

4. **Start Production Server**:
```bash
# Start the application
npm start
```

5. **Create Admin User**:
- Navigate to `/auth` and register first user
- Update user role to 'admin' in database:
```sql
UPDATE users SET role = 'admin', is_approved = true WHERE email = 'your-admin@email.com';
```

## Replit Deployment

### Setup on Replit

1. **Import Repository**:
   - Create new Repl from GitHub repository
   - Replit automatically detects Node.js configuration

2. **Configure Secrets**:
   - Add environment variables in Replit Secrets tab
   - Include all required variables from `.env` template above

3. **Database Configuration**:
   - Use Neon PostgreSQL (provided by Replit)
   - DATABASE_URL is automatically configured

4. **Deploy**:
   - Click "Deploy" button in Replit
   - Application will be available at your-repl-name.replit.app

### Replit-Specific Configuration

The application is pre-configured for Replit with:
- Automatic port binding (`0.0.0.0:${PORT}`)
- Neon database integration
- Production build optimization
- Static file serving

## AWS Configuration

### SES (Email Service)

1. **Create IAM User**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:GetSendQuota",
        "ses:GetSendStatistics"
      ],
      "Resource": "*"
    }
  ]
}
```

2. **Verify Domain/Email**:
   - Add and verify your sending domain in SES
   - Move out of sandbox mode for production

3. **Configure in Admin Panel**:
   - Navigate to Admin → API Keys
   - Add AWS SES credentials

### Bedrock (AI Service)

1. **Enable Bedrock Access**:
   - Request access to Claude 3 Sonnet model in AWS Console
   - Available regions: us-east-1, us-west-2, eu-west-1

2. **Create IAM User**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListFoundationModels"
      ],
      "Resource": "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-*"
    }
  ]
}
```

3. **Configure in Admin Panel**:
   - Navigate to Admin → API Keys
   - Add AWS Bedrock credentials (can be same or separate from SES)

## Production Optimization

### Performance Settings

1. **Database Optimization**:
```sql
-- Recommended PostgreSQL settings
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
SELECT pg_reload_conf();
```

2. **Connection Pooling**:
```typescript
// In server/db.ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // Maximum connections
  idleTimeoutMillis: 30000,   // 30 seconds
  connectionTimeoutMillis: 2000, // 2 seconds
});
```

3. **Redis Caching** (Optional):
```bash
# Install Redis for session storage
npm install redis connect-redis

# Update session configuration
const RedisStore = require('connect-redis')(session);
const redisClient = redis.createClient(process.env.REDIS_URL);
```

### Security Hardening

1. **SSL/TLS Configuration**:
```javascript
// Force HTTPS in production
app.use((req, res, next) => {
  if (req.header('x-forwarded-proto') !== 'https') {
    res.redirect(`https://${req.header('host')}${req.url}`);
  } else {
    next();
  }
});
```

2. **Rate Limiting**:
```javascript
// Stricter rate limits for production
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                   // Reduced limit
  standardHeaders: true,
  legacyHeaders: false,
});
```

3. **Security Headers**:
```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

## Monitoring & Maintenance

### Health Checks

Create health check endpoint:
```javascript
app.get('/health', async (req, res) => {
  try {
    // Check database
    await db.raw('SELECT 1');
    
    // Check AWS services
    const sesStatus = await checkSESConnection();
    const bedrockStatus = await checkBedrockConnection();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        ses: sesStatus ? 'connected' : 'disconnected',
        bedrock: bedrockStatus ? 'connected' : 'disconnected'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

### Logging Configuration

1. **Structured Logging**:
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

2. **Error Tracking**:
```javascript
// Global error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    userId: req.user?.id
  });
  
  res.status(500).json({
    error: 'Internal server error',
    requestId: req.id
  });
});
```

### Backup Strategy

1. **Automated Database Backups**:
```bash
#!/bin/bash
# Daily backup script
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump $DATABASE_URL | gzip > /backups/ticketflow_$DATE.sql.gz

# Keep only last 30 days
find /backups -name "ticketflow_*.sql.gz" -mtime +30 -delete
```

2. **File Backup**:
```bash
# Backup uploaded files
tar -czf /backups/files_$DATE.tar.gz ./uploads/
```

## Scaling Considerations

### Horizontal Scaling

1. **Load Balancer Configuration**:
```nginx
upstream ticketflow_app {
    server 127.0.0.1:5000;
    server 127.0.0.1:5001;
    server 127.0.0.1:5002;
}

server {
    listen 80;
    server_name ticketflow.example.com;
    
    location / {
        proxy_pass http://ticketflow_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /ws {
        proxy_pass http://ticketflow_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

2. **Session Affinity**:
```nginx
# Sticky sessions for WebSocket connections
upstream ticketflow_app {
    ip_hash;
    server 127.0.0.1:5000;
    server 127.0.0.1:5001;
}
```

### Database Scaling

1. **Read Replicas**:
```javascript
const masterDb = drizzle(masterPool);
const replicaDb = drizzle(replicaPool);

// Route read queries to replica
const getTasksForUser = async (userId) => {
  return await replicaDb.select().from(tasks).where(eq(tasks.assigneeId, userId));
};
```

2. **Connection Pooling**:
```javascript
// PgBouncer configuration
const pool = new Pool({
  host: 'pgbouncer-host',
  port: 6432,
  database: 'ticketflow',
  max: 100,
  application_name: 'ticketflow-app'
});
```

## Troubleshooting

### Common Issues

1. **Database Connection Errors**:
```bash
# Check connection
psql $DATABASE_URL -c "SELECT version();"

# Check pool status
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
```

2. **AWS Service Errors**:
```bash
# Test SES connection
aws ses get-send-quota --region us-east-1

# Test Bedrock access
aws bedrock list-foundation-models --region us-east-1
```

3. **Memory Issues**:
```bash
# Monitor Node.js memory usage
node --inspect server/index.js

# Check for memory leaks
npm install -g clinic
clinic doctor -- node server/index.js
```

### Performance Monitoring

1. **Database Query Performance**:
```sql
-- Check slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Check index usage
SELECT schemaname, tablename, attname, n_distinct, correlation 
FROM pg_stats 
WHERE schemaname = 'public';
```

2. **Application Metrics**:
```javascript
// Custom metrics endpoint
app.get('/metrics', async (req, res) => {
  const metrics = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeConnections: getActiveConnectionCount(),
    taskProcessingQueue: getQueueLength(),
    aiRequestsPerHour: await getAIUsageMetrics()
  };
  
  res.json(metrics);
});
```

## Migration Guide

### Version Upgrades

1. **Database Migrations**:
```bash
# Backup before migration
pg_dump $DATABASE_URL > pre_migration_backup.sql

# Run migrations
npm run db:migrate

# Verify migration
npm run db:studio
```

2. **Zero-Downtime Deployment**:
```bash
# Blue-green deployment script
./deploy.sh --strategy=blue-green --health-check=true
```

### Data Migration

1. **Import Existing Data**:
```sql
-- Import users from CSV
COPY users(email, first_name, last_name, role) 
FROM '/path/to/users.csv' 
DELIMITER ',' CSV HEADER;

-- Import tasks from JSON
INSERT INTO tasks (title, description, category, status)
SELECT title, description, category, status
FROM json_populate_recordset(null::tasks, '[...]');
```

This deployment guide provides comprehensive instructions for deploying TicketFlow in various environments. Follow the security and monitoring recommendations for production deployments.