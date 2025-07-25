# Enterprise Security Implementation

## Overview

The TicketFlow helpdesk system now includes comprehensive enterprise-level security features that protect against common vulnerabilities and provide robust access control mechanisms.

## Security Components Implemented

### 1. JWT Authentication System (`server/security/jwt.ts`)
- **Purpose**: Provides stateless authentication for API endpoints
- **Features**:
  - Access tokens (7-day expiry)
  - Refresh tokens (30-day expiry)
  - Role-based payload structure
  - Secure token generation and verification
- **Integration**: Can work alongside existing session-based auth

### 2. Role-Based Access Control (`server/security/rbac.ts`)
- **Purpose**: Granular permission system based on user roles
- **Roles Implemented**:
  - **Customer**: Limited access to own tickets and published knowledge base
  - **Agent**: Extended ticket management and knowledge base creation
  - **Admin**: Full system access including user and system management
- **Permission System**:
  - Action-based permissions (create, read, update, delete, manage)
  - Resource-based permissions (ticket, knowledge, user, team, etc.)
  - Conditional permissions with ownership and assignment checks

### 3. Input Validation & Sanitization (`server/security/validation.ts`)
- **Purpose**: Prevent injection attacks and ensure data integrity
- **Features**:
  - Joi schema validation for all API endpoints
  - Express-validator rules for additional validation
  - XSS protection with DOMPurify sanitization
  - SQL injection prevention utilities
  - File upload validation with type and size limits
- **Validation Schemas**: Pre-built schemas for users, tickets, knowledge base, teams, and search

### 4. Rate Limiting (`server/security/rateLimiting.ts`)
- **Purpose**: Prevent abuse and DoS attacks
- **Rate Limits Implemented**:
  - General API: 100 requests/15 minutes
  - Authentication: 5 attempts/15 minutes
  - Password Reset: 3 attempts/hour
  - AI API: Role-based limits (20-200 requests/hour)
  - File Upload: Role-based limits (10-100 files/hour)
  - Search: Role-based limits (50-200 searches/5 minutes)
- **Features**: Account lockout after failed attempts, IPv6 support

### 5. AWS IAM Security (`server/security/awsIAM.ts`)
- **Purpose**: Secure AWS service integration with minimal permissions
- **Features**:
  - Minimal IAM policies for Bedrock and SES
  - Credential validation and rotation checks
  - CloudFormation templates for automated role creation
  - Separate configurations for different services
  - Security best practices and deployment instructions

### 6. Enhanced Authentication (`server/security/secureAuth.ts`)
- **Purpose**: Advanced authentication features beyond basic login/logout
- **Features**:
  - bcrypt password hashing (12 salt rounds)
  - Account lockout protection (5 failed attempts = 15-minute lockout)
  - Password complexity validation
  - Password reset with secure tokens
  - User approval system for new registrations
  - Comprehensive audit logging

### 7. Security Middleware (`server/security/middleware.ts`)
- **Purpose**: Route-level security controls for fine-grained access
- **Features**:
  - Enhanced authentication that works with existing session system
  - Ticket access control (customers see only own tickets)
  - Knowledge base access control (public read, authenticated write)
  - File upload access control with role-based size limits
  - Security audit logging for sensitive operations

### 8. Centralized Security Management (`server/security/index.ts`)
- **Purpose**: Unified security configuration and health monitoring
- **Features**:
  - Security middleware application
  - Health check endpoints
  - Security metrics collection
  - Audit logging functions
  - Environment-based configuration

## Security Headers & Protection

### Helmet Configuration
- Content Security Policy (CSP)
- Cross-Origin Resource Policy
- HTTP Strict Transport Security (HSTS)
- X-Frame-Options (clickjacking protection)
- X-Content-Type-Options (MIME sniffing protection)
- X-XSS-Protection

### Additional Security Headers
- Referrer Policy
- Permissions Policy
- Custom security headers for API responses

## Integration with Existing System

### Backward Compatibility
- The security system is designed to work alongside the existing Replit authentication
- Enhanced authentication middleware checks for existing sessions first
- JWT authentication serves as a fallback and extension mechanism
- No breaking changes to existing API endpoints

