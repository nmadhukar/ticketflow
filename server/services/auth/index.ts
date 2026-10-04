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
import { Strategy as LocalStrategy, type IVerifyOptions } from "passport-local";
import type { Express, RequestHandler } from "express";
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
import { publicBaseUrl } from "../../utils/appBaseUrl";
import { isAiSystemUserId } from "../../utils/aiSystemUserId";
import { selfView } from "../../utils/publicUser";
import { ServerResponse, type IncomingMessage } from "http";
import { disconnectUser } from "../../realtime/connections";
import { fail, logRouteError } from "../../http/errors";
import {
  authRateLimit,
  changePasswordRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
} from "../../security/rateLimiting";
import { isApiPath } from "../../utils/apiPath";
import {
  bearerAuth,
  bearerRateLimitGate,
  markSessionAuth,
  requireSessionForCredentials,
} from "./bearer";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express type augmentation requires a namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation: User extends SelectUser with nothing added
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

/** What the local strategy tells the login handler when it refuses: a message, and a code for a lock. */
type LoginInfo = IVerifyOptions & { code?: "account_locked" };

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

/** express-session's default cookie name, stated so the revocation path can clear it by name. */
const SESSION_COOKIE_NAME = "connect.sid";

// R55: every store setupAuth creates, so a second call no longer leaks the first one's pool.
const activeSessionStores = new Set<InstanceType<ReturnType<typeof connectPg>>>();
let activeSessionMiddleware: RequestHandler | undefined;

/**
 * Closes the connection pool of EVERY session store setupAuth created, then
 * forgets them. Used by the test harness so Jest can exit without --forceExit.
 */
export async function closeAuth(): Promise<void> {
  const stores = Array.from(activeSessionStores);
  activeSessionStores.clear();
  activeSessionMiddleware = undefined;
  await Promise.all(stores.map((store) => store.close()));
}

/** The two stamps a session carries for the password-change revocation rule. */
export interface SessionStamp {
  /** When the sign-in started (ms). */
  authAt?: unknown;
  /** The verified row's passwordChangedAt at sign-in (ms; 0 when it had none). */
  pwdAt?: unknown;
}

/** The passwordChangedAt of a user row as a millisecond stamp (0 for none), the value `pwdAt` stores. */
export function passwordStamp(user: { passwordChangedAt?: Date | string | null } | undefined): number {
  const changedAt = user?.passwordChangedAt;
  return changedAt ? new Date(changedAt).getTime() : 0;
}

/**
 * A session that authenticated before the password last changed is dead. Shared by
 * the HTTP check in setupAuth and the WebSocket upgrade so they cannot disagree.
 *
 * Primary rule: the session stores the passwordChangedAt of the row whose password
 * it verified (`pwdAt`); it is dead once the row has a later change. That closes the
 * race where a reset takes its timestamp before the login starts but commits after
 * the login read the old row (a clock comparison alone would honour that session).
 * Sessions created before `pwdAt` existed, and hand-built ones, fall back to comparing
 * `authAt` with the change time. Accepted: the changer's own request that was already
 * in flight can save the session with its old stamps, which fails closed (that
 * request's browser signs in again); and `authAt` is a server clock, so with several
 * instances a skew can revoke a fresh session early (never later).
 */
export function isSessionRevoked(
  user: { passwordChangedAt?: Date | string | null } | undefined,
  session: unknown
): boolean {
  const changedAt = user?.passwordChangedAt;
  if (!changedAt) return false;
  const stamp = (session ?? {}) as SessionStamp;
  if (typeof stamp.pwdAt === "number") return stamp.pwdAt < passwordStamp(user);
  return !(typeof stamp.authAt === "number" && stamp.authAt >= new Date(changedAt).getTime());
}

/**
 * Resolves the signed-in user of a raw HTTP request (a WebSocket upgrade) with the
 * same machinery an Express request goes through: the session cookie, the session
 * store and passport's deserializeUser (which refuses inactive, unapproved, AI and
 * unknown-role users). Returns the user and the session's authAt, or null for no session, a revoked session, a user who
 * must change their password first, or the AI system user.
 */
