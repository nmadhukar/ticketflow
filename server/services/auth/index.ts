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
import { normalizeRole } from "../../permissions/roles";
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
import { requireSecret } from "../../security/secrets";
import { authRateLimit, authRequestRateLimit } from "../../security/rateLimiting";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express type augmentation requires a namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation: User extends SelectUser with nothing added
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
export async function comparePasswords(
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
  inviteToken: z.string().min(1).optional(),
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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

let activeSessionStore: InstanceType<ReturnType<typeof connectPg>> | undefined;

/**
 * Closes the session store's own connection pool (created by setupAuth).
 * Used by the test harness so Jest can exit without --forceExit.
 */
export async function closeAuth(): Promise<void> {
  const store = activeSessionStore;
  activeSessionStore = undefined;
  await store?.close();
}

/**
 * Setup authentication middleware and routes
 */
export function setupAuth(app: Express) {
  // Throws before anything connects when production has no SESSION_SECRET.
  const sessionSecret = requireSecret("SESSION_SECRET", {
    devFallback: "dev-only-session-secret-not-for-production",
  });

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

  activeSessionStore = sessionStore;

  const sessionSettings: session.SessionOptions = {
    secret: sessionSecret,
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
  // Auth rate limits (every environment), registered before the handlers.
  app.post("/api/auth/login", authRateLimit);
  app.post("/api/auth/forgot-password", authRequestRateLimit);
  app.post("/api/auth/reset-password", authRequestRateLimit);

  app.post("/api/auth/change-password", authRequestRateLimit);

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // After an admin reset the user must choose their own password first: until
  // then only reading who they are, signing out and changing the password work.
  app.use((req, res, next) => {
    if (!req.user?.mustChangePassword || !req.path.startsWith("/api")) return next();
    const allowed =
      (req.method === "GET" && (req.path === "/api/auth/user" || req.path === "/api/logout")) ||
      (req.method === "POST" &&
        (req.path === "/api/auth/logout" || req.path === "/api/auth/change-password"));
    if (allowed) return next();
    return res.status(403).json({
      error: "password_change_required",
      message: "You must change your password before continuing.",
    });
  });

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

          // Claim the attempt atomically BEFORE comparing: at most five
          // comparisons can happen per lock window, however many requests
          // arrive in parallel.
          const attempt = await storage.claimLoginAttempt(user.id, new Date());
          if (attempt === null) {
            return done(null, false, {
              message:
                "Too many failed login attempts. Try again in a few minutes.",
              code: "account_locked",
            } as any);
          }

          const isValid = await comparePasswords(password, user.password);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          await storage.resetFailedLogins(user.id);

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
      // A deactivated or un-approved user's existing sessions stop working.
      if (!user || !user.isActive || !user.isApproved) {
        return done(null, false);
      }
      // One canonical role per request ("user" reads as agent); an unknown role fails closed.
      const role = normalizeRole(user.role);
      if (!role) return done(null, false);
      done(null, { ...user, role });
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

      // An invitation is applied only when its secret token is presented
      // AND it was issued for this very email, is still pending and unexpired.
      let invitation: Awaited<
        ReturnType<typeof storage.getUserInvitationByToken>
      > = undefined;
      if (validatedData.inviteToken) {
        const candidate = await storage.getUserInvitationByToken(
          validatedData.inviteToken
        );
        if (
          !candidate ||
          candidate.status !== "pending" ||
          new Date(candidate.expiresAt) <= new Date() ||
          candidate.email.toLowerCase() !== validatedData.email.toLowerCase()
        ) {
          return res.status(400).json({
            error: "invalid_invitation",
            message: "This invitation is invalid, expired or not for this email.",
          });
        }
        if (!normalizeRole(candidate.role)) {
          return res.status(400).json({
            error: "invalid_invitation",
            message: "This invitation is invalid, expired or not for this email.",
          });
        }
        invitation = candidate;
      }

      // Never let a registration take over an existing account, including
      // a password-less (SSO) one.
      if (existingUser) {
        if (!existingUser.password) {
          return res.status(409).json({
            error: "account_exists",
            message:
              "An account for this email already exists. Sign in with your single sign-on provider.",
          });
        }
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
        role: invitation ? normalizeRole(invitation.role)! : "customer",
        isActive: true,
        isApproved: invitation ? true : false, // Auto-approve if invited
      };

      // With an invitation, the claim and the user insert are one transaction:
      // a lost race creates nothing.
      let user;
      if (invitation) {
        const created = await storage.createUserClaimingInvitation(
          newUser,
          invitation.id
        );
        if (!created) {
          return res.status(400).json({
            error: "invalid_invitation",
            message: "This invitation is invalid, expired or not for this email.",
          });
        }
        user = created;
      } else {
        user = await storage.createUser(newUser);
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
      const _validatedData = loginSchema.parse(req.body);

      passport.authenticate("local", (err: any, user: any, info: any) => {
        if (err) {
          console.error("Authentication error:", err);
          return res.status(500).json({ message: "Authentication error" });
        }

        if (!user) {
          if (info?.code === "account_locked") {
            return res
              .status(423)
              .json({ error: "account_locked", message: info.message });
          }
          return res
            .status(401)
            .json({ message: info?.message || "Invalid credentials" });
        }

        // An unknown role never gets a session.
        if (!normalizeRole(user.role)) {
          return res.status(403).json({
            error: "invalid_role",
            message: "This account has no valid role. Contact an administrator.",
          });
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
            role: normalizeRole(user.role) ?? user.role,
            mustChangePassword: user.mustChangePassword === true,
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
      mustChangePassword: user.mustChangePassword === true,
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
      // A password-less (SSO) account has nothing to reset: same answer as an
      // unknown email, nothing stored, nothing sent.
      if (!user || !user.password) {
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
      // Whoever held the old password (or this token) must sign in again.
      await storage.revokeUserSessions(user.id);
      // A token reset is the recovery path from a lockout.
      await storage.resetFailedLogins(user.id);

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

  // Signed-in password change (also how a forced change from an admin reset ends).
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const body = changePasswordSchema.parse(req.body);
      const current = await storage.getUser(req.user.id);
      if (!current?.password) {
        return res.status(409).json({
          error: "no_local_password",
          message: "This account signs in with single sign-on and has no local password.",
        });
      }
      if (!(await comparePasswords(body.currentPassword, current.password))) {
        return res.status(400).json({
          error: "invalid_current_password",
          message: "Current password is incorrect",
        });
      }
      if (body.currentPassword === body.password) {
        return res.status(400).json({
          error: "password_unchanged",
          message: "Choose a password different from the current one.",
        });
      }
      await storage.updateUserPassword(current.id, await hashPassword(body.password));
      // Other devices sign in again; this session stays.
      await storage.revokeUserSessions(current.id, req.sessionID);
      res.json({ message: "Password changed" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Change password error:", error instanceof Error ? error.message : "unknown");
      res.status(500).json({ message: "Failed to change password" });
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

    const userRole = normalizeRole(req.user.role);
    if (!userRole || !roles.includes(userRole)) {
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
    secret: requireSecret("SESSION_SECRET", {
      devFallback: "dev-only-session-secret-not-for-production",
    }),
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

function _updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function _upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}
