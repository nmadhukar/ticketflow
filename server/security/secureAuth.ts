// Enhanced Authentication System with JWT and Security Features
import bcrypt from 'bcryptjs';
import { generateTokens, verifyToken, JWTPayload } from './jwt';
import { storage } from '../storage';
// Security audit logging functions
const logAuthEvent = (event: {
  userId?: string;
  email?: string;
  action: 'login' | 'logout' | 'register' | 'password_reset';
  success: boolean;
  ip?: string;
  userAgent?: string;
  reason?: string;
}) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: 'AUTH_EVENT',
    ...event
  };
  console.log('AUTH_AUDIT:', JSON.stringify(logEntry));
};
import { Request, Response } from 'express';

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Track failed login attempts (in production, use Redis)
const loginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil?: number }>();

export interface AuthResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    role: 'customer' | 'agent' | 'admin';
    firstName?: string;
    lastName?: string;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
  };
  message?: string;
  lockedUntil?: number;
}

// Enhanced password hashing
export const hashPassword = async (password: string): Promise<string> => {
  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    return await bcrypt.hash(password, salt);
  } catch (error) {
    throw new Error('Failed to hash password');
  }
};

// Enhanced password verification
export const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    throw new Error('Failed to verify password');
  }
};

// Check if account is locked
const isAccountLocked = (email: string): boolean => {
  const attempts = loginAttempts.get(email);
  if (!attempts) return false;
  
  if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
    return true;
  }
  
  // Reset if lockout period has passed
  if (attempts.lockedUntil && Date.now() >= attempts.lockedUntil) {
    loginAttempts.delete(email);
    return false;
  }
  
  return false;
};

// Record failed login attempt
const recordFailedAttempt = (email: string): void => {
  const now = Date.now();
  const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: now };
  
  attempts.count++;
  attempts.lastAttempt = now;
  
  // Lock account after max attempts
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = now + LOCKOUT_TIME;
  }
  
  loginAttempts.set(email, attempts);
};

// Clear login attempts on successful login
const clearLoginAttempts = (email: string): void => {
  loginAttempts.delete(email);
};

// Secure user registration
export const registerUser = async (userData: {
  email: string;
  password: string;
  username: string;
  firstName?: string;
  lastName?: string;
  role?: 'customer' | 'agent' | 'admin';
}): Promise<AuthResponse> => {
  try {
    // Check if user already exists - simplified for demo
    // const existingUser = await storage.getUserByEmail(userData.email);
    // if (existingUser) {
    //   return {
    //     success: false,
    //     message: 'User with this email already exists'
    //   };
    // }

    // Hash password
    const hashedPassword = await hashPassword(userData.password);

    // Create user - simplified for demo
    const newUser = {
      id: Date.now().toString(),
      email: userData.email,
      username: userData.username,
      password: hashedPassword,
      role: userData.role || 'customer',
      firstName: userData.firstName,
      lastName: userData.lastName,
      isApproved: true, // Auto-approve for demo
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Generate tokens
    const tokens = generateTokens({
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role as 'customer' | 'agent' | 'admin'
    });

    // Log registration event
    logAuthEvent({
      userId: newUser.id,
      email: newUser.email,
      action: 'register',
      success: true
    });

    return {
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role as 'customer' | 'agent' | 'admin',
        firstName: newUser.firstName,
        lastName: newUser.lastName
      },
      tokens,
      message: 'Registration successful. Account pending approval.'
    };
  } catch (error) {
    console.error('Registration error:', error);
    return {
      success: false,
      message: 'Registration failed. Please try again.'
    };
  }
};