export async function authenticateUpgrade(
  req: IncomingMessage
): Promise<{ user: Express.User; authAt: unknown; pwdAt: unknown } | null> {
  const sessionMiddleware = activeSessionMiddleware;
  if (!sessionMiddleware) return null;
  const res = new ServerResponse(req);
  const run = (mw: RequestHandler) =>
    new Promise<void>((resolve, reject) =>
      mw(req as any, res as any, (err?: unknown) => (err ? reject(err) : resolve()))
    );
  try {
    await run(sessionMiddleware);
    await run(passport.initialize());
    await run(passport.session());
  } catch (error) {
    logRouteError("WebSocket auth error", error);
    return null;
  }
  const user = (req as any).user as Express.User | undefined;
  if (!user || isAiSystemUserId(user.id)) return null;
  if (isSessionRevoked(user, (req as any).session)) return null;
  if (user.mustChangePassword) return null;
  const stamp = ((req as any).session ?? {}) as SessionStamp;
  return { user, authAt: stamp.authAt, pwdAt: stamp.pwdAt };
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

  activeSessionStores.add(sessionStore);

  // Also the options a cookie is cleared with: they must match the ones it was set with.
  const sessionCookieOptions = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax" as const,
    path: "/",
  };
  const sessionSettings: session.SessionOptions = {
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { ...sessionCookieOptions, maxAge: sessionTtl },
  };

  // `trust proxy` is set once, in server/index.ts, from TRUST_PROXY_HOPS (R49): the auth limiters
  // below key on req.ip, the address the trusted proxy chain saw.
  // Auth rate limits (every environment), registered before the handlers.
  // Mounted with app.use (POST only), not as a second app.post route, so the route
  // table keeps exactly one registration per method + path (noDuplicateRoutes).
  const limitPost = (path: string, limiter: RequestHandler) =>
    app.use(path, (req, res, next) =>
      req.method === "POST" ? limiter(req, res, next) : next()
    );
  limitPost("/api/auth/login", authRateLimit);
  // One limiter per endpoint: separate budgets (see security/rateLimiting.ts).
  limitPost("/api/auth/forgot-password", forgotPasswordRateLimit);
  limitPost("/api/auth/reset-password", resetPasswordRateLimit);
  limitPost("/api/auth/change-password", changePasswordRateLimit);

  activeSessionMiddleware = session(sessionSettings);
  app.use(activeSessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());
  // Tells setupMicrosoftAuth the one session + passport stack is already in place.
  app.set("sessionStackMounted", true);

  // Bearer API keys / JWTs. Runs after passport.session() so a bearer replaces a
  // cookie's user (and an invalid bearer is 401 despite a valid cookie), and
  // before the two gates below. The realtime WebSocket upgrade stays
  // session-only (authenticateUpgrade).
  app.use(markSessionAuth);
  app.use(bearerRateLimitGate);
  app.use(bearerAuth);
  app.use(requireSessionForCredentials);

  // A session that authenticated before the password last changed is dead, even if
  // a request that loaded it earlier saved the row back after the revocation DELETE.
  app.use((req, res, next) => {
    // Bearer requests have no session; their own checks ran in bearerAuth.
    if (req.authMethod === "api_key" || req.authMethod === "jwt") return next();
    if (!req.user || !req.user.passwordChangedAt) return next();
    // Signing in again (or out) must work with a revoked cookie, and page loads
    // must still get the app; every other API route is checked.
    const p = req.path.toLowerCase();
    if (
      !isApiPath(p) ||
      (req.method === "POST" && (p === "/api/auth/login" || p === "/api/auth/logout")) ||
      (req.method === "GET" && p === "/api/logout")
    ) {
      return next();
    }
    if (!isSessionRevoked(req.user, req.session)) return next();
    req.session.destroy(() => {
      // The dead cookie must not keep riding along: expire it in the browser too.
      res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions);
      res.status(401).json({
        error: "session_revoked",
        message: "Your session ended because the password changed. Sign in again.",
      });
    });
  });

  // After an admin reset the user must choose their own password first: until
  // then only reading who they are, signing out and changing the password work.
  app.use((req, res, next) => {
    // Express routes case-insensitively, so compare the lower-cased path.
    const path = req.path.toLowerCase();
    if (!req.user?.mustChangePassword || !isApiPath(path)) return next();
    const allowed =
      (req.method === "GET" && (path === "/api/auth/user" || path === "/api/logout")) ||
      (req.method === "POST" &&
        (path === "/api/auth/login" || path === "/api/auth/logout" || path === "/api/auth/change-password"));
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
          // No such user, the AI system user, and a password-less (SSO) account all
          // get the answer an unknown email gets: the response never says which.
          if (!user || isAiSystemUserId(user.id) || !user.password) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Claim the attempt atomically BEFORE comparing: at most five
          // comparisons can happen per lock window, however many requests
          // arrive in parallel.
          const attempt = await storage.claimLoginAttempt(user.id, new Date());
          if (attempt === null) {
            const locked: LoginInfo = {
              message: "Too many failed login attempts. Try again in a few minutes.",
              code: "account_locked",
            };
            return done(null, false, locked);
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
      if (!user || !user.isActive || !user.isApproved || isAiSystemUserId(user.id)) {
        return done(null, false);
      }
      // One canonical role per request ("user" reads as agent); an unknown role fails closed.
      const role = normalizeRole(user.role);
      if (!role) return done(null, false);
      done(null, { ...user, role });
    } catch (error) {
      logRouteError("Deserialize user error", error);
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
      // a password-less (SSO) one. The answer is the same whatever kind of
      // account holds the email, so it does not reveal which kind it is.
      if (existingUser) {
        return res.status(400).json({
          error: "email_registered",
          message: "Email already registered",
        });
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
        return fail(res, 400, "Validation error", { details: error.flatten() });
      }
      logRouteError("Registration error", error);
      fail(res, 500, "Failed to register user");
    }
  });

  // Login endpoint
  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const _validatedData = loginSchema.parse(req.body);
      // Taken before the credentials are checked: a reset that lands afterwards
      // makes this session older than passwordChangedAt, so it is refused.
      const authStartedAt = Date.now();

      passport.authenticate("local", (err: any, user: any, info: LoginInfo | undefined) => {
        if (err) {
          logRouteError("Authentication error", err);
          return fail(res, 500, "Authentication error");
        }

        if (!user) {
          if (info?.code === "account_locked") {
            return res
              .status(423)
              .json({ error: "account_locked", message: info.message });
          }
          return fail(res, 401, info?.message || "Invalid credentials", {
            code: "invalid_credentials",
          });
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
            return fail(res, 500, "Failed to establish session");
          }
          // Stamped after login (which starts a fresh session) for the revocation check:
          // the time the sign-in started, and the change stamp of the row whose password
          // was verified (isSessionRevoked explains why both).
          const stamp = req.session as unknown as SessionStamp;
          stamp.authAt = authStartedAt;
          stamp.pwdAt = passwordStamp(user);

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
        return fail(res, 400, "Validation error", { details: error.flatten() });
      }
      fail(res, 500, "Login failed");
    }
  });

  // Logout endpoint
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return fail(res, 500, "Failed to logout");
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // GET logout route for direct navigation
  app.get("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        logRouteError("Logout error", err);
      }
      res.redirect("/");
    });
  });

  // Get current user
  app.get("/api/auth/user", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return fail(res, 401, "Not authenticated");
    }

    // selfView: the projection the MCP whoami tool returns too.
    res.json(selfView(req.user));
  });

  // Forgot password endpoint
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const validatedData = forgotPasswordSchema.parse(req.body);

      const user = await storage.getUserByEmail(validatedData.email);
      // A password-less (SSO) account has nothing to reset: same answer as an
      // unknown email, nothing stored, nothing sent.
      if (!user || !user.password || isAiSystemUserId(user.id)) {
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

      // R34: the link's origin is APP_BASE_URL, never the request's Host header.
      const baseUrl = publicBaseUrl(req);
      if (!baseUrl) {
        console.warn("Password reset email not sent: APP_BASE_URL is not set");
      } else if (emailTemplate && emailProvider) {
        const resetUrl = `${baseUrl}/auth?mode=reset&token=${resetToken}`;

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
        return fail(res, 400, "Validation error", { details: error.flatten() });
      }
      logRouteError("Forgot password error", error);
      fail(res, 500, "Failed to process request");
    }
  });

  // Reset password endpoint
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const validatedData = resetPasswordSchema.parse(req.body);

      // Find user by reset token
      const user = await storage.getUserByResetToken(validatedData.token);
      if (!user) {
        return fail(res, 400, "Invalid or expired reset token", { code: "invalid_reset_token" });
      }

      // Hash new password
      const hashedPassword = await hashPassword(validatedData.password);

      // Update password and clear reset token
      await storage.updateUserPassword(user.id, hashedPassword);
      await storage.clearPasswordResetToken(user.id);
      // Whoever held the old password (or this token) must sign in again.
      await storage.revokeUserSessions(user.id);
      disconnectUser(user.id);
      // A token reset is the recovery path from a lockout.
      await storage.resetFailedLogins(user.id);

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return fail(res, 400, "Validation error", { details: error.flatten() });
      }
      logRouteError("Reset password error", error);
      fail(res, 500, "Failed to reset password");
    }
  });

  // Signed-in password change (also how a forced change from an admin reset ends).
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return fail(res, 401, "Not authenticated");
      }
      const body = changePasswordSchema.parse(req.body);
      const current = await storage.getUser(req.user.id);
      if (!current?.password) {
        return res.status(409).json({
          error: "no_local_password",
          message: "This account signs in with single sign-on and has no local password.",
        });
      }
      // A wrong current password is a password guess like a wrong login, so it spends the
      // same lockout budget: the attempt is claimed before the comparison (a locked
      // account is refused without one), and a correct one forgives earlier misses.
      const attempt = await storage.claimLoginAttempt(current.id, new Date());
      if (attempt === null) {
        return res.status(423).json({
          error: "account_locked",
          message: "Too many failed attempts. Try again in a few minutes.",
        });
      }
      if (!(await comparePasswords(body.currentPassword, current.password))) {
        return res.status(400).json({
          error: "invalid_current_password",
          message: "Current password is incorrect",
        });
      }
      await storage.resetFailedLogins(current.id);
      if (body.currentPassword === body.password) {
        return res.status(400).json({
          error: "password_unchanged",
          message: "Choose a password different from the current one.",
        });
      }
      const newHash = await hashPassword(body.password);
      // This session stays valid: the change time and its authAt are the same
      // instant. Other devices sign in again.
      const changedAt = new Date();
      await storage.updateUserPassword(current.id, newHash, changedAt);
      const stamp = req.session as unknown as SessionStamp;
      stamp.authAt = changedAt.getTime();
      stamp.pwdAt = changedAt.getTime();
      await storage.revokeUserSessions(current.id, req.sessionID);
      // Sockets of other devices must go (their sessions are revoked); this device's
      // socket reconnects, so its new authAt must be stored before it does.
      await new Promise<void>((resolve) => req.session.save(() => resolve()));
      disconnectUser(current.id, 1012);
      res.json({ message: "Password changed" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return fail(res, 400, "Validation error", { details: error.flatten() });
      }
      logRouteError("Change password error", error);
      fail(res, 500, "Failed to change password");
    }
  });

  // No "is this email taken" endpoint: no client uses one, and an anonymous
  // yes/no per address is an account-enumeration oracle (removed in Task 13).
}

/**
 * Authentication middleware to protect routes
 */
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  fail(res, 401, "Unauthorized");
};

/**
 * Role-based access control middleware
 */
export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      return fail(res, 401, "Unauthorized");
    }

    const userRole = normalizeRole(req.user.role);
    if (!userRole || !roles.includes(userRole)) {
      return fail(res, 403, "Forbidden");
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
