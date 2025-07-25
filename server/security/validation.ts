import Joi from 'joi';
import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import DOMPurify from 'isomorphic-dompurify';

// Custom sanitizer for text content
export const sanitizeText = (text: string): string => {
  if (typeof text !== 'string') return '';
  
  // Remove script tags and dangerous HTML
  const cleaned = DOMPurify.sanitize(text, { 
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: []
  });
  
  // Trim whitespace
  return cleaned.trim();
};

// Input validation schemas using Joi
export const validationSchemas = {
  // User registration/login
  userRegistration: Joi.object({
    username: Joi.string()
      .alphanum()
      .min(3)
      .max(30)
      .required()
      .messages({
        'string.alphanum': 'Username must contain only alphanumeric characters',
        'string.min': 'Username must be at least 3 characters long',
        'string.max': 'Username cannot exceed 30 characters'
      }),
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address'
      }),
    password: Joi.string()
      .min(8)
      .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\\$%\\^&\\*])'))
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
      }),
    firstName: Joi.string().max(50).optional(),
    lastName: Joi.string().max(50).optional(),
    role: Joi.string().valid('customer', 'agent', 'admin').default('customer')
  }),

  userLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  // Ticket creation/update
  ticketCreation: Joi.object({
    title: Joi.string()
      .min(5)
      .max(200)
      .required()
      .messages({
        'string.min': 'Title must be at least 5 characters long',
        'string.max': 'Title cannot exceed 200 characters'
      }),
    description: Joi.string()
      .min(10)
      .max(5000)
      .required()
      .messages({
        'string.min': 'Description must be at least 10 characters long',
        'string.max': 'Description cannot exceed 5000 characters'
      }),
    category: Joi.string()
      .valid('bug', 'feature', 'support', 'enhancement', 'incident', 'request')
      .required(),
    priority: Joi.string()
      .valid('low', 'medium', 'high', 'urgent')
      .default('medium'),
    severity: Joi.string()
      .valid('minor', 'normal', 'major', 'critical')
      .default('normal'),
    tags: Joi.array()
      .items(Joi.string().max(50))
      .max(10)
      .optional(),
    assignedUserId: Joi.string().optional(),
    assignedTeamId: Joi.number().integer().positive().optional(),
    estimatedHours: Joi.number().min(0).max(1000).optional()
  }),

  ticketUpdate: Joi.object({
    title: Joi.string().min(5).max(200).optional(),
    description: Joi.string().min(10).max(5000).optional(),
    status: Joi.string()
      .valid('open', 'in_progress', 'resolved', 'closed', 'on_hold')
      .optional(),
    priority: Joi.string()
      .valid('low', 'medium', 'high', 'urgent')
      .optional(),
    severity: Joi.string()
      .valid('minor', 'normal', 'major', 'critical')
      .optional(),
    assignedUserId: Joi.string().allow(null).optional(),
    assignedTeamId: Joi.number().integer().positive().allow(null).optional(),
    resolution: Joi.string().max(2000).optional(),
    actualHours: Joi.number().min(0).max(1000).optional()
  }),

  // Knowledge base articles
  knowledgeArticle: Joi.object({
    title: Joi.string()
      .min(5)
      .max(200)
      .required(),
    summary: Joi.string()
      .min(10)
      .max(500)
      .required(),
    content: Joi.string()
      .min(50)
      .max(10000)
      .required(),
    category: Joi.string()
      .valid('general', 'technical', 'troubleshooting', 'howto', 'faq')
      .required(),
    tags: Joi.array()
      .items(Joi.string().max(50))
      .max(15)
      .optional(),
    status: Joi.string()
      .valid('draft', 'published', 'archived')
      .default('draft')
  }),

  // Comments
  comment: Joi.object({
    content: Joi.string()
      .min(1)
      .max(2000)
      .required()
      .messages({
        'string.min': 'Comment cannot be empty',
        'string.max': 'Comment cannot exceed 2000 characters'
      }),
    isPrivate: Joi.boolean().default(false)
  }),

  // Team management
  team: Joi.object({
    name: Joi.string()
      .min(2)
      .max(100)
      .required(),
    description: Joi.string()
      .max(500)
      .optional(),
    managerId: Joi.string().optional()
  }),

  // Search queries
  search: Joi.object({
    query: Joi.string()
      .min(1)
      .max(200)
      .required(),
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(10),
    offset: Joi.number()
      .integer()
      .min(0)
      .default(0)
  }),

  // AI settings
  aiSettings: Joi.object({
    confidenceThreshold: Joi.number()
      .min(0)
      .max(1)
      .required(),
    autoResponseEnabled: Joi.boolean().required(),
    escalationThreshold: Joi.number()
      .min(0)
      .max(100)
      .required(),
    learningEnabled: Joi.boolean().required()
  })
};

