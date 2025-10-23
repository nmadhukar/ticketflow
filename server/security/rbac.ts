import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './jwt';

export type UserRole = 'customer' | 'agent' | 'admin';

export interface Permission {
  action: string;
  resource: string;
  conditions?: Record<string, any>;
}

// Define base permissions first
const customerPermissions: Permission[] = [
  // Ticket management - customers can only manage their own tickets
  { action: 'create', resource: 'ticket' },
  { action: 'read', resource: 'ticket', conditions: { ownTicketsOnly: true } },
  { action: 'update', resource: 'ticket', conditions: { ownTicketsOnly: true, limitedFields: ['title', 'description'] } },
  { action: 'comment', resource: 'ticket', conditions: { ownTicketsOnly: true } },
  
  // Knowledge base - read only access to published articles
  { action: 'read', resource: 'knowledge', conditions: { publishedOnly: true } },
  { action: 'search', resource: 'knowledge' },
  
  // Profile management
  { action: 'read', resource: 'profile', conditions: { ownProfileOnly: true } },
  { action: 'update', resource: 'profile', conditions: { ownProfileOnly: true } },
  
  // Feedback
  { action: 'create', resource: 'feedback' },
  { action: 'read', resource: 'feedback', conditions: { ownFeedbackOnly: true } }
];

const agentPermissions: Permission[] = [
  // All customer permissions
  ...customerPermissions,
  
  // Extended ticket management
  { action: 'read', resource: 'ticket' },
  { action: 'update', resource: 'ticket', conditions: { assignedTicketsOnly: true } },
  { action: 'assign', resource: 'ticket', conditions: { toSelfOrTeam: true } },
  { action: 'resolve', resource: 'ticket' },
  { action: 'comment', resource: 'ticket' },
  
  // Knowledge base management
  { action: 'create', resource: 'knowledge' },
  { action: 'update', resource: 'knowledge', conditions: { draftOrOwned: true } },
  
  // Team access
  { action: 'read', resource: 'team', conditions: { memberTeamsOnly: true } },
  
  // Basic analytics
  { action: 'read', resource: 'analytics', conditions: { personalMetrics: true } }
];

const adminPermissions: Permission[] = [
  // Full system access
  { action: '*', resource: '*' },
  
  // Explicit admin-only permissions
  { action: 'manage', resource: 'users' },
  { action: 'manage', resource: 'teams' },
  { action: 'manage', resource: 'system-settings' },
  { action: 'manage', resource: 'ai-settings' },
  { action: 'read', resource: 'audit-logs' },
  { action: 'manage', resource: 'permissions' }
];

// Role-based permissions configuration
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  customer: customerPermissions,
  agent: agentPermissions,
  admin: adminPermissions
};

// Check if user has permission
export const hasPermission = (
  userRole: UserRole,
  action: string,
  resource: string,
  context?: Record<string, any>
): boolean => {
  const rolePermissions = ROLE_PERMISSIONS[userRole];
  
  // Check for wildcard admin permissions
  if (rolePermissions.some(p => p.action === '*' && p.resource === '*')) {
    return true;
  }
  
  // Find matching permission
  const permission = rolePermissions.find(p => 
    (p.action === action || p.action === '*') && 
    (p.resource === resource || p.resource === '*')
  );
  
  if (!permission) {
    return false;
  }
  
  // Check conditions if present
  if (permission.conditions && context) {
    return checkConditions(permission.conditions, context, userRole);
  }
  
  return true;
};

