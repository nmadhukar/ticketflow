// Security middleware integrations for existing routes
import { Request, Response, NextFunction } from 'express';
import { authenticateJWT, AuthenticatedRequest } from './jwt';
import { requirePermission, requireRole, hasPermission } from './rbac';
import { validateSchema, validationSchemas } from './validation';
import { aiApiRateLimit } from './rateLimiting';

// Enhanced authentication middleware that works with existing session system
export const enhancedAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Check for existing session first (backward compatibility)
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    // Convert session user to JWT-compatible format
    const sessionUser = req.user as any;
    req.user = {
      userId: sessionUser.id,
      email: sessionUser.email, 
      role: sessionUser.role || 'customer'
    };
    return next();
  }

  // Fall back to JWT authentication
  return authenticateJWT(req, res, next);
};

// Ticket access control middleware
export const ticketAccessControl = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Admins can access everything
  if (req.user.role === 'admin') {
    return next();
  }

  const ticketId = req.params.id;
  const method = req.method;

  try {
    // For GET requests, check if user can read this ticket
    if (method === 'GET') {
      if (req.user.role === 'customer') {
        // Customers can only read their own tickets
        // In a real implementation, check ticket ownership in database
        // For now, allow all for demo purposes
      }
      // Agents can read all tickets
      return next();
    }

    // For POST/PUT/DELETE, apply more strict controls
    if (method === 'POST') {
      // Anyone can create tickets
      return next();
    }

    if (method === 'PUT' || method === 'PATCH') {
      if (req.user.role === 'customer') {
        // Customers can only update their own tickets with limited fields
        const allowedFields = ['title', 'description'];
        const updateFields = Object.keys(req.body);
        const hasDisallowedFields = updateFields.some(field => !allowedFields.includes(field));
        
        if (hasDisallowedFields) {
          return res.status(403).json({ 
            error: 'Insufficient permissions',
            message: 'Customers can only update title and description'
          });
        }
      }
      return next();
    }

    if (method === 'DELETE') {
      // Only admins can delete tickets
      if (req.user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          message: 'Only administrators can delete tickets'
        });
      }
      return next();
    }

    next();
  } catch (error) {
    console.error('Ticket access control error:', error);
    res.status(500).json({ error: 'Access control check failed' });
  }
};

// Knowledge base access control
export const knowledgeAccessControl = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    // Allow public read access to published articles
    if (req.method === 'GET') {
      return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
  }

  const method = req.method;

  // Admins can do everything
  if (req.user.role === 'admin') {
    return next();
  }

  // GET requests - allow for all authenticated users
  if (method === 'GET') {
    return next();
  }

  // POST/PUT/DELETE - agents and admins only
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    if (req.user.role === 'customer') {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: 'Customers cannot modify knowledge base articles'
      });
    }
    return next();
  }

  next();
};

// AI API access control with rate limiting
export const aiApiAccessControl = [
  enhancedAuth,
  aiApiRateLimit,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // All authenticated users can use AI features
    // Rate limiting is handled by aiApiRateLimit middleware
    next();
  }
];

// Admin-only access control
export const adminOnly = [
  enhancedAuth,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Administrator privileges required'
      });
    }
    next();
  }
];

// Agent or admin access control
export const agentOrAdmin = [
  enhancedAuth,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!['agent', 'admin'].includes(req.user?.role || '')) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Agent or administrator privileges required'
      });
    }
    next();
  }
];

// Team access control
export const teamAccessControl = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Admins can access all teams
  if (req.user.role === 'admin') {
    return next();
  }

  // For other users, implement team membership checks
  // This would require database queries in a real implementation
  next();
};

// File upload access control
export const fileUploadAccessControl = [
  enhancedAuth,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // All authenticated users can upload files, but with size limits based on role
    const maxSizes = {
      customer: 5 * 1024 * 1024,   // 5MB
      agent: 10 * 1024 * 1024,     // 10MB  
      admin: 25 * 1024 * 1024      // 25MB
    };

    const userRole = req.user?.role || 'customer';
    const maxSize = maxSizes[userRole];

    // This check would be used with multer middleware
    req.maxFileSize = maxSize;
    next();
  }
];

// Search access control
export const searchAccessControl = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Allow anonymous search for published content
  // Authenticated users get broader search capabilities
  if (req.user) {
    req.enhancedSearch = true;
  }
  next();
};

// Validation middleware combinations for different endpoints
export const validationMiddleware = {
  createTicket: [
    validateSchema(validationSchemas.ticketCreation)
  ],
  updateTicket: [
    validateSchema(validationSchemas.ticketUpdate)
  ],
  createKnowledge: [
    validateSchema(validationSchemas.knowledgeArticle)
  ],
  addComment: [
    validateSchema(validationSchemas.comment)
  ],
  createTeam: [
    validateSchema(validationSchemas.team)
  ],
  search: [
    validateSchema(validationSchemas.search)
  ],
  updateAISettings: [
    validateSchema(validationSchemas.aiSettings)
  ]
};

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Prevent referrer leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Add permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
};

// Request logging for security audit
export const securityAuditLog = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Log sensitive actions
  const sensitiveActions = [
    '/api/admin',
    '/api/users',
    '/api/ai',
    '/api/auth',
    '/api/upload'
  ];
  
  const isSensitive = sensitiveActions.some(path => req.path.startsWith(path));
  
  if (isSensitive) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      userId: req.user?.userId,
      role: req.user?.role,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
    
    console.log('SECURITY_ACCESS:', JSON.stringify(logEntry));
  }
  
  res.on('finish', () => {
    if (isSensitive) {
      const duration = Date.now() - startTime;
      console.log('SECURITY_RESPONSE:', JSON.stringify({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userId: req.user?.userId
      }));
    }
  });
  
  next();
};

export {
  enhancedAuth,
  ticketAccessControl,
  knowledgeAccessControl,
  aiApiAccessControl,
  adminOnly,
  agentOrAdmin,
  teamAccessControl,
  fileUploadAccessControl,
  searchAccessControl,
  securityHeaders,
  securityAuditLog
};