// Joi validation middleware factory
export const validateSchema = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Replace request body with validated and sanitized data
    req.body = value;
    next();
  };
};

// Express-validator rules for specific endpoints
export const userValidationRules = () => {
  return [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/)
      .withMessage('Password must contain at least one lowercase letter, uppercase letter, number, and special character'),
    body('username')
      .isAlphanumeric()
      .isLength({ min: 3, max: 30 })
      .withMessage('Username must be 3-30 alphanumeric characters'),
    body('firstName')
      .optional()
      .isLength({ max: 50 })
      .trim()
      .escape(),
    body('lastName')
      .optional()
      .isLength({ max: 50 })
      .trim()
      .escape()
  ];
};

export const ticketValidationRules = () => {
  return [
    body('title')
      .isLength({ min: 5, max: 200 })
      .withMessage('Title must be between 5 and 200 characters')
      .trim()
      .escape(),
    body('description')
      .isLength({ min: 10, max: 5000 })
      .withMessage('Description must be between 10 and 5000 characters')
      .trim(),
    body('category')
      .isIn(['bug', 'feature', 'support', 'enhancement', 'incident', 'request'])
      .withMessage('Invalid category'),
    body('priority')
      .optional()
      .isIn(['low', 'medium', 'high', 'urgent'])
      .withMessage('Invalid priority'),
    body('severity')
      .optional()
      .isIn(['minor', 'normal', 'major', 'critical'])
      .withMessage('Invalid severity')
  ];
};

export const knowledgeValidationRules = () => {
  return [
    body('title')
      .isLength({ min: 5, max: 200 })
      .withMessage('Title must be between 5 and 200 characters')
      .trim()
      .escape(),
    body('summary')
      .isLength({ min: 10, max: 500 })
      .withMessage('Summary must be between 10 and 500 characters')
      .trim(),
    body('content')
      .isLength({ min: 50, max: 10000 })
      .withMessage('Content must be between 50 and 10000 characters')
      .trim(),
    body('category')
      .isIn(['general', 'technical', 'troubleshooting', 'howto', 'faq'])
      .withMessage('Invalid category')
  ];
};

export const searchValidationRules = () => {
  return [
    query('query')
      .isLength({ min: 1, max: 200 })
      .withMessage('Search query must be between 1 and 200 characters')
      .trim()
      .escape(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
  ];
};

export const paramValidationRules = () => {
  return [
    param('id')
      .isInt({ min: 1 })
      .withMessage('ID must be a positive integer'),
    param('userId')
      .isLength({ min: 1, max: 50 })
      .withMessage('User ID is required and must be valid')
  ];
};

// Check validation results middleware
export const checkValidationResult = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(error => ({
        field: error.type === 'field' ? error.path : 'unknown',
        message: error.msg
      }))
    });
  }
  next();
};

// Sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Sanitize string fields in request body
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        req.body[key] = sanitizeText(value);
      }
    }
  }
  
  // Sanitize query parameters
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        req.query[key] = sanitizeText(value);
      }
    }
  }
  
  next();
};

// File upload validation
export const validateFileUpload = (allowedTypes: string[], maxSize: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    // Check file type
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: `Allowed types: ${allowedTypes.join(', ')}`
      });
    }

    // Check file size
    if (req.file.size > maxSize) {
      return res.status(400).json({
        error: 'File too large',
        message: `Maximum size: ${maxSize / 1024 / 1024}MB`
      });
    }

    next();
  };
};

// SQL injection prevention for raw queries
export const sanitizeForSQL = (input: string): string => {
  if (typeof input !== 'string') return '';
  
  // Remove or escape potentially dangerous characters
  return input
    .replace(/'/g, "''")  // Escape single quotes
    .replace(/;/g, '')    // Remove semicolons
    .replace(/--/g, '')   // Remove SQL comments
    .replace(/\/\*/g, '') // Remove SQL block comments start
    .replace(/\*\//g, '') // Remove SQL block comments end
    .trim();
};

// XSS prevention middleware
export const preventXSS = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' https://fonts.gstatic.com"
  );
  next();
};