### Security Endpoints Added
- `GET /api/security/health` - Security system health check
- Enhanced validation on all existing endpoints
- Rate limiting applied to authentication endpoints

## Configuration & Environment Variables

### Required for Full Security
```bash
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# AWS Configuration (optional)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1

# Security Settings
RATE_LIMITING_ENABLED=true
INPUT_VALIDATION_ENABLED=true
CORS_ENABLED=true
```

### Development vs Production
- Development: Relaxed rate limits, optional AWS credentials
- Production: Strict rate limits, required AWS credentials, enhanced logging

## Security Audit & Monitoring

### Audit Logging
- Authentication events (login, logout, registration, password reset)
- Permission denied events
- Security-related API access
- Failed validation attempts
- Rate limit violations

### Metrics Collection
- Rate limit hits
- Authentication failures
- Permission denials
- Validation failures

### Health Checks
- JWT secret validation
- AWS credentials validation
- Rate limiting status
- Input validation status
- HTTPS enforcement (production)

## Usage Examples

### Protecting a New API Endpoint
```typescript
import { enhancedAuth, requireRole, validateSchema } from '../security/middleware';
import { validationSchemas } from '../security/validation';

// Protect endpoint with authentication and role requirement
app.post('/api/admin/settings', 
  enhancedAuth,
  requireRole('admin'),
  validateSchema(validationSchemas.adminSettings),
  (req, res) => {
    // Handler code
  }
);
```

### Adding Custom Validation
```typescript
import { validationSchemas } from '../security/validation';

// Extend existing schema
const customTicketSchema = validationSchemas.ticketCreation.extend({
  customField: Joi.string().max(100).optional()
});
```

### Checking Permissions in Code
```typescript
import { hasPermission } from '../security/rbac';

if (hasPermission(user.role, 'delete', 'ticket')) {
  // Allow deletion
} else {
  // Deny access
}
```

## Security Best Practices Implemented

1. **Principle of Least Privilege**: Users only get minimum necessary permissions
2. **Defense in Depth**: Multiple layers of security (authentication, authorization, validation, rate limiting)
3. **Secure by Default**: All endpoints protected unless explicitly made public
4. **Input Validation**: All user input validated and sanitized
5. **Rate Limiting**: Prevents abuse and DoS attacks
6. **Audit Logging**: Comprehensive logging for security events
7. **Password Security**: Strong hashing, complexity requirements, lockout protection
8. **Token Security**: Secure JWT implementation with refresh tokens
9. **AWS Security**: Minimal IAM permissions, credential validation
10. **Error Handling**: Secure error messages that don't leak sensitive information

## Testing & Validation

The security implementation has been thoroughly tested for:
- Authentication flows (login, logout, registration, password reset)
- Authorization controls (role-based access)
- Input validation (malicious input rejection)
- Rate limiting (abuse prevention)
- Security header effectiveness
- AWS credential validation

## Deployment Considerations

### Pre-Deployment Checklist
1. Update JWT_SECRET to a cryptographically secure value
2. Configure AWS credentials with minimal permissions
3. Enable HTTPS in production
4. Set up monitoring for security events
5. Configure rate limiting for production load
6. Test all authentication flows
7. Verify role-based access controls
8. Enable security audit logging

### Monitoring & Maintenance
1. Regularly rotate JWT secrets
2. Monitor authentication failure rates
3. Review rate limiting effectiveness
4. Update AWS credentials per rotation schedule
5. Monitor security audit logs
6. Keep security dependencies updated

## Future Enhancements

Potential security improvements for future iterations:
1. Two-factor authentication (2FA)
2. Single Sign-On (SSO) integration
3. Advanced threat detection
4. Security information and event management (SIEM) integration
5. API rate limiting based on user subscription tiers
6. Advanced session management with Redis
7. Certificate pinning for API clients
8. Advanced audit log analysis and alerting

---

This security implementation provides enterprise-grade protection while maintaining the existing system's functionality and user experience.