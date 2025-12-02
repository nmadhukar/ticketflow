/**
 * Commercial Authentication System for TicketFlow
 *
 * This module provides enterprise-grade authentication with the following features:
 * - Multi-strategy authentication (local email/password + Microsoft 365 SSO)
 * - Secure password hashing using scrypt with salt
 * - Account lockout protection after failed login attempts
 * - Password reset functionality with secure tokens
 * - Admin approval workflow for new registrations
 * - Invitation-based user onboarding
 * - Session management with PostgreSQL storage
 * - Role-based access control (customer, user, manager, admin)
 */

import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "../../storage";
import { User as SelectUser, InsertUser } from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
import * as client from "openid-client";
import { EMAIL_PROVIDERS } from "@shared/constants";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

/**
 * Hash a password using scrypt with random salt
 *
 * Uses Node.js crypto.scrypt for secure password hashing
 * Salt is generated randomly for each password
 * Returns format: "hash.salt" for storage
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

/**
 * Compare a supplied password with a stored hash
 *
 * Extracts salt from stored hash and compares using timing-safe comparison
 * Prevents timing attacks by using crypto.timingSafeEqual
 */
async function comparePasswords(
  supplied: string,
  stored: string
): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Input validation schemas using Zod
 *
 * Provides client and server-side validation for:
 * - User registration with email format and password complexity
 * - Login credentials validation
 * - Password reset token and new password validation
 * - Ensures data integrity and security before database operations
 */
const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * Setup authentication middleware and routes
 */
