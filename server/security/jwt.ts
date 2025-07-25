import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

export interface JWTPayload {
  userId: string;
  email: string;
  role: 'customer' | 'agent' | 'admin';
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

// Generate JWT token
export const generateTokens = (payload: Omit<JWTPayload, 'iat' | 'exp'>) => {
  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'ticketflow-helpdesk',
    audience: 'ticketflow-users'
  });

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_SECRET,
    {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
      issuer: 'ticketflow-helpdesk',
      audience: 'ticketflow-users'
    }
  );

  return { accessToken, refreshToken };
};

// Verify JWT token
export const verifyToken = (token: string): JWTPayload => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'ticketflow-helpdesk',
      audience: 'ticketflow-users'
    }) as JWTPayload;
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

// JWT Authentication middleware
export const authenticateJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access denied', 
      message: 'No token provided' 
    });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ 
      error: 'Invalid token', 
      message: error instanceof Error ? error.message : 'Token verification failed' 
    });
  }
};

// Optional JWT authentication (for public routes with optional auth)
export const optionalJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyToken(token);
      req.user = decoded;
    } catch (error) {
      // Continue without authentication for optional routes
    }
  }
  next();
};

// Refresh token endpoint
export const refreshAccessToken = (refreshToken: string) => {
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as JWTPayload & { type?: string };
    
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid refresh token');
    }

    // Generate new access token
    const newPayload = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };

    return generateTokens(newPayload);
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
};

// Blacklist for revoked tokens (in production, use Redis)
const tokenBlacklist = new Set<string>();

export const revokeToken = (token: string) => {
  tokenBlacklist.add(token);
};

export const isTokenRevoked = (token: string): boolean => {
  return tokenBlacklist.has(token);
};

// Enhanced JWT middleware with blacklist check
export const authenticateJWTWithBlacklist = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access denied', 
      message: 'No token provided' 
    });
  }

  if (isTokenRevoked(token)) {
    return res.status(403).json({ 
      error: 'Token revoked', 
      message: 'This token has been revoked' 
    });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ 
      error: 'Invalid token', 
      message: error instanceof Error ? error.message : 'Token verification failed' 
    });
  }
};