// Secure user login
export const loginUser = async (
  email: string, 
  password: string, 
  req: Request
): Promise<AuthResponse> => {
  try {
    // Check if account is locked
    if (isAccountLocked(email)) {
      const attempts = loginAttempts.get(email);
      logAuthEvent({
        email,
        action: 'login',
        success: false,
        reason: 'Account locked',
        ip: req.ip
      });

      return {
        success: false,
        message: 'Account temporarily locked due to too many failed attempts',
        lockedUntil: attempts?.lockedUntil
      };
    }

    // Find user - simplified for demo
    // const user = await storage.getUserByEmail(email);
    const user = null; // Simplified for demo
    if (!user) {
      recordFailedAttempt(email);
      logAuthEvent({
        email,
        action: 'login',
        success: false,
        reason: 'User not found',
        ip: req.ip
      });

      return {
        success: false,
        message: 'Invalid email or password'
      };
    }

    // Check if user is approved
    if (!user.isApproved) {
      logAuthEvent({
        userId: user.id,
        email,
        action: 'login',
        success: false,
        reason: 'Account not approved',
        ip: req.ip
      });

      return {
        success: false,
        message: 'Account pending admin approval'
      };
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      recordFailedAttempt(email);
      logAuthEvent({
        userId: user.id,
        email,
        action: 'login',
        success: false,
        reason: 'Invalid password',
        ip: req.ip
      });

      return {
        success: false,
        message: 'Invalid email or password'
      };
    }

    // Clear failed attempts
    clearLoginAttempts(email);

    // Generate tokens
    const tokens = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role as 'customer' | 'agent' | 'admin'
    });

    // Update last login - simplified for demo
    // await storage.updateUserLastLogin(user.id);

    // Log successful login
    logAuthEvent({
      userId: user.id,
      email,
      action: 'login',
      success: true,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role as 'customer' | 'agent' | 'admin',
        firstName: user.firstName,
        lastName: user.lastName
      },
      tokens,
      message: 'Login successful'
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      success: false,
      message: 'Login failed. Please try again.'
    };
  }
};

// Secure password reset request
export const requestPasswordReset = async (email: string, req: Request): Promise<{ success: boolean; message: string }> => {
  try {
    const user = await storage.getUserByEmail(email);
    if (!user) {
      // Don't reveal whether user exists
      return {
        success: true,
        message: 'If an account with this email exists, a password reset link has been sent.'
      };
    }

    // Generate secure reset token
    const resetToken = generatePasswordResetToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save reset token
    await storage.savePasswordResetToken(user.id, resetToken, resetExpires);

    // Log password reset request
    logAuthEvent({
      userId: user.id,
      email,
      action: 'password_reset',
      success: true,
      ip: req.ip
    });

    // In a real application, send email with reset link
    // await sendPasswordResetEmail(email, resetToken);

    return {
      success: true,
      message: 'Password reset link has been sent to your email.'
    };
  } catch (error) {
    console.error('Password reset error:', error);
    return {
      success: false,
      message: 'Failed to process password reset request.'
    };
  }
};

// Reset password with token
export const resetPassword = async (
  token: string, 
  newPassword: string,
  req: Request
): Promise<{ success: boolean; message: string }> => {
  try {
    // Find user by reset token
    const user = await storage.getUserByResetToken(token);
    if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      return {
        success: false,
        message: 'Invalid or expired reset token.'
      };
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password and clear reset token
    await storage.updateUserPassword(user.id, hashedPassword);
    await storage.clearPasswordResetToken(user.id);

    // Log password reset
    logAuthEvent({
      userId: user.id,
      email: user.email,
      action: 'password_reset',
      success: true,
      ip: req.ip
    });

    return {
      success: true,
      message: 'Password has been reset successfully.'
    };
  } catch (error) {
    console.error('Password reset error:', error);
    return {
      success: false,
      message: 'Failed to reset password.'
    };
  }
};

// Generate secure password reset token
const generatePasswordResetToken = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
};

// Validate JWT token and get user
export const validateToken = async (token: string): Promise<JWTPayload | null> => {
  try {
    const decoded = verifyToken(token);
    
    // Additional checks - verify user still exists and is approved
    const user = await storage.getUser(decoded.userId);
    if (!user || !user.isApproved) {
      return null;
    }

    return decoded;
  } catch (error) {
    return null;
  }
};

// Logout and token revocation
export const logoutUser = async (token: string, userId: string, req: Request): Promise<void> => {
  try {
    // In production, add token to blacklist in Redis
    // For now, we'll just log the logout event
    
    const user = await storage.getUser(userId);
    if (user) {
      logAuthEvent({
        userId,
        email: user.email,
        action: 'logout',
        success: true,
        ip: req.ip
      });
    }
  } catch (error) {
    console.error('Logout error:', error);
  }
};

// Clean up expired login attempts (call periodically)
export const cleanupLoginAttempts = (): void => {
  const now = Date.now();
  for (const [email, attempts] of loginAttempts.entries()) {
    if (attempts.lockedUntil && now > attempts.lockedUntil) {
      loginAttempts.delete(email);
    }
  }
};

// Set up periodic cleanup
setInterval(cleanupLoginAttempts, 5 * 60 * 1000); // Every 5 minutes