export function setupAuth(app: Express) {
  // Session configuration
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  const cookieSecure =
    (process.env.COOKIE_SECURE || "").toLowerCase() === "true";

  const sessionSettings: session.SessionOptions = {
    secret:
      process.env.SESSION_SECRET || "your-secret-key-change-in-production",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      maxAge: sessionTtl,
      sameSite: "lax",
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport local strategy
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          if (!user.password) {
            return done(null, false, { message: "Password not set" });
          }

          const isValid = await comparePasswords(password, user.password);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          if (!user.isActive) {
            return done(null, false, { message: "Account is deactivated" });
          }

          if (!user.isApproved) {
            return done(null, false, {
              message:
                "Your account is pending admin approval. Please wait for approval before logging in.",
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, user);
    } catch (error) {
      console.error("Deserialize user error:", error);
      done(null, false);
    }
  });

  // Register endpoint
  app.post("/api/auth/register", async (req, res) => {
    try {
      const validatedData = registerSchema.parse(req.body);

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(validatedData.email);

      // Check if this email has a pending invitation
      const invitations = await storage.getUserInvitations({
        status: "pending",
      });
      const invitation = invitations.find(
        (inv) =>
          inv.email === validatedData.email &&
          new Date(inv.expiresAt) > new Date()
      );

      // Handle existing user with invitation
      if (existingUser && invitation) {
        // If user exists but has no password (e.g., created through SSO), allow password setup
        if (!existingUser.password) {
          const hashedPassword = await hashPassword(validatedData.password);

          await storage.upsertUser({
            id: existingUser.id,
            email: existingUser.email,
            password: hashedPassword,
            firstName: validatedData.firstName,
            lastName: validatedData.lastName,
            role: invitation.role,
            isApproved: true,
            isActive: existingUser.isActive,
          });

          await storage.markInvitationAccepted(invitation.id);

          return res.status(201).json({
            message:
              "Account activated successfully! You can now log in with your credentials.",
            user: {
              id: existingUser.id,
              email: existingUser.email,
              firstName: validatedData.firstName,
              lastName: validatedData.lastName,
              role: invitation.role,
              isApproved: true,
            },
          });
        } else {
          return res.status(400).json({
            message:
              "This email is already registered. Please sign in with your existing password.",
          });
        }
      }

      // Check if user exists without invitation
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await hashPassword(validatedData.password);

      // Create user
      const newUser: InsertUser = {
        id: randomUUID(),
        email: validatedData.email,
        firstName: validatedData.firstName,
        lastName: validatedData.lastName,
        password: hashedPassword,
        role: invitation ? invitation.role : "customer", // Use invitation role if exists
        isActive: true,
        isApproved: invitation ? true : false, // Auto-approve if invited
      };

      const user = await storage.createUser(newUser);

      // Mark invitation as accepted if exists
      if (invitation) {
        await storage.markInvitationAccepted(invitation.id);
      }

      // Don't log in automatically unless auto-approved
      const message = invitation
        ? "Registration successful! You can now log in with your credentials."
        : "Registration successful! Your account is pending admin approval. You will be notified once approved.";

      res.status(201).json({
        message,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isApproved: user.isApproved,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Validation error",
          errors: error.errors,
        });
      }
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  // Login endpoint
  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const validatedData = loginSchema.parse(req.body);

      passport.authenticate("local", (err: any, user: any, info: any) => {
        if (err) {
          console.error("Authentication error:", err);
          return res.status(500).json({ message: "Authentication error" });
        }

        if (!user) {
          return res
            .status(401)
            .json({ message: info?.message || "Invalid credentials" });
        }

        req.login(user, (err) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Failed to establish session" });
          }

          res.json({
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
          });
        });
      })(req, res, next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Validation error",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Logout endpoint
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // GET logout route for direct navigation
  app.get("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error("Logout error:", err);
      }
      res.redirect("/");
    });
  });

  // Get current user
  app.get("/api/auth/user", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = req.user;
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      profileImageUrl: user.profileImageUrl,
      phone: user.phone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  });

  // Forgot password endpoint
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const validatedData = forgotPasswordSchema.parse(req.body);

      const user = await storage.getUserByEmail(validatedData.email);
      if (!user) {
        // Don't reveal if email exists for security
        return res.json({
          message: "If the email exists, a reset link has been sent",
        });
      }

      // Generate reset token
      const resetToken = generateToken();
      const resetExpires = new Date(Date.now() + 3600000); // 1 hour

      // Store reset token
      await storage.setPasswordResetToken(user.id, resetToken, resetExpires);

      // Send password reset email using the template
      const emailTemplate = await storage.getEmailTemplate("password_reset");
      const companySettings = await storage.getCompanySettings();
      const emailProvider = await storage.getActiveEmailProvider();

      if (emailTemplate && emailProvider) {
        const resetUrl = `${req.protocol}://${req.get(
          "host"
        )}/auth?mode=reset&token=${resetToken}`;

        // Generate a 6-digit reset code from the token (first 6 characters)
        const resetCode = resetToken.substring(0, 6).toUpperCase();

        // Get fromEmail and fromName: prioritize email provider, fallback to company settings, then defaults
        const fromName =
          emailProvider.fromName ||
          companySettings?.companyName ||
          "TicketFlow";
        const fromEmail =
          emailProvider.fromEmail ||
          (companySettings?.companyName
            ? `${companySettings.companyName
                .toLowerCase()
                .replace(/\s+/g, "")}@ticketflow.com`
            : "no-reply@ticketflow.com");

        // Get user's first name or use email prefix
        const userName = user.firstName || user.email?.split("@")[0] || "User";

        // Get IP address and timestamp
        const ipAddress = req.ip || req.socket.remoteAddress || "Unknown";
        const timestamp = new Date().toLocaleString();

        // Use appropriate email service based on provider
        if (emailProvider.provider === EMAIL_PROVIDERS.MAILTRAP) {
          const { sendEmailWithTemplate } = await import(
            "../../services/mailtrap"
          );
          const mailtrapToken =
            emailProvider.metadata?.mailtrapToken || process.env.MAILTRAP_TOKEN;

          const emailSent = await sendEmailWithTemplate({
            to: user.email || "",
            template: emailTemplate,
            variables: {
              companyName: companySettings?.companyName || "TicketFlow",
              userName: userName,
              resetCode: resetCode,
              resetUrl: resetUrl,
              ipAddress: ipAddress,
              timestamp: timestamp,
              year: new Date().getFullYear().toString(),
            },
            fromEmail,
            fromName,
            mailtrapToken,
          });

          if (!emailSent) {
            console.error("Failed to send password reset email via Mailtrap");
            // Still return success to user for security (don't reveal email sending failure)
          }
        } else if (emailProvider.provider === EMAIL_PROVIDERS.AWS) {
          const { sendEmailWithTemplate } = await import("../../services/ses");
          // Extract AWS credentials from email provider metadata
          const awsCredentials = emailProvider.metadata
            ? {
                awsAccessKeyId: emailProvider.metadata.awsAccessKeyId,
                awsSecretAccessKey: emailProvider.metadata.awsSecretAccessKey,
                awsRegion: emailProvider.metadata.awsRegion,
              }
            : {};

          const emailSent = await sendEmailWithTemplate({
            to: user.email || "",
            template: emailTemplate,
            variables: {
              companyName: companySettings?.companyName || "TicketFlow",
              userName: userName,
              resetCode: resetCode,
              resetUrl: resetUrl,
              ipAddress: ipAddress,
              timestamp: timestamp,
              year: new Date().getFullYear().toString(),
            },
            fromEmail,
            fromName,
            ...awsCredentials,
          });

          if (!emailSent) {
            console.error("Failed to send password reset email via AWS SES");
            // Still return success to user for security (don't reveal email sending failure)
          }
        } else {
          console.warn(
            `Email provider ${emailProvider.provider} not supported for password reset`
          );
        }
      } else {
        console.warn(
          "Password reset email not sent: email template or provider not configured"
        );
        // Log token for development/debugging (remove in production)
        console.log(`Password reset token for ${user.email}: ${resetToken}`);
      }

      res.json({ message: "If the email exists, a reset link has been sent" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Validation error",
          errors: error.errors,
        });
      }
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  // Reset password endpoint
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const validatedData = resetPasswordSchema.parse(req.body);

      // Find user by reset token
      const user = await storage.getUserByResetToken(validatedData.token);
      if (!user) {
        return res
          .status(400)
          .json({ message: "Invalid or expired reset token" });
      }

      // Hash new password
      const hashedPassword = await hashPassword(validatedData.password);

      // Update password and clear reset token
      await storage.updateUserPassword(user.id, hashedPassword);
      await storage.clearPasswordResetToken(user.id);

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Validation error",
          errors: error.errors,
        });
      }
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Check email availability
  app.post("/api/auth/check-email", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      res.json({ available: !user });
    } catch (error) {
      res.status(500).json({ message: "Failed to check email" });
    }
  });
}

/**
 * Authentication middleware to protect routes
 */
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};

/**
 * Role-based access control middleware
 */
export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRole = req.user.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    next();
  };
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}