// Check permission conditions
const checkConditions = (
  conditions: Record<string, any>,
  context: Record<string, any>,
  userRole: UserRole
): boolean => {
  // Own tickets only
  if (conditions.ownTicketsOnly) {
    return context.ticketOwnerId === context.userId;
  }
  
  // Assigned tickets only (for agents)
  if (conditions.assignedTicketsOnly) {
    return context.ticketAssigneeId === context.userId || 
           context.ticketTeamId && context.userTeamIds?.includes(context.ticketTeamId);
  }
  
  // Published knowledge articles only
  if (conditions.publishedOnly) {
    return context.articleStatus === 'published';
  }
  
  // Limited fields only (for updates); reject if body contains fields outside allowed list
  if (Array.isArray(conditions.limitedFields)) {
    const updateFields: string[] = Array.isArray((context as any).updateFields)
      ? (context as any).updateFields
      : [];
    if (updateFields.length > 0) {
      const hasDisallowed = updateFields.some(
        (field) => !conditions.limitedFields.includes(field)
      );
      if (hasDisallowed) return false;
    }
  }

  // Assign only to self or to a team the user belongs to
  if (conditions.toSelfOrTeam) {
    const desiredAssigneeType = (context as any).assigneeType;
    const desiredAssigneeId = (context as any).assigneeId;
    const desiredAssigneeTeamId = (context as any).assigneeTeamId;

    if (desiredAssigneeType === 'user' && desiredAssigneeId === (context as any).userId) {
      return true;
    }
    if (
      desiredAssigneeType === 'team' &&
      Array.isArray((context as any).userTeamIds) &&
      (context as any).userTeamIds.includes(desiredAssigneeTeamId)
    ) {
      return true;
    }
    return false;
  }

  // Own profile only
  if (conditions.ownProfileOnly) {
    return context.profileUserId === context.userId;
  }
  
  // Own feedback only
  if (conditions.ownFeedbackOnly) {
    return context.feedbackUserId === context.userId;
  }
  
  // Draft or owned articles
  if (conditions.draftOrOwned) {
    return context.articleStatus === 'draft' || context.articleCreatedBy === context.userId;
  }
  
  // Member teams only
  if (conditions.memberTeamsOnly) {
    return context.userTeamIds?.includes(context.teamId);
  }
  
  // Personal metrics only
  if (conditions.personalMetrics) {
    return context.metricsUserId === context.userId;
  }
  
  return true;
};

// RBAC middleware factory
export const requirePermission = (action: string, resource: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'User not authenticated' 
      });
    }
    
    const context = {
      userId: req.user.userId,
      updateFields: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
      ...req.body,
      ...req.params,
      ...req.query
    };
    
    if (!hasPermission(req.user.role, action, resource, context)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `Access denied: ${action} on ${resource}` 
      });
    }
    
    next();
  };
};

// Role-based middleware
export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'User not authenticated' 
      });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient role',
        message: `Access denied: requires one of [${allowedRoles.join(', ')}]` 
      });
    }
    
    next();
  };
};

// Admin-only middleware
export const requireAdmin = requireRole('admin');

// Agent or admin middleware
export const requireAgentOrAdmin = requireRole('agent', 'admin');

// Any authenticated user
export const requireAuthenticated = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'User not authenticated' 
    });
  }
  next();
};

// Resource ownership check
export const requireOwnership = (resourceIdParam: string = 'id') => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }
    
    // Admins can access everything
    if (req.user.role === 'admin') {
      return next();
    }
    
    const resourceId = req.params[resourceIdParam];
    
    // For customers, additional ownership checks would be implemented here
    // This would typically involve database queries to verify ownership
    
    next();
  };
};

// Dynamic permission check with database context
export const checkResourcePermission = (
  action: string,
  resource: string,
  getContextFn?: (req: AuthenticatedRequest) => Promise<Record<string, any>>
) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }
    
    let context = {
      userId: req.user.userId,
      userRole: req.user.role,
      ...req.params,
      ...req.query
    };
    
    // Get additional context if function provided
    if (getContextFn) {
      try {
        const additionalContext = await getContextFn(req);
        context = { ...context, ...additionalContext };
      } catch (error) {
        return res.status(500).json({ 
          error: 'Failed to check permissions',
          message: 'Could not retrieve resource context' 
        });
      }
    }
    
    if (!hasPermission(req.user.role, action, resource, context)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `Access denied: ${action} on ${resource}` 
      });
    }
    
    next();
  };
};

// Activity logging for security audit
export const logSecurityEvent = (
  req: AuthenticatedRequest,
  action: string,
  resource: string,
  success: boolean,
  details?: any
) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    userId: req.user?.userId || 'anonymous',
    userRole: req.user?.role || 'none',
    action,
    resource,
    success,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    details
  };
  
  // In production, send to audit log service
  console.log('SECURITY_AUDIT:', JSON.stringify(logEntry));
};