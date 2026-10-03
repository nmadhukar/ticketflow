/**
 * TicketFlow API Routes - Complete REST API Implementation
 *
 * This module defines all REST API endpoints for the TicketFlow application with:
 *
 * Authentication & Authorization:
 * - Multi-strategy authentication (local + Microsoft 365 SSO)
 * - Role-based access control (customer, user, manager, admin)
 * - Session management and security middleware
 *
 * Core Ticket Management:
 * - CRUD operations for tickets with full audit trails
 * - Comment and attachment handling
 * - Status tracking and assignment management
 * - Real-time updates via WebSocket integration
 *
 * AI-Powered Features:
 * - Automatic ticket analysis and classification
 * - Intelligent response generation with confidence scoring
 * - Knowledge base learning from resolved tickets
 * - FAQ cache management and semantic search
 *
 * Team Collaboration:
 * - Team management and member assignment
 * - Department organization and workflows
 * - User invitation and approval systems
 * - Microsoft Teams integration for notifications
 *
 * Administrative Features:
 * - Company settings and branding management
 * - Email template and notification configuration
 * - API key management and security
 * - User guide and documentation systems
 * - Policy document management for AI training
 *
 * Security & Monitoring:
 * - Input validation using Zod schemas
 * - Rate limiting and abuse protection
 * - Audit logging and activity tracking
 * - Error handling and recovery procedures
 *
 * @module routes
 */

import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { attachRealtime, notifyTicket, notifyStaff } from "../realtime/ws";
import { storage, publicUserColumns } from "../storage";
import { setupAuth, isAuthenticated, hashPassword } from "../services/auth";
import { normalizeRole } from "../permissions/roles";
import { setupMicrosoftAuth } from "../services/auth/microsoftAuth";
import { teamsIntegration } from "../services/microsoftTeams";
import { canChangeTeamMembership } from "../permissions/teams";
import { teamsSettingsInputSchema } from "../services/teamsNotifications";
import { assertPublicHost, validateWebhookUrl } from "../services/webhookGuard";
import { sessionTrackingMiddleware } from "../middleware/sessionTracking.middleware";
import {
  type User,
  insertTaskAttachmentSchema,
  ticketAutoResponses,
  ticketComplexityScores,
  knowledgeArticles,
  escalationRules,
  aiFeedback,
  learningQueue,
  tasks,
  taskAttachments,
} from "@shared/schema";

import {
  processKnowledgeLearning,
  intelligentKnowledgeSearch,
  scheduleKnowledgeLearning,
} from "../services/ai/knowledgeBaseLearning";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import multer from "multer";
import { db } from "../storage/db";
import {
  eq,
  desc,
  and,
  or,
  ilike,
  count,
  avg,
  sum,
  sql,
  inArray,
  ne,
  getTableColumns,
} from "drizzle-orm";
import { teams, departments, users } from "@shared/schema";
import { excludeSystemAccounts, ensureAiSystemUser } from "../utils/aiSystemUser";
import { describeAIError, isQuotaBlocked, sendQuotaExceeded } from "../services/ai/aiErrors";
import { requireStaff, isStaffRole } from "../permissions/staff";
import { loadAiTicket } from "../services/ai/aiTicketGate";
import { logSecurityEvent } from "../security/rbac";
import {
  getAISettings,
  saveAISettings,
  validateAISettings,
} from "../admin/aiSettings";
import { registerAdminRoutes } from "../admin";
import { bedrockIntegration } from "../services/ai/bedrockIntegration";
import { s3Service } from "../services/s3Service";
import { DEFAULT_COMPANY, EMAIL_PROVIDERS } from "@shared/constants";
import { getTicketMetaForUser } from "../permissions/tickets";
import { buildTicketMeta } from "../services/tickets/meta";
import {
  assertTaskAccess,
  requireTaskAccess,
  ticketVisibilityWhere,
} from "../permissions/ticketAccess";
import { HttpError, asyncHandler, fail, logRouteError } from "../http/errors";
import { autoResponseCommentBody, autoResponseCommentExists } from "../services/ai/autoResponseComment";
import { projectUserForViewer } from "../utils/publicUser";
import { toPublicInvitation } from "../utils/publicInvitation";
import { publicBaseUrl } from "../utils/appBaseUrl";
import { displayNameSql } from "../utils/displayName";
import { ticketListQuerySchema } from "../services/tickets/schemas";
import {
  addComment,
  createTicket,
  deleteTicket,
  getTicket,
  prepareTicketCreate,
  updateTicket,
} from "../services/tickets/ticketService";
import { TicketError, ticketErrorToHttp } from "../services/tickets/ticketError";
import { notifyCommentAdded } from "../services/tickets/notifier";
import { createMcpRouter } from "../mcp/router";
import {
  runTicketCreatedHooks,
  setTicketCreatedBroadcaster,
} from "../services/tickets/create";
import { registerEmailRoutes } from "./email";
import { parseIdParam } from "../http/params";
import { sanitizeRichHtml } from "../security/sanitizeHtml";
import { containsPattern } from "../utils/like";
import { registerTeamsRoutes } from "./teams";
import { registerIdParams } from "../http/install";
import {
  generateAutoResponseForTicket,
  analyzeTicket as analyzeTicketWithAI,
} from "server/services/ai/aiTicketAnalysis";
import { PROMPT_TEMPLATES } from "server/services/ai/prompts";

// Helper function to sanitize company name for S3 key
function sanitizeCompanyNameForS3(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}

// Helper function to format date as "sep-10-2025" for S3 folder structure
function getDateFolder(): string {
  const now = new Date();
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const month = months[now.getMonth()];
  const day = now.getDate();
  const year = now.getFullYear();
  return `${month}-${day}-${year}`;
}

// Configure multer for file uploads
// Uses environment variables with defaults: MAX_FILE_UPLOAD_SIZE_MB (50MB), MAX_FILES_PER_REQUEST (10)
const maxFileSizeMB = parseInt(process.env.MAX_FILE_UPLOAD_SIZE_MB || "50", 10);
const maxFilesPerRequest = parseInt(
  process.env.MAX_FILES_PER_REQUEST || "10",
  10
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxFileSizeMB * 1024 * 1024, // Per file size limit
    files: maxFilesPerRequest, // Max number of files
  },
});


/**
 * Registers all application routes and returns HTTP server instance
 *
 * @param app - Express application instance
 * @returns HTTP server with WebSocket support
 */
/** GET /api/ai/knowledge-search: free text goes to the model, so it is bounded. */
const knowledgeSearchQuery = z.object({
  query: z.string().trim().min(1).max(500),
  category: z.string().trim().max(100).optional(),
  maxResults: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * PATCH /api/admin/users/:userId body. `role` must be one of the four roles
 * (the legacy "user" is stored as "agent"); a typo is a 400, never a stored
 * role nobody can sign in with.
 */
const adminUserUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  phone: z
    .string()
    .trim()
    .max(50)
    .nullable()
    .transform((v) => v ?? "")
    .optional(),
  role: z
    .string()
    .refine((v) => normalizeRole(v) !== null, "Unknown role")
    .transform((v) => normalizeRole(v) as string)
    .optional(),
  isActive: z.boolean().optional(),
});

export async function registerRoutes(app: Express): Promise<Server> {
  registerIdParams(app);

  // SNS calls this without a session: its signature is the only authentication. Mounted
  // before setupAuth so no session or auth middleware can touch it.
  registerEmailRoutes(app);

  // Auth middleware
  setupAuth(app);
  // Awaited: its routes must exist before the /api 404 handler is installed
  // after registerRoutes returns, or /api/auth/microsoft answers 404.
  await setupMicrosoftAuth(app).catch(() => {
    console.error("Microsoft auth setup failed; SSO is unavailable.");
  });

  registerAdminRoutes(app);
  registerTeamsRoutes(app);
  // Session tracking middleware
  app.use(sessionTrackingMiddleware);

  // Helper to get user ID from request
  const getUserId = (req: any): string => {
    return req.user?.id || req.user?.claims?.sub;
  };

  // Users route
  app.get("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      // Staff only. normalizeRole reads the legacy role "user" as agent.
      const requesterRole = normalizeRole(
        (await storage.getUser(getUserId(req)))?.role
      );
      if (
        !requesterRole ||
        !["admin", "manager", "agent"].includes(requesterRole)
      ) {
        return fail(res, 403, "Forbidden");
      }
      const forTeamMemberSelection =
        req.query.forTeamMemberSelection === "true";

      if (forTeamMemberSelection) {
        // Filter for team member selection: agents, managers, and admins (if requester is admin)
        const requesterId = getUserId(req);
        const requester = await storage.getUser(requesterId);
        const isRequesterAdmin = requester?.role === "admin";

        let query = db.select(publicUserColumns).from(users);

        if (isRequesterAdmin) {
          // Admins can see agents, managers, and other admins
          query = query.where(
            and(
              excludeSystemAccounts(),
              or(
                eq(users.role, "agent"),
                eq(users.role, "manager"),
                eq(users.role, "admin")
              )
            )
          ) as any;
        } else {
          // Non-admins can only see agents and managers
          query = query.where(
            and(
              excludeSystemAccounts(),
              or(eq(users.role, "agent"), eq(users.role, "manager"))
            )
          ) as any;
        }

        const filteredUsers = await query;
        return res.json(filteredUsers);
      }

      // Default: return all users (backward compatible)
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      logRouteError("Error fetching users", error);
      fail(res, 500, "Failed to fetch users");
    }
  });

  // User preferences routes
  app.get("/api/user/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      let preferences = await storage.getUserPreferences(userId);

      // If preferences don't exist, return defaults (lazy initialization)
      // Client will handle language from localStorage
      if (!preferences) {
        preferences = {
          userId,
          theme: "light",
          language: "en",
          timezone: "UTC",
          dateFormat: "MM/DD/YYYY",
          emailNotifications: true,
          pushNotifications: false,
          taskUpdates: true,
          teamUpdates: true,
          mentions: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      res.json(preferences);
    } catch (error) {
      logRouteError("Error fetching user preferences", error);
      fail(res, 500, "Failed to fetch user preferences");
    }
  });

  app.patch("/api/user/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = req.body;

      // Validation
      const allowedThemes = ["light", "dark", "system"];
      const allowedLanguages = ["en", "es", "fr", "de", "zh"];
      const allowedDateFormats = [
        "MM/DD/YYYY",
        "DD/MM/YYYY",
        "YYYY-MM-DD",
        "DD MMM YYYY",
      ];

      if (updates.theme && !allowedThemes.includes(updates.theme)) {
        return fail(res, 400, `Invalid theme. Must be one of: ${allowedThemes.join(", ")}`);
      }

      if (updates.language && !allowedLanguages.includes(updates.language)) {
        return fail(res, 400, `Invalid language. Must be one of: ${allowedLanguages.join(", ")}`);
      }

      if (
        updates.dateFormat &&
        !allowedDateFormats.includes(updates.dateFormat)
      ) {
        return fail(res, 400, `Invalid date format. Must be one of: ${allowedDateFormats.join(", ")}`);
      }

      // Validate timezone (basic check - should be IANA format)
      if (updates.timezone && typeof updates.timezone !== "string") {
        return fail(res, 400, "Timezone must be a string (IANA format)");
      }

      // Validate booleans
      const booleanFields = [
        "emailNotifications",
        "pushNotifications",
        "taskUpdates",
        "teamUpdates",
        "mentions",
      ];
      for (const field of booleanFields) {
        if (
          updates[field] !== undefined &&
          typeof updates[field] !== "boolean"
        ) {
          return fail(res, 400, `${field} must be a boolean`);
        }
      }

      const updatedPreferences = await storage.upsertUserPreferences(
        userId,
        updates
      );

      res.json(updatedPreferences);
    } catch (error) {
      logRouteError("Error updating user preferences", error);
      fail(res, 500, "Failed to update user preferences");
    }
  });

  // Get user's active sessions
  app.get("/api/user/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const currentSessionId = req.sessionID;

      // Save session with updated info
      req.session.save((err: any) => {
        if (err) {
          logRouteError("Error saving session", err);
        }
      });

      const sessions = await storage.getUserSessions(userId);

      // Mark current session
      const sessionsWithCurrent = sessions.map((session) => ({
        ...session,
        isCurrent: session.sessionId === currentSessionId,
      }));

      res.json(sessionsWithCurrent);
    } catch (error) {
      logRouteError("Error fetching user sessions", error);
      fail(res, 500, "Failed to fetch sessions");
    }
  });

  // Revoke a session
  app.delete(
    "/api/user/sessions/:sessionId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const { sessionId } = req.params;
        const currentSessionId = req.sessionID;

        // Prevent revoking current session (user should logout instead)
        if (sessionId === currentSessionId) {
          return fail(res, 400, "Cannot revoke current session. Please logout instead.");
        }

        // Verify the session belongs to the user
        const userSessions = await storage.getUserSessions(userId);
        const sessionExists = userSessions.some(
          (s) => s.sessionId === sessionId
        );

        if (!sessionExists) {
          return fail(res, 404, "Session not found");
        }

        await storage.revokeSession(sessionId);
        res.json({ message: "Session revoked successfully" });
      } catch (error) {
        logRouteError("Error revoking session", error);
        fail(res, 500, "Failed to revoke session");
      }
    }
  );

  // Task routes
  app.get("/api/tasks", isAuthenticated, async (req: any, res, next) => {
    try {
      const userId = getUserId(req);

      // A value outside the closed sets, or a bad limit/offset, is a 400.
      const q = ticketListQuerySchema.parse(req.query);

      // One visibility rule (ticketVisibilityWhere) for every role; assigneeId,
      // teamId and departmentId only narrow it, they never bypass it.
      const tasks = await storage.getVisibleTasksForUser({
        userId,
        role: req.user?.role,
        status: q.status,
        priority: q.priority,
        category: q.category,
        search: q.search,
        assigneeId: q.assigneeId,
        teamId: q.teamId,
        departmentId: q.departmentId,
        includeOwn: q.mine !== "false",
        limit: q.limit,
        offset: q.offset,
      });
      return res.json(tasks);
    } catch (error) {
      next(error);
    }
  });

  // Tickets assigned to the caller (user assignments only; assignedToUserSql
  // inside getVisibleTasksForUser), narrowed by the same validated filters.
  app.get("/api/tasks/my", isAuthenticated, async (req: any, res, next) => {
    try {
      const userId = getUserId(req);
      const q = ticketListQuerySchema.parse(req.query);
      const tasks = await storage.getVisibleTasksForUser({
        userId,
        role: req.user?.role,
        assigneeId: userId,
        status: q.status,
        priority: q.priority,
        category: q.category,
        search: q.search,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(tasks);
    } catch (error) {
      next(error);
    }
  });

  // Tickets in user's team queues
  app.get("/api/tasks/my-groups", isAuthenticated, async (req: any, res, next) => {
    try {
      const userId = getUserId(req);
      const q = ticketListQuerySchema.parse(req.query);
      // Team queues and teammates' tickets: visible tickets that are not mine
      const tasks = await storage.getVisibleTasksForUser({
        userId,
        role: req.user?.role,
        status: q.status,
        priority: q.priority,
        category: q.category,
        search: q.search,
        includeOwn: false,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(tasks);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tasks/:id", isAuthenticated, requireTaskAccess(), async (req: any, res, next) => {
    try {
      const taskId = parseInt(req.params.id);
      res.json(await getTicket(req.user, taskId));
    } catch (error) {
      // A refusal the service names (404) goes to the error contract; anything else stays a 500.
      if (error instanceof TicketError) return next(ticketErrorToHttp(error));
      logRouteError("Error fetching task", error);
      fail(res, 500, "Failed to fetch task");
    }
  });

  // Ticket meta endpoints for create/edit modals
  app.get("/api/tickets/meta", isAuthenticated, async (req: any, res, next) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (!user) return res.status(401).json({ error: "unauthorized", message: "Unauthorized" });
      const meta = await buildTicketMeta(user);
      if (!meta) return res.status(403).json({ error: "forbidden", message: "Your role cannot use tickets" });
      return res.json(meta);
    } catch (error) {
      return next(error);
    }
  });

  // Per-ticket meta: the base meta plus what THIS caller may do on THIS ticket,
  // from the same field table and workflow PATCH enforces. No HTTP self-fetch.
  app.get("/api/tickets/:id/meta", isAuthenticated, requireTaskAccess(), async (req: any, res, next) => {
    try {
      const taskId = parseInt(req.params.id);
      const user = await storage.getUser(getUserId(req));
      if (!user) return res.status(401).json({ error: "unauthorized", message: "Unauthorized" });
      const baseMeta = await buildTicketMeta(user);
      if (!baseMeta) return res.status(403).json({ error: "forbidden", message: "Your role cannot use tickets" });

      const task = await storage.getTask(taskId);
      if (!task) return res.status(404).json({ error: "not_found", message: "Ticket not found" });

      const ticketMeta = getTicketMetaForUser(user, task);
      const role = normalizeRole(user.role);
      const permissions = {
        ...baseMeta.permissions,
        canAssign: role === "admin" || role === "manager",
        canChangeStatus: ticketMeta.allowedStatuses.length > 0,
        allowedAssigneeTypes: ticketMeta.allowedAssigneeTypes,
        allowedFields: ticketMeta.allowedFields,
        allowedStatuses: ticketMeta.allowedStatuses,
      };

      return res.json({
        ...baseMeta,
        taskSummary: {
          id: task.id,
          status: task.status,
          assigneeType: task.assigneeType,
          assigneeId: task.assigneeId,
          assigneeTeamId: task.assigneeTeamId,
        },
        permissions,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    "/api/tasks",
    isAuthenticated,
    upload.array("files", maxFilesPerRequest),
    async (req: any, res, next) => {
      try {
        const userId = getUserId(req);
        const files = req.files as Express.Multer.File[] | undefined;
        const user = req.user as User;
        const isCustomer = user?.role === "customer";

        // Validate before anything is uploaded or written (ticketService owns the rules):
        // server-owned fields are rejected, customers cannot set hours, and assignee checks
        // (existence, ruling R16) run. The customer flow rewrites its assignment below, so
        // its assignment is checked on the final body.
        await prepareTicketCreate(user, req.body ?? {}, { skipAssignment: isCustomer });

        // 1. Validate S3 configuration if files provided
        if (files && files.length > 0) {
          const s3Config = await s3Service.isConfigured();
          if (!s3Config.isConfigured) {
            if (user?.role === "admin") {
              return res.status(503).json({
                message: "File storage is not configured",
                error: "S3_CONFIGURATION_REQUIRED",
                details: `Missing configuration: ${s3Config.missing.join(
                  ", "
                )}. Please configure AWS S3 credentials in environment variables.`,
              });
            } else {
              return res.status(503).json({
                message:
                  "File attachment is not available. Please contact your administrator",
                error: "S3_CONFIGURATION_REQUIRED",
              });
            }
          }

          // Validate file sizes
          const companySettings = await storage.getCompanySettings();
          const maxSizeMB = companySettings?.maxFileUploadSize || 10;
          const maxSizeBytes = maxSizeMB * 1024 * 1024;

          for (const file of files) {
            if (file.size > maxSizeBytes) {
              return fail(res, 400, `File ${file.originalname} exceeds ${maxSizeMB}MB limit`);
            }
          }
        }

        // 2. Upload files to S3 (if provided)
        const uploadedFiles: Array<{
          s3Key: string;
          fileName: string;
          fileSize: number;
          fileType: string;
        }> = [];
        if (files && files.length > 0) {
          try {
            // Get company name for path structure
            const companySettings = await storage.getCompanySettings();
            const companyName =
              companySettings?.companyName || DEFAULT_COMPANY.NAME;
            const sanitizedCompanyName = sanitizeCompanyNameForS3(companyName);

            for (const file of files) {
              const timestamp = Date.now();
              const sanitizedFileName = file.originalname.replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
              );
              // Use company name, date folder, and timestamp
              const dateFolder = getDateFolder();
              const s3Key = `${sanitizedCompanyName}/${dateFolder}/${timestamp}-${sanitizedFileName}`;

              await s3Service.uploadFile(s3Key, file.buffer, file.mimetype);
              uploadedFiles.push({
                s3Key,
                fileName: file.originalname,
                fileSize: file.size,
                fileType: file.mimetype,
              });
            }
          } catch (error: any) {
            // Cleanup uploaded files
            for (const file of uploadedFiles) {
              await s3Service.deleteFile(file.s3Key).catch(() => {});
            }
            logRouteError("Ticket attachment upload failed", error);
            return fail(res, 500, "File upload failed", { code: "upload_failed" });
          }
        }

        // Customer create: support user, team, department-only, unassigned
        if (isCustomer) {
          const { assigneeType, assigneeId, teamId, departmentId } =
            req.body || {};
          const parsedTeamId = teamId ? parseInt(teamId) : undefined;
          const parsedDeptId = departmentId
            ? parseInt(departmentId)
            : undefined;

          if (assigneeType === "user") {
            if (!assigneeId) {
              return fail(res, 400, "assigneeId is required for user assignment");
            }
            req.body.assigneeId = String(assigneeId);
            req.body.assigneeTeamId = null;
            req.body.teamId = undefined;
            // departmentId optional
          } else if (assigneeType === "team" || parsedTeamId) {
            if (!parsedTeamId) {
              return fail(res, 400, "teamId is required for team assignment");
            }
            const team = await storage.getTeam(parsedTeamId);
            if (!team) return fail(res, 400, "Invalid team");
            if (parsedDeptId) {
              const dept = await storage.getDepartmentById(parsedDeptId);
              if (!dept || (dept as any).isActive === false) {
                return fail(res, 400, "Invalid or inactive department");
              }
              if (
                (team as any).departmentId &&
                (team as any).departmentId !== parsedDeptId
              ) {
                return fail(res, 400, "Team does not belong to the selected department");
              }
            }
            req.body.assigneeType = "team";
            req.body.assigneeTeamId = parsedTeamId;
            req.body.assigneeId = null;
            // If department not provided, try deriving from team
            if (!parsedDeptId && (team as any).departmentId) {
              req.body.departmentId = (team as any).departmentId;
            }
          } else if (parsedDeptId) {
            const dept = await storage.getDepartmentById(parsedDeptId);
            if (!dept || (dept as any).isActive === false) {
              return fail(res, 400, "Invalid or inactive department");
            }
            // Department-only routing: clear team and assignee fields
            req.body.teamId = null;
            req.body.assigneeId = null;
            req.body.assigneeTeamId = null;
            // assigneeType can be omitted
          } else {
            // Unassigned: clear all assignment fields
            req.body.assigneeId = null;
            req.body.assigneeTeamId = null;
            req.body.departmentId = null;
            req.body.teamId = null;
          }
        }

        // The customer routing above may have rewritten the body: validate the
        // final shape, then keep one assignee kind (the same rule as update).
        // Hooks run after the attachments are linked, below.
        const task = await createTicket(user, req.body, { runHooks: false });

        // 4. Create attachment records (if files provided)
        const attachmentErrors: string[] = [];
        if (uploadedFiles.length > 0) {
          for (const file of uploadedFiles) {
            try {
              await storage.addTaskAttachment({
                taskId: task.id,
                userId,
                fileName: file.fileName,
                fileSize: file.fileSize,
                fileType: file.fileType,
                fileUrl: file.s3Key,
              });
            } catch (error) {
              attachmentErrors.push(file.fileName);
              logRouteError("Failed to create attachment record", error);
            }
          }
        }

        // After-create effects shared with inbound email: AI auto-response (settings,
        // never fails the create), realtime broadcast to everyone who can see the
        // ticket, and Teams webhooks whose owner can access it.
        // R34: the Teams link's origin is APP_BASE_URL, never the request's Host header.
        await runTicketCreatedHooks(task, userId, publicBaseUrl(req));

        // Return task with warning if some attachments failed
        if (attachmentErrors.length > 0) {
          return res.status(201).json({
            ...task,
            warning: `Some attachments failed to link: ${attachmentErrors.join(
              ", "
            )}`,
          });
        }

        res.status(201).json(task);
      } catch (error) {
        // Validation and permission failures go to the error contract (400/403 with details);
        // anything else gets the shared 500 without internals.
        return next(ticketErrorToHttp(error));
      }
    }
  );

  app.patch("/api/tasks/:id", isAuthenticated, requireTaskAccess(), async (req: any, res, next) => {
    try {
      // Access, the role's field table, the status workflow, the write and its
      // notifications are ticketService.updateTicket; this is the HTTP adapter.
      const { ticket } = await updateTicket(req.user, parseInt(req.params.id), req.body, {
        actionBaseUrl: publicBaseUrl(req),
        onStatusRefusal: ({ from, to }) =>
          logSecurityEvent(req as any, "change_status", "ticket", false, {
            from,
            to,
            taskId: parseInt(req.params.id),
          }),
      });
      res.json(ticket);
    } catch (error) {
      // Anything else goes to the shared error contract (500 without internals).
      return next(ticketErrorToHttp(error));
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, requireTaskAccess(), async (req: any, res, next) => {
    try {
      await deleteTicket(req.user, parseInt(req.params.id), true);
      res.status(204).send();
    } catch (error) {
      next(ticketErrorToHttp(error));
    }
  });

  // Ticket history (same access rule as GET /api/tasks/:id), oldest first.
  app.get("/api/tasks/:id/history", isAuthenticated, requireTaskAccess(), async (req: any, res, next) => {
    try {
      const history = await storage.getTaskHistory(parseInt(req.params.id));
      res.json(
        history.map((h) => ({
          ...h,
          user: h.user ? projectUserForViewer(req.user?.role, h.user) : undefined,
        }))
      );
    } catch (error) {
      next(error);
    }
  });

  // Task comments
  app.get("/api/tasks/:id/comments", isAuthenticated, requireTaskAccess(), async (req: any, res, next) => {
    try {
      const taskId = parseInt(req.params.id);
      const comments = await storage.getTaskComments(taskId);
      res.json(
        comments.map((c) => ({
          ...c,
          user: c.user ? projectUserForViewer(req.user?.role, c.user) : undefined,
        }))
      );
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/tasks/:id/comments",
    isAuthenticated,
    requireTaskAccess(),
    async (req: any, res, next) => {
      try {
        // ticketService.addComment: the body is only `content` (trimmed, 1..10000
        // characters); ticket and author come from the request, never from the client.
        const comment = await addComment(req.user, parseInt(req.params.id), req.body?.content);
        res.status(201).json(comment);
      } catch (error) {
        // Validation failures go to the shared error contract (400 / its status).
        next(ticketErrorToHttp(error));
      }
    }
  );

  // Admin routes
  app.get("/api/admin/users", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return fail(res, 403, "Forbidden");
      }

      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      logRouteError("Error fetching users", error);
      fail(res, 500, "Failed to fetch users");
    }
  });

  app.get("/api/admin/stats", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return fail(res, 403, "Forbidden");
      }

      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error) {
      logRouteError("Error fetching admin stats", error);
      fail(res, 500, "Failed to fetch stats");
    }
  });

  app.get("/api/admin/s3-usage", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return fail(res, 403, "Forbidden");
      }

      const stats = await storage.getS3UsageStats();
      res.json({
        ...stats,
        warning:
          "Note: Some files may have been deleted from S3 but are still counted in statistics",
      });
    } catch (error) {
      logRouteError("Error fetching S3 usage stats", error);
      fail(res, 500, "Failed to fetch S3 usage stats");
    }
  });

  app.patch(
    "/api/admin/users/:userId",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return fail(res, 403, "Forbidden");
        }

        const { userId } = req.params;
        // Only these fields are read; anything else in the body is dropped.
        const updates = adminUserUpdateSchema.parse(req.body ?? {});

        const target = await storage.getUser(userId);
        if (!target) {
          throw new HttpError(404, "user_not_found", "User not found");
        }

        // An active admin must stay: never leave zero, and never let an admin
        // demote or deactivate themselves.
        const losesAdmin =
          target.role === "admin" &&
          target.isActive !== false &&
          ((updates.role !== undefined && updates.role !== "admin") ||
            updates.isActive === false);
        if (losesAdmin) {
          const [others] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(users)
            .where(
              and(
                eq(users.role, "admin"),
                eq(users.isActive, true),
                ne(users.id, userId),
                excludeSystemAccounts()
              )
            );
          if (!others || others.n === 0) {
            throw new HttpError(409, "last_admin", "This is the last active administrator");
          }
          if (userId === getUserId(req)) {
            throw new HttpError(409, "self_demotion", "You cannot demote or deactivate your own account");
          }
        }

        // updateUserProfile also drops the user's open sockets on a role change.
        const updatedUser = await storage.updateUserProfile(userId, updates);
        res.json(updatedUser);
      } catch (error) {
        if ((error as { code?: string })?.code === "23505") {
          return next(new HttpError(409, "email_in_use", "That email address is already in use"));
        }
        next(error);
      }
    }
  );

  app.post(
    "/api/admin/users/:userId/toggle-status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return fail(res, 403, "Forbidden");
        }

        const { userId } = req.params;
        const updatedUser = await storage.toggleUserStatus(userId);
        res.json(updatedUser);
      } catch (error) {
        logRouteError("Error toggling user status", error);
        fail(res, 500, "Failed to toggle user status");
      }
    }
  );

  app.post(
    "/api/admin/users/:userId/approve",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return fail(res, 403, "Forbidden");
        }

        const { userId } = req.params;
        const updatedUser = await storage.approveUser(userId);
        res.json(updatedUser);
      } catch (error) {
        logRouteError("Error approving user", error);
        fail(res, 500, "Failed to approve user");
      }
    }
  );

  app.post(
    "/api/admin/users/:userId/assign-team",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const { userId } = req.params;
        const { teamId } = req.body;

        if (!teamId) {
          return fail(res, 400, "teamId is required");
        }

        const currentUserId = getUserId(req);
        const teamIdNum = parseInt(teamId);
        if (!Number.isInteger(teamIdNum) || teamIdNum <= 0) {
          return res.status(400).json({ error: "invalid_id", message: "teamId must be a positive integer" });
        }

        // R12: only an admin or the manager of the team's department may add
        // members (membership widens ticket visibility).
        const canChange = await canChangeTeamMembership(
          storage,
          currentUserId,
          teamIdNum
        );
        if (!canChange) {
          return res.status(403).json({
            error: "forbidden",
            message: "You don't have permission to assign users to this team",
          });
        }
        if (!(await storage.getUser(userId))) {
          return res.status(404).json({ error: "user_not_found", message: "User not found" });
        }

        // Role field removed - use team admins endpoints instead
        const teamMember = await storage.assignUserToTeam(
          userId,
          teamIdNum,
          undefined
        );
        res.json(teamMember);
      } catch (error) {
        if (error instanceof HttpError) return next(error);
        logRouteError("Error assigning user to team", error);
        fail(res, 500, "Failed to assign user to team");
      }
    }
  );

  app.delete(
    "/api/admin/users/:userId/remove-team/:teamId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { userId, teamId } = req.params;
        const teamIdNum = parseInt(teamId);

        if (isNaN(teamIdNum)) {
          return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
        }

        const currentUserId = getUserId(req);

        // R12: same rule as adding a member.
        const canChange = await canChangeTeamMembership(
          storage,
          currentUserId,
          teamIdNum
        );
        if (!canChange) {
          return res.status(403).json({
            error: "forbidden",
            message: "You don't have permission to remove users from this team",
          });
        }

        // Also remove from team_admins if user is an admin
        const isAdmin = await storage.isTeamAdmin(userId, teamIdNum);
        if (isAdmin) {
          await storage.removeTeamAdmin(userId, teamIdNum);
        }

        await storage.removeUserFromTeam(userId, teamIdNum);
        res.status(204).send();
      } catch (error) {
        logRouteError("Error removing user from team", error);
        fail(res, 500, "Failed to remove user from team");
      }
    }
  );

  app.post(
    "/api/admin/users/:userId/reset-password",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return fail(res, 403, "Forbidden");
        }

        const { userId } = req.params;
        const target = await storage.getUser(userId);
        if (!target) {
          return res
            .status(404)
            .json({ error: "user_not_found", message: "User not found" });
        }
        // SSO and the system user have no local password: never give them one.
        if (!target.password) {
          return res.status(409).json({
            error: "no_local_password",
            message:
              "This account has no local password (single sign-on or system account).",
          });
        }
        // Strong random temporary password, hashed with the login routine,
        // shown to the admin once; the user must change it at next sign-in.
        const tempPassword = randomBytes(15).toString("base64url");
        const updated = await storage.setTemporaryPassword(
          userId,
          await hashPassword(tempPassword)
        );
        if (!updated) {
          return res
            .status(404)
            .json({ error: "user_not_found", message: "User not found" });
        }
        logSecurityEvent(
          req,
          "admin_reset_password",
          "user",
          true,
          { adminId: getUserId(req), targetUserId: userId }
        );
        res.set("Cache-Control", "no-store");
        res.json({ tempPassword });
      } catch (error) {
        logRouteError("Error resetting password", error);
        fail(res, 500, "Failed to reset password");
      }
    }
  );

  // Statistics
  app.get("/api/stats", isAuthenticated, async (req: any, res) => {
    try {
      // Same visibility rule as GET /api/tasks for this caller (admin: every ticket).
      const stats = await storage.getTaskStats({
        id: getUserId(req),
        role: req.user?.role,
      });
      res.json(stats);
    } catch (error) {
      logRouteError("Error fetching stats", error);
      fail(res, 500, "Failed to fetch statistics");
    }
  });

  // Counts over every ticket: admin only (everyone else has scoped stats).
  app.get("/api/stats/global", isAuthenticated, async (req, res) => {
    try {
      if (normalizeRole(req.user?.role) !== "admin") {
        return res
          .status(403)
          .json({ error: "forbidden", message: "Only administrators can read global statistics" });
      }
      const stats = await storage.getTaskStats({
        id: (req.user as { id: string }).id,
        role: req.user?.role,
      });
      res.json(stats);
    } catch (error) {
      logRouteError("Error fetching global stats", error);
      fail(res, 500, "Failed to fetch global statistics");
    }
  });

  // Activity: history of the tickets the user may see (same rule as GET /api/tasks/:id)
  app.get("/api/activity", isAuthenticated, async (req, res) => {
    try {
      const requested = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit =
        Number.isFinite(requested) && requested > 0 ? Math.min(requested, 1000) : 10;
      const activity = await storage.getRecentActivity(
        { id: getUserId(req), role: req.user?.role },
        limit
      );
      res.json(activity);
    } catch (error) {
      logRouteError("Error fetching activity", error);
      fail(res, 500, "Failed to fetch activity");
    }
  });

  // Attachment routes
  app.get(
    "/api/tasks/:id/attachments",
    isAuthenticated,
    requireTaskAccess(),
    async (req: any, res) => {
      try {
        const taskId = parseInt(req.params.id);
        const attachments = await storage.getTaskAttachments(taskId);

        // Generate presigned URLs for each attachment
        const attachmentsWithUrls = await Promise.all(
          attachments.map(async (attachment: any) => {
            try {
              const s3Key = s3Service.extractKeyFromUrl(attachment.fileUrl);
              const presignedUrl = await s3Service.getPresignedUrl(s3Key, 3600); // 1 hour expiry
              return {
                ...attachment,
                fileUrl: presignedUrl, // Replace S3 key with presigned URL
              };
            } catch (error) {
              logRouteError(`Failed to generate presigned URL for attachment ${attachment.id}`, error);
              // Return attachment with original fileUrl if presigned URL generation fails
              return attachment;
            }
          })
        );

        res.json(attachmentsWithUrls);
      } catch (error) {
        logRouteError("Error fetching attachments", error);
        fail(res, 500, "Failed to fetch attachments");
      }
    }
  );

  app.post(
    "/api/tasks/:id/attachments",
    isAuthenticated,
    requireTaskAccess(), // before multer: no upload is parsed for a ticket outside scope
    upload.single("file"),
    async (req: any, res) => {
      try {
        const taskId = parseInt(req.params.id);
        const userId = getUserId(req);
        const user = req.user;

        // Check if S3 is configured
        const s3Config = await s3Service.isConfigured();
        if (!s3Config.isConfigured) {
          // Return different messages based on user role
          if (user?.role === "admin") {
            return res.status(503).json({
              message: "File storage is not configured",
              error: "S3_CONFIGURATION_REQUIRED",
              details: `Missing configuration: ${s3Config.missing.join(
                ", "
              )}. Please configure AWS S3 credentials in environment variables.`,
            });
          } else {
            return res.status(503).json({
              message:
                "File storage is not available. Please contact your administrator to configure file storage.",
              error: "S3_CONFIGURATION_REQUIRED",
            });
          }
        }

        // Check if file was uploaded
        if (!req.file) {
          return fail(res, 400, "File is required");
        }

        // Validate file size (use company settings if available)
        const companySettings = await storage.getCompanySettings();
        const maxSizeMB = companySettings?.maxFileUploadSize || 10;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (req.file.size > maxSizeBytes) {
          return fail(res, 400, `File size exceeds ${maxSizeMB}MB limit`);
        }

        // Get company name for path structure
        const companyName =
          companySettings?.companyName || DEFAULT_COMPANY.NAME;
        const sanitizedCompanyName = sanitizeCompanyNameForS3(companyName);

        // Generate S3 key for the file
        const timestamp = Date.now();
        const sanitizedFileName = req.file.originalname.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );
        // Use company name, date folder, and timestamp
        const dateFolder = getDateFolder();
        const s3Key = `${sanitizedCompanyName}/${dateFolder}/${timestamp}-${sanitizedFileName}`;

        // Upload to S3
        await s3Service.uploadFile(s3Key, req.file.buffer, req.file.mimetype);

        // Store attachment metadata in database
        const attachmentData = insertTaskAttachmentSchema.parse({
          fileName: req.file.originalname,
          fileSize: req.file.size,
          fileType: req.file.mimetype,
          fileUrl: s3Key, // Store S3 key
          taskId,
          userId,
        });
        const attachment = await storage.addTaskAttachment(attachmentData);
        res.status(201).json(attachment);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return fail(res, 400, "Invalid attachment data", { details: error.flatten() });
        }
        logRouteError("Error creating attachment", error);

        // Check if it's an S3 configuration error
        if (
          error instanceof Error &&
          error.message.includes("S3 bucket name not configured")
        ) {
          const user = await storage.getUser(getUserId(req));
          if (user?.role === "admin") {
            return res.status(503).json({
              message: "File storage is not configured",
              error: "S3_CONFIGURATION_REQUIRED",
              details:
                "AWS_S3_BUCKET_NAME is not set. Please configure S3 bucket name in environment variables.",
            });
          } else {
            return res.status(503).json({
              message:
                "File storage is not available. Please contact your administrator to configure file storage.",
              error: "S3_CONFIGURATION_REQUIRED",
            });
          }
        }

        fail(res, 500, "Failed to create attachment");
      }
    }
  );

  // GET /api/attachments/:id/download - Download attachment with presigned URL
  app.get(
    "/api/attachments/:id/download",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const attachmentId = parseInt(req.params.id);

        // Get attachment from database by ID
        const [attachment] = await db
          .select()
          .from(taskAttachments)
          .where(eq(taskAttachments.id, attachmentId))
          .limit(1);

        if (!attachment) {
          return res.status(404).json({ error: "not_found", message: "Attachment not found" });
        }

        // The attachment's ticket must be inside the user's scope
        await assertTaskAccess(req.user, attachment.taskId);

        // Generate presigned URL for S3 object
        const s3Key = s3Service.extractKeyFromUrl(attachment.fileUrl);
        const presignedUrl = await s3Service.getPresignedUrl(s3Key, 3600); // 1 hour expiry

        // Fetch the file from S3 and stream it to the client
        const s3Response = await fetch(presignedUrl);
        if (!s3Response.ok) {
          return fail(res, 500, "Failed to fetch file from storage", {
            code: "storage_error",
          });
        }

        // Set headers for file download
        res.setHeader(
          "Content-Type",
          attachment.fileType || "application/octet-stream"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(attachment.fileName)}"`
        );
        res.setHeader("Content-Length", attachment.fileSize.toString());

        // Stream the file to the client
        const buffer = await s3Response.arrayBuffer();
        res.send(Buffer.from(buffer));
      } catch (error) {
        if (error instanceof HttpError) return next(error);
        logRouteError("Error generating download URL", error);
        fail(res, 500, "Failed to generate download URL");
      }
    }
  );

  app.delete("/api/attachments/:id", isAuthenticated, async (req: any, res, next) => {
    try {
      const attachmentId = parseInt(req.params.id);
      const userId = getUserId(req);
      const role = normalizeRole(req.user?.role);

      // Get attachment to check permissions and get S3 key
      const [attachment] = await db
        .select()
        .from(taskAttachments)
        .where(eq(taskAttachments.id, attachmentId))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "not_found", message: "Attachment not found" });
      }

      // The ticket must be inside the user's scope; then only the uploader,
      // an admin or a manager may delete.
      await assertTaskAccess(req.user, attachment.taskId);
      if (attachment.userId !== userId && role !== "admin" && role !== "manager") {
        return res.status(403).json({
          error: "forbidden",
          message: "Only the uploader, a manager or an administrator can delete this attachment",
        });
      }

      // Delete from S3 if it's an S3 URL
      if (s3Service.isS3Url(attachment.fileUrl)) {
        try {
          const s3Key = s3Service.extractKeyFromUrl(attachment.fileUrl);
          await s3Service.deleteFile(s3Key);
        } catch (error) {
          logRouteError("Failed to delete file from S3", error);
          // Continue with database deletion even if S3 delete fails
        }
      }

      // Delete from database
      await storage.deleteTaskAttachment(attachmentId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof HttpError) return next(error);
      logRouteError("Error deleting attachment", error);
      fail(res, 500, "Failed to delete attachment");
    }
  });

  // Company settings routes moved to server/admin/settings.ts

  // Bedrock settings routes (admin only)
  app.get("/api/bedrock/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      let settings: any = undefined;
      try {
        settings = await storage.getBedrockSettings();
      } catch (e: any) {
        // If table doesn't exist yet (e.g., fresh DB without push), return empty settings
        const code = String(e?.code || "");
        const msg = String(e?.message || "");
        if (code === "42P01" || msg.includes('relation "bedrock_settings"')) {
          return res.json({});
        }
        throw e;
      }
      if (!settings) return res.json({});
      res.json({
        bedrockAccessKeyId: settings.bedrockAccessKeyId || "",
        bedrockRegion: settings.bedrockRegion || "us-east-1",
        bedrockModelId:
          settings.bedrockModelId || "amazon.titan-text-express-v1",
        hasBedrockSecret: !!settings.bedrockSecretAccessKey,
      });
    } catch (error) {
      logRouteError("Error fetching Bedrock settings", error);
      fail(res, 500, "Failed to fetch Bedrock settings");
    }
  });

  app.post("/api/bedrock/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const current = await storage.getBedrockSettings();
      const merged = {
        bedrockAccessKeyId:
          req.body.bedrockAccessKeyId ?? current?.bedrockAccessKeyId ?? "",
        bedrockSecretAccessKey:
          req.body.bedrockSecretAccessKey !== undefined &&
          req.body.bedrockSecretAccessKey !== ""
            ? req.body.bedrockSecretAccessKey
            : current?.bedrockSecretAccessKey ?? "",
        bedrockRegion:
          req.body.bedrockRegion ?? current?.bedrockRegion ?? "us-east-1",
        bedrockModelId:
          req.body.bedrockModelId ??
          current?.bedrockModelId ??
          "amazon.titan-text-express-v1",
        isActive: true,
      };
      const saved = await storage.updateBedrockSettings(merged as any, userId);
      res.json({
        bedrockAccessKeyId: saved.bedrockAccessKeyId || "",
        bedrockRegion: saved.bedrockRegion || "us-east-1",
        bedrockModelId: saved.bedrockModelId || "amazon.titan-text-express-v1",
        hasBedrockSecret: !!saved.bedrockSecretAccessKey,
      });
    } catch (error) {
      logRouteError("Error updating Bedrock settings", error);
      fail(res, 500, "Failed to update Bedrock settings");
    }
  });

  // SMTP, SSO, Email Template routes moved to server/admin/settings.ts

  // AI Settings (admin only)
  app.get("/api/admin/ai-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const settings = await getAISettings();
      res.json(settings);
    } catch (error) {
      logRouteError("Error fetching AI settings", error);
      fail(res, 500, "Failed to fetch AI settings");
    }
  });

  app.put("/api/admin/ai-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // Validate escalation team if provided
      if (
        req.body.escalationTeamId !== undefined &&
        req.body.escalationTeamId !== null
      ) {
        const teamId = Number(req.body.escalationTeamId);
        if (isNaN(teamId)) {
          return fail(res, 400, "Invalid escalation team ID");
        }

        // Check if team exists
        const team = await storage.getTeam(teamId);
        if (!team) {
          return fail(res, 400, "Escalation team not found");
        }

        // Verify team has a department (required by schema)
        if (!team.departmentId) {
          return fail(res, 400, "Escalation team must belong to a department");
        }

        // Verify department exists and is active
        const department = await storage.getDepartmentById(team.departmentId);
        if (!department) {
          return fail(res, 400, "Escalation team's department not found");
        }
        if (!department.isActive) {
          return fail(res, 400, "Escalation team's department is not active");
        }
      }

      const next = validateAISettings({
        ...(await getAISettings()),
        ...(req.body || {}),
      });
      const saved = await saveAISettings(next, userId);
      res.json(saved);
    } catch (error) {
      logRouteError("Error updating AI settings", error);
      fail(res, 500, "Failed to update AI settings");
    }
  });

  app.post(
    "/api/admin/ai-settings/test",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const ok = await bedrockIntegration.testConnection();
        if (ok) {
          return res.json({ success: true });
        }
        return fail(res, 400, "Bedrock test failed", { code: "bedrock_test_failed" });
      } catch (error: any) {
        logRouteError("Error testing Bedrock connection", error);
        fail(res, 500, "Failed to test Bedrock");
      }
    }
  );

  // Email template routes

  // Get all email templates (admin only)
  app.get("/api/email-templates", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const templates = await storage.getEmailTemplates();
      res.json(templates);
    } catch (error) {
      logRouteError("Error fetching email templates", error);
      fail(res, 500, "Failed to fetch email templates");
    }
  });

  // Update email template (admin only)
  app.put("/api/email-templates/:name", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const { name } = req.params;
      const template = await storage.updateEmailTemplate(
        name,
        req.body,
        userId
      );
      res.json(template);
    } catch (error) {
      logRouteError("Error updating email template", error);
      fail(res, 500, "Failed to update email template");
    }
  });

  // Help documentation routes

  // Notifications endpoints (optional persistence)
  app.get("/api/notifications", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const limit = req.query.limit ? parseInt(req.query.limit) : 5;
      const unreadOnly = (req.query.read as string) === "false";
      if (!unreadOnly) {
        // For now, only support unread in this minimal implementation
      }
      const notifications = await storage.getUnreadNotifications(userId, limit);
      res.json(notifications);
    } catch (error) {
      logRouteError("Error fetching notifications", error);
      fail(res, 500, "Failed to fetch notifications");
    }
  });

  app.patch(
    "/api/notifications/:id/read",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id);
        await storage.markNotificationRead(id);
        res.json({ success: true });
      } catch (error) {
        logRouteError("Error marking notification read", error);
        fail(res, 500, "Failed to mark notification read");
      }
    }
  );

  app.patch(
    "/api/notifications/read-all",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        await storage.markAllNotificationsRead(userId);
        res.json({ success: true });
      } catch (error) {
        logRouteError("Error marking all notifications read", error);
        fail(res, 500, "Failed to mark all notifications read");
      }
    }
  );

  // Get all help documents (admin)
  app.get("/api/admin/help", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const documents = await storage.getHelpDocuments();
      res.json(documents);
    } catch (error) {
      logRouteError("Error fetching help documents (admin)", error);
      fail(res, 500, "Failed to fetch help documents");
    }
  });

  // Get all help documents (any signed-in user)
  app.get("/api/help", isAuthenticated, async (req, res) => {
    try {
      const documents = await storage.getHelpDocuments();
      res.json(documents);
    } catch (error) {
      logRouteError("Error fetching help documents", error);
      fail(res, 500, "Failed to fetch help documents");
    }
  });

  // Search help documents (any signed-in user)
  app.get("/api/help/search", isAuthenticated, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return fail(res, 400, "Search query is required");
      }

      const documents = await storage.searchHelpDocuments(q);
      res.json(documents);
    } catch (error) {
      logRouteError("Error searching help documents", error);
      fail(res, 500, "Failed to search help documents");
    }
  });

  // Get single help document (any signed-in user)
  app.get("/api/help/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getHelpDocument(id);

      if (!document) {
        return fail(res, 404, "Help document not found");
      }

      // Increment view count
      await storage.incrementViewCount(id);

      res.json(document);
    } catch (error) {
      logRouteError("Error fetching help document", error);
      fail(res, 500, "Failed to fetch help document");
    }
  });

  // Upload help document (admin only)
  app.post("/api/admin/help", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const { title, filename, content, fileData, category, tags } = req.body;

      if (!title || !filename || !content || !fileData) {
        return fail(res, 400, "Title, filename, content, and file data are required");
      }

      const document = await storage.createHelpDocument({
        title,
        filename,
        content,
        fileData,
        category,
        tags,
        uploadedBy: userId,
      });

      res.json(document);
    } catch (error) {
      logRouteError("Error creating help document", error);
      fail(res, 500, "Failed to create help document");
    }
  });

  // Update help document (admin only)
  app.put("/api/admin/help/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const id = parseInt(req.params.id);
      const updates = req.body;

      const document = await storage.updateHelpDocument(id, updates);
      res.json(document);
    } catch (error) {
      logRouteError("Error updating help document", error);
      fail(res, 500, "Failed to update help document");
    }
  });

  // Delete help document (admin only)
  app.delete("/api/admin/help/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const id = parseInt(req.params.id);
      await storage.deleteHelpDocument(id);

      res.json({ message: "Help document deleted successfully" });
    } catch (error) {
      logRouteError("Error deleting help document", error);
      fail(res, 500, "Failed to delete help document");
    }
  });

  // User Guide routes

  // Get all guide categories
  app.get("/api/guide-categories", isAuthenticated, async (req, res) => {
    try {
      const categories = await storage.getUserGuideCategories();
      res.json(categories);
    } catch (error) {
      logRouteError("Error fetching guide categories", error);
      fail(res, 500, "Failed to fetch guide categories");
    }
  });

  // Guide HTML is rendered as HTML by the client, so it is sanitised with an
  // allow-list on the way in (admin routes below) AND on the way out (rows
  // stored before sanitising existed).
  const publicGuide = <T extends { content: string }>(guide: T): T => ({
    ...guide,
    content: sanitizeRichHtml(guide.content),
  });

  // Get all guides. Staff may ask for drafts; everyone else sees only
  // published guides, whatever the query says.
  app.get("/api/guides", isAuthenticated, async (req, res) => {
    try {
      const { published } = req.query;
      const publishedOnly =
        !isStaffRole((req.user as any)?.role) || published === "true";
      const guides = await storage.getUserGuides(
        publishedOnly ? { isPublished: true } : undefined
      );
      res.json(guides.map(publicGuide));
    } catch (error) {
      logRouteError("Error fetching guides", error);
      fail(res, 500, "Failed to fetch guides");
    }
  });

  // Get single guide (a draft is 404 for non-staff)
  app.get("/api/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const guide = await storage.getUserGuideById(id);

      if (
        !guide ||
        (guide.isPublished !== true && !isStaffRole((req.user as any)?.role))
      ) {
        return fail(res, 404, "Guide not found");
      }

      // Increment view count
      await storage.incrementGuideViewCount(id);

      res.json(publicGuide(guide));
    } catch (error) {
      logRouteError("Error fetching guide", error);
      fail(res, 500, "Failed to fetch guide");
    }
  });

  // Create guide category (admin only)
  app.post("/api/admin/guide-categories", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const category = await storage.createUserGuideCategory(req.body);
      res.json(category);
    } catch (error) {
      logRouteError("Error creating guide category", error);
      fail(res, 500, "Failed to create guide category");
    }
  });

  // Update guide category (admin only)
  app.put(
    "/api/admin/guide-categories/:id",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const id = parseInt(req.params.id);
        const category = await storage.updateUserGuideCategory(id, req.body);
        res.json(category);
      } catch (error) {
        logRouteError("Error updating guide category", error);
        fail(res, 500, "Failed to update guide category");
      }
    }
  );

  // Delete guide category (admin only)
  app.delete(
    "/api/admin/guide-categories/:id",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const id = parseInt(req.params.id);
        await storage.deleteUserGuideCategory(id);
        res.json({ message: "Guide category deleted successfully" });
      } catch (error) {
        logRouteError("Error deleting guide category", error);
        fail(res, 500, "Failed to delete guide category");
      }
    }
  );

  // Create guide (admin only)
  app.post("/api/admin/guides", isAuthenticated, async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // content is required and must be text: without it the insert would
      // fail on the NOT NULL column as a 500.
      const { content } = z
        .object({ content: z.string().min(1) })
        .passthrough()
        .parse(req.body ?? {});

      const guide = await storage.createUserGuide({
        ...req.body,
        content: sanitizeRichHtml(content),
        createdBy: userId,
      });
      res.json(publicGuide(guide));
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      logRouteError("Error creating guide", error);
      fail(res, 500, "Failed to create guide");
    }
  });

  // Update guide (admin only)
  app.put("/api/admin/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const id = parseInt(req.params.id);
      const updates = { ...req.body };
      if ("content" in updates) {
        updates.content = sanitizeRichHtml(updates.content);
      }
      const guide = await storage.updateUserGuide(id, updates);
      res.json(guide ? publicGuide(guide) : guide);
    } catch (error) {
      logRouteError("Error updating guide", error);
      fail(res, 500, "Failed to update guide");
    }
  });

  // Delete guide (admin only)
  app.delete("/api/admin/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const id = parseInt(req.params.id);
      await storage.deleteUserGuide(id);
      res.json({ message: "Guide deleted successfully" });
    } catch (error) {
      logRouteError("Error deleting guide", error);
      fail(res, 500, "Failed to delete guide");
    }
  });

  // Helper function to normalize questions for FAQ caching
  function normalizeQuestion(question: string): string {
    return question
      .toLowerCase()
      .replace(/[^\w\s]/g, "") // Remove special characters
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();
  }

  // Helper function to calculate question hash
  function calculateQuestionHash(normalizedQuestion: string): string {
    return createHash("sha256").update(normalizedQuestion).digest("hex");
  }

  // Helper function to calculate token costs for Bedrock
  function _calculateBedrockCost(
    inputTokens: number,
    outputTokens: number,
    _modelId: string
  ): number {
    // Claude 3 Sonnet pricing per 1M tokens (as of 2024)
    const pricePerMillionInputTokens = 3.0; // $3 per 1M input tokens
    const pricePerMillionOutputTokens = 15.0; // $15 per 1M output tokens

    const inputCost = (inputTokens / 1_000_000) * pricePerMillionInputTokens;
    const outputCost = (outputTokens / 1_000_000) * pricePerMillionOutputTokens;

    return inputCost + outputCost;
  }

  // Helper function to estimate token count (rough approximation)
  function _estimateTokenCount(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  // AI Chat routes
  app.post("/api/chat", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { sessionId, message } = req.body;

      // Strict input validation
      if (!sessionId) {
        return fail(res, 400, "Session ID is required");
      }
      const rawMessage =
        typeof message === "string" ? message : String(message ?? "");
      const trimmedMessage = rawMessage.trim();
      if (trimmedMessage.length === 0 || trimmedMessage.length > 2000) {
        return fail(res, 400, "Message must be 1-2000 characters");
      }

      // Save user message
      await storage.createChatMessage({
        userId,
        sessionId,
        role: "user",
        content: trimmedMessage,
      });

      // Check FAQ cache first
      const normalizedQuestion = normalizeQuestion(trimmedMessage);
      const questionHash = calculateQuestionHash(normalizedQuestion);

      const cachedAnswer = await storage.getFaqCacheEntry(questionHash);
      if (cachedAnswer) {
        // Update hit count
        await storage.updateFaqCacheHit(cachedAnswer.id);

        // Save cached response
        const aiMessage = await storage.createChatMessage({
          userId,
          sessionId,
          role: "assistant",
          content: cachedAnswer.answer,
          relatedDocumentIds: [],
        });

        return res.json({
          message: aiMessage,
          relatedDocuments: [],
          fromCache: true,
        });
      }

      // Check if we have AWS Bedrock credentials (from Bedrock settings or env)
      const bedrock = await storage.getBedrockSettings();
      const hasBedrockCredentials =
        bedrock?.bedrockAccessKeyId &&
        bedrock?.bedrockSecretAccessKey &&
        (bedrock?.bedrockRegion || "us-east-1") &&
        bedrock?.isActive;

      let response = "";
      const relevantDocIds: number[] = [];
      let usageData = null;
      let aiSucceeded = false;

      if (hasBedrockCredentials) {
        // Use AWS Bedrock for intelligent responses
        try {
          // Import helper function (same pattern as knowledgeBaseLearning.ts)
          const { runChatPrompt } = await import(
            "../services/ai/bedrockIntegration"
          );

          // Get help documents for context
          const helpDocs = await storage.searchHelpDocuments(trimmedMessage);
          let context = "";

          if (helpDocs.length > 0) {
            context = "\n\nRelevant documentation context:\n";
            const topDocs = helpDocs.slice(0, 3);
            for (const doc of topDocs) {
              relevantDocIds.push(doc.id);
              context += `- ${doc.title}: ${doc.content.substring(
                0,
                200
              )}...\n`;
            }
          }

          let userMessage = trimmedMessage;
          if (context) {
            userMessage = `Context:\n${context}\n\nUser question: ${trimmedMessage}`;
          }

          // Use the helper function (handles model type, cost monitoring, token limits, etc.)
          const result = await runChatPrompt(
            PROMPT_TEMPLATES.aiChat,
            userMessage,
            userId
          );
          response = result.response;

          // Mark AI as successful if we got a valid response
          if (response && response.trim().length > 0) {
            aiSucceeded = true;
          }

          // Track usage using actual tokens from the result
          const { recordUsage } = await import("../services/ai/costMonitoring");
          await recordUsage(
            result.costEstimate.modelId,
            result.actualTokens.input,
            result.actualTokens.output,
            "aiChat",
            userId,
            undefined // ticketId not available in chat context
          );
          usageData = {
            userId,
            sessionId,
            inputTokens: result.actualTokens.input,
            outputTokens: result.actualTokens.output,
            totalTokens: result.actualTokens.input + result.actualTokens.output,
            modelId: result.costEstimate.modelId,
            cost: result.costEstimate.estimatedCost,
          };

          // Cache the response if it's a straightforward Q&A (not context-dependent)
          if (!context && response.length > 50) {
            await storage.createFaqCacheEntry({
              questionHash,
              originalQuestion: message,
              normalizedQuestion,
              answer: response,
            });
          }
        } catch (error: any) {
          // If AI fails, fall back to help documents search (same as "AI not configured")
          console.error(
            "Error calling AWS Bedrock, falling back to help documents:",
            describeAIError(error)
          );

          // Set flag to use fallback logic
          aiSucceeded = false;
          response = ""; // Clear any partial response
        }
      }

      // Fallback logic: Use help documents if AI is not configured OR if AI failed
      if (!hasBedrockCredentials || !aiSucceeded || !response) {
        // No AWS credentials configured - use simple fallback
        try {
          // 1) Try company help documents
          const helpDocs = await storage.searchHelpDocuments(trimmedMessage);

          if (helpDocs.length > 0) {
            response = "I found some relevant documentation:\n\n";
            const topDocs = helpDocs.slice(0, 3);

            for (const doc of topDocs) {
              relevantDocIds.push(doc.id);
              response += `**${doc.title}**\n`;
              const contentPreview =
                doc.content.substring(0, 300) +
                (doc.content.length > 300 ? "..." : "");
              response += `${contentPreview}\n\n`;
            }
          } else {
            // 2) Fallback to Knowledge Base articles (published)
            const kbArticles = await storage.searchKnowledgeBase(
              trimmedMessage
            );
            if (kbArticles.length > 0) {
              response = "Here are relevant knowledge base articles:\n\n";
              const topKb = kbArticles.slice(0, 3);
              for (const art of topKb) {
                response += `**${art.title}**\n`;
                const contentPreview =
                  (art.summary || art.content || "").substring(0, 300) +
                  ((art.summary || art.content || "").length > 300
                    ? "..."
                    : "");
                response += `${contentPreview}\n\n`;
              }
            } else {
              response =
                "I'm here to help! However, the AI service is not configured and I couldn't find any matching documents yet.";
            }
          }
        } catch (error) {
          logRouteError("Error searching help documents", error);
          response =
            "I'm experiencing technical difficulties. Please try again later.";
        }
      }

      // Save AI response
      const aiMessage = await storage.createChatMessage({
        userId,
        sessionId,
        role: "assistant",
        content: response,
        relatedDocumentIds:
          relevantDocIds.length > 0 ? relevantDocIds : undefined,
      });

      res.json({
        message: aiMessage,
        relatedDocuments: [],
        usageData: usageData
          ? {
              inputTokens: usageData.inputTokens,
              outputTokens: usageData.outputTokens,
              totalTokens: usageData.totalTokens,
              cost: usageData.cost,
            }
          : undefined,
      });
    } catch (error: any) {
      console.error("Error in chat:", describeAIError(error));
      fail(res, 500, "Failed to process chat message");
    }
  });

  // Get chat history
  app.get("/api/chat/:sessionId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { sessionId } = req.params;

      const messages = await storage.getChatMessages(userId, sessionId);
      res.json(messages);
    } catch (error) {
      logRouteError("Error fetching chat history", error);
      fail(res, 500, "Failed to fetch chat history");
    }
  });

  // Get chat sessions
  app.get("/api/chat-sessions", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const sessions = await storage.getChatSessions(userId);
      res.json(sessions);
    } catch (error) {
      logRouteError("Error fetching chat sessions", error);
      fail(res, 500, "Failed to fetch chat sessions");
    }
  });

  // API aliases for documentation parity
  // POST /api/ai/chat -> /api/chat (preserve method/body with 307)
  app.post("/api/ai/chat", isAuthenticated, async (req, res) => {
    return res.redirect(307, "/api/chat");
  });

  // GET /api/ai/chat/history/:sessionId -> /api/chat/:sessionId
  app.get(
    "/api/ai/chat/history/:sessionId",
    isAuthenticated,
    async (req, res) => {
      const { sessionId } = req.params as any;
      return res.redirect(307, `/api/chat/${sessionId}`);
    }
  );

  // Bedrock usage endpoints
  app.get("/api/bedrock/usage", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      // Allow users to see their own usage, admins to see all
      const targetUserId =
        user?.role === "admin" && req.query.userId
          ? (req.query.userId as string)
          : userId;

      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : undefined;

      const usage = await storage.getAIUsage({
        userId: targetUserId,
        startDate,
        endDate,
      });
      // Convert to legacy format for backward compatibility
      const legacyUsage = usage.map((u) => ({
        id: u.id,
        userId: u.userId,
        sessionId: "", // Not available in ai_usage
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.inputTokens + u.outputTokens,
        modelId: u.modelId,
        cost: Number(u.estimatedCost),
        createdAt: u.createdAt,
      }));
      res.json(legacyUsage);
    } catch (error) {
      console.error("Error fetching Bedrock usage:", describeAIError(error));
      fail(res, 500, "Failed to fetch Bedrock usage");
    }
  });

  // Cost monitoring and management endpoints
  app.get(
    "/api/bedrock/cost-statistics",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const stats = await bedrockIntegration.getCostStatistics();
        res.json(stats);
      } catch (error) {
        console.error("Error fetching cost statistics:", describeAIError(error));
        fail(res, 500, "Failed to fetch cost statistics");
      }
    }
  );

  app.put(
    "/api/bedrock/cost-limits",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const { dailyLimitUSD, monthlyLimitUSD, maxTokensPerRequest } =
          req.body;

        const updatedLimits = await bedrockIntegration.updateCostLimits(
          {
            dailyLimitUSD,
            monthlyLimitUSD,
            maxTokensPerRequest,
          },
          userId
        );

        res.json(updatedLimits);
      } catch (error) {
        console.error("Error updating cost limits:", describeAIError(error));
        fail(res, 500, "Failed to update cost limits");
      }
    }
  );

  app.post(
    "/api/bedrock/reset-usage",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        await bedrockIntegration.resetUsageData();
        res.json({ message: "Usage data reset successfully" });
      } catch (error) {
        console.error("Error resetting usage data:", describeAIError(error));
        fail(res, 500, "Failed to reset usage data");
      }
    }
  );

  app.get(
    "/api/bedrock/export-usage",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const { startDate, endDate } = req.query;
        const usageData = await bedrockIntegration.exportUsageData(
          startDate,
          endDate
        );

        res.json({
          data: usageData,
          exportedAt: new Date().toISOString(),
          dateRange: { startDate, endDate },
        });
      } catch (error) {
        logRouteError("Error exporting usage data", error);
        fail(res, 500, "Failed to export usage data");
      }
    }
  );

  app.get(
    "/api/bedrock/test-connection",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const result = await bedrockIntegration.testConnection();

        if (result.success) {
          res.json({
            success: true,
            message: "Bedrock connection successful",
            costEstimate: result.costEstimate,
          });
        } else {
          // Admin-only diagnostic: the test's own failure text is the payload.
          res.status(400).json({
            error: "bedrock_test_failed",
            success: false,
            message: result.error || "Bedrock test failed",
            costEstimate: result.costEstimate,
          });
        }
      } catch (error) {
        logRouteError("Error testing Bedrock connection", error);
        fail(res, 500, "Failed to test Bedrock connection");
      }
    }
  );

  // FAQ cache endpoints
  app.get("/api/faq-cache", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const popularFaqs = await storage.getPopularFaqs(limit);
      res.json(popularFaqs);
    } catch (error) {
      logRouteError("Error fetching FAQ cache", error);
      fail(res, 500, "Failed to fetch FAQ cache");
    }
  });

  app.delete("/api/faq-cache", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      await storage.clearFaqCache();
      res.json({ message: "FAQ cache cleared successfully" });
    } catch (error) {
      logRouteError("Error clearing FAQ cache", error);
      fail(res, 500, "Failed to clear FAQ cache");
    }
  });

  // Company Policy endpoints
  // Retired (inactive) policies are for admins only: everyone else gets the
  // active ones, and a retired policy is 404 by id and by download.
  const isAdminCaller = (req: any): boolean =>
    normalizeRole(req.user?.role) === "admin";

  app.get("/api/company-policies", isAuthenticated, async (req, res) => {
    try {
      const includeInactive =
        req.query.includeInactive === "true" && isAdminCaller(req);
      const policies = await storage.getAllCompanyPolicies(includeInactive);
      res.json(policies);
    } catch (error) {
      logRouteError("Error fetching company policies", error);
      fail(res, 500, "Failed to fetch company policies");
    }
  });

  app.get("/api/company-policies/:id", isAuthenticated, async (req, res) => {
    try {
      const policyId = parseInt(req.params.id);
      const policy = await storage.getCompanyPolicyById(policyId);

      if (!policy || (!policy.isActive && !isAdminCaller(req))) {
        return fail(res, 404, "Company policy not found");
      }

      res.json(policy);
    } catch (error) {
      logRouteError("Error fetching company policy", error);
      fail(res, 500, "Failed to fetch company policy");
    }
  });

  app.post(
    "/api/admin/company-policies",
    isAuthenticated,
    upload.single("file"),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        if (!req.file) {
          return fail(res, 400, "File is required");
        }

        const { description } = req.body;

        // Use filename (without extension) as title if not provided
        const title =
          req.body.title || req.file.originalname.replace(/\.[^/.]+$/, "");

        // Convert file to Base64 for storage
        const fileData = req.file.buffer.toString("base64");

        const policy = await storage.createCompanyPolicy({
          title,
          description,
          content: null, // Will be extracted later if it's a text-based file
          fileData,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          uploadedBy: userId,
          isActive: true,
        });

        res.json(policy);
      } catch (error) {
        logRouteError("Error creating company policy", error);
        fail(res, 500, "Failed to create company policy");
      }
    }
  );

  app.put(
    "/api/admin/company-policies/:id",
    isAuthenticated,
    upload.single("file"),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const policyId = parseInt(req.params.id);
        const { title, description } = req.body;

        const updateData: any = { title, description };

        if (req.file) {
          const fileData = req.file.buffer.toString("base64");
          updateData.fileData = fileData;
          updateData.content = null; // Will be extracted later if it's a text-based file
          updateData.fileName = req.file.originalname;
          updateData.fileSize = req.file.size;
          updateData.mimeType = req.file.mimetype;
        }

        const policy = await storage.updateCompanyPolicy(policyId, updateData);
        res.json(policy);
      } catch (error) {
        logRouteError("Error updating company policy", error);
        fail(res, 500, "Failed to update company policy");
      }
    }
  );

  app.delete(
    "/api/admin/company-policies/:id",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const policyId = parseInt(req.params.id);
        await storage.deleteCompanyPolicy(policyId);
        res.json({ message: "Company policy deleted successfully" });
      } catch (error) {
        logRouteError("Error deleting company policy", error);
        fail(res, 500, "Failed to delete company policy");
      }
    }
  );

  app.post(
    "/api/admin/company-policies/:id/toggle",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const policyId = parseInt(req.params.id);
        const policy = await storage.toggleCompanyPolicyStatus(policyId);
        res.json(policy);
      } catch (error) {
        logRouteError("Error toggling company policy status", error);
        fail(res, 500, "Failed to toggle company policy status");
      }
    }
  );

  app.get(
    "/api/company-policies/:id/download",
    isAuthenticated,
    async (req, res) => {
      try {
        const policyId = parseInt(req.params.id);
        const policy = await storage.getCompanyPolicyById(policyId);

        if (!policy || (!policy.isActive && !isAdminCaller(req))) {
          return fail(res, 404, "Company policy not found");
        }

        // Check if fileData exists (new format) or fall back to content (old format)
        const fileBuffer = policy.fileData
          ? Buffer.from(policy.fileData, "base64")
          : Buffer.from(policy.content || "", "utf-8");

        res.setHeader("Content-Type", policy.mimeType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${policy.fileName}"`
        );
        res.send(fileBuffer);
      } catch (error) {
        logRouteError("Error downloading company policy", error);
        fail(res, 500, "Failed to download company policy");
      }
    }
  );

  // Cancel user invitation (admin only)
  app.delete(
    "/api/admin/invitations/:id",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const id = parseInt(req.params.id);
        await storage.cancelUserInvitation(id);
        res.json({ message: "Invitation cancelled successfully" });
      } catch (error) {
        logRouteError("Error cancelling invitation", error);
        fail(res, 500, "Failed to cancel invitation");
      }
    }
  );

  // Resend user invitation (admin only)
  app.post(
    "/api/admin/invitations/:id/resend",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const id = parseInt(req.params.id);
        const invitation = await storage.getUserInvitationById(id);

        if (!invitation) {
          return fail(res, 404, "Invitation not found");
        }

        if (invitation.status === "accepted") {
          return fail(res, 400, "Cannot resend accepted invitation");
        }

        // Send invitation email using the template
        const emailTemplate = await storage.getEmailTemplate("user_invitation");
        const companySettings = await storage.getCompanySettings();
        const emailProvider = await storage.getActiveEmailProvider();

        // R34: the link's origin is APP_BASE_URL, never the request's Host header.
        const inviteBase = publicBaseUrl(req);
        if (!inviteBase) console.warn("Invitation email not sent: APP_BASE_URL is not set");
        if (emailTemplate && emailProvider && inviteBase) {
          const inviteUrl = `${inviteBase}/auth?mode=register&email=${encodeURIComponent(
            invitation.email
          )}&token=${invitation.invitationToken}`;

          const department = invitation.departmentId
            ? await storage.getDepartmentById(invitation.departmentId)
            : null;
          const inviter = await storage.getUser(invitation.invitedBy);

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

          // Use appropriate email service based on provider
          if (emailProvider.provider === EMAIL_PROVIDERS.MAILTRAP) {
            const { sendEmailWithTemplate } = await import(
              "../services/mailtrap"
            );
            const mailtrapToken =
              emailProvider.metadata?.mailtrapToken ||
              process.env.MAILTRAP_TOKEN;

            await sendEmailWithTemplate({
              to: invitation.email,
              template: emailTemplate,
              variables: {
                companyName: companySettings?.companyName || "TicketFlow",
                invitedName: invitation.email.split("@")[0], // Use email prefix as name
                inviterName: inviter
                  ? `${inviter.firstName} ${inviter.lastName}`
                  : "Admin",
                email: invitation.email,
                role:
                  invitation.role.charAt(0).toUpperCase() +
                  invitation.role.slice(1),
                department: department?.name || "Not assigned",
                registrationUrl: inviteUrl,
                year: new Date().getFullYear().toString(),
              },
              fromEmail,
              fromName,
              mailtrapToken,
            });
          } else if (emailProvider.provider === EMAIL_PROVIDERS.AWS) {
            const { sendEmailWithTemplate } = await import("../services/ses");
            // Extract AWS credentials from email provider metadata
            const awsCredentials = emailProvider.metadata
              ? {
                  awsAccessKeyId: emailProvider.metadata.awsAccessKeyId,
                  awsSecretAccessKey: emailProvider.metadata.awsSecretAccessKey,
                  awsRegion: emailProvider.metadata.awsRegion,
                }
              : {};

            await sendEmailWithTemplate({
              to: invitation.email,
              template: emailTemplate,
              variables: {
                companyName: companySettings?.companyName || "TicketFlow",
                invitedName: invitation.email.split("@")[0], // Use email prefix as name
                inviterName: inviter
                  ? `${inviter.firstName} ${inviter.lastName}`
                  : "Admin",
                email: invitation.email,
                role:
                  invitation.role.charAt(0).toUpperCase() +
                  invitation.role.slice(1),
                department: department?.name || "Not assigned",
                registrationUrl: inviteUrl,
                year: new Date().getFullYear().toString(),
              },
              fromEmail,
              fromName,
              ...awsCredentials,
            });
          }
        }

        res.json({ message: "Invitation resent successfully" });
      } catch (error) {
        logRouteError("Error resending invitation", error);
        fail(res, 500, "Failed to resend invitation");
      }
    }
  );

  // Department routes (scoped by role)
  app.get("/api/departments/:id", isAuthenticated, async (req, res) => {
    try {
      const departmentId = parseInt(req.params.id);
      if (isNaN(departmentId)) {
        return fail(res, 400, "Invalid department ID", { code: "invalid_id" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 401, "Unauthorized");
      }

      const department = await storage.getDepartmentById(departmentId);
      if (!department) {
        return fail(res, 404, "Department not found");
      }

      // Permission check: Admin can access all, Manager can only access their departments
      if (user.role === "admin") {
        // Admin can access all departments
      } else if (user.role === "manager") {
        // Manager can only access departments they manage
        if (department.managerId !== userId) {
          return fail(res, 403, "You can only access departments you manage");
        }
      } else {
        return fail(res, 403, "Forbidden");
      }

      res.json(department);
    } catch (error) {
      logRouteError("Error fetching department", error);
      fail(res, 500, "Failed to fetch department");
    }
  });

  app.get("/api/departments", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 401, "Unauthorized");
      }

      if (user.role === "admin") {
        // Admins can see all departments (active and inactive)
        const rows = await storage.getAllDepartmentsIncludingInactive();
        return res.json(rows);
      }

      if (user.role === "manager") {
        const rows = await db
          .select()
          .from(departments)
          .where(
            and(
              eq(departments.isActive, true),
              eq(departments.managerId as any, userId) as any
            )
          )
          .orderBy(departments.name);
        return res.json(rows);
      }

      return fail(res, 403, "Forbidden");
    } catch (error) {
      logRouteError("Error fetching departments", error);
      fail(res, 500, "Failed to fetch departments");
    }
  });

  app.post("/api/admin/departments", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // Validate required fields
      if (!req.body.name || !req.body.description) {
        return fail(res, 400, "Name and description are required");
      }

      const department = await storage.createDepartment(req.body);

      // Broadcast department created event
      await notifyStaff("department:created", { ...department });

      res.json(department);
    } catch (error) {
      logRouteError("Error creating department", error);
      fail(res, 500, "Failed to create department");
    }
  });

  app.put("/api/admin/departments/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // Validate required fields
      if (!req.body.name || !req.body.description) {
        return fail(res, 400, "Name and description are required");
      }

      const id = parseInt(req.params.id);
      const department = await storage.updateDepartment(id, req.body);

      // Broadcast department updated event
      await notifyStaff("department:updated", { ...department });

      res.json(department);
    } catch (error) {
      logRouteError("Error updating department", error);
      fail(res, 500, "Failed to update department");
    }
  });

  app.delete(
    "/api/admin/departments/:id",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const id = parseInt(req.params.id);
        await storage.deleteDepartment(id);

        // Broadcast department deleted event
        await notifyStaff("department:deleted", { id });

        res.json({ message: "Department deleted successfully" });
      } catch (error) {
        logRouteError("Error deleting department", error);
        fail(res, 500, "Failed to delete department");
      }
    }
  );

  // Get teams in a department
  app.get("/api/departments/:id/teams", isAuthenticated, async (req, res) => {
    try {
      const departmentId = parseInt(req.params.id);
      if (isNaN(departmentId)) {
        return fail(res, 400, "Invalid department ID", { code: "invalid_id" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 401, "Unauthorized");
      }

      // Check if department exists
      const department = await storage.getDepartmentById(departmentId);
      if (!department) {
        return fail(res, 404, "Department not found");
      }

      // Permission check: Admin can access all, Manager can only access their departments
      if (user.role === "admin") {
        // Admin can access all departments
      } else if (user.role === "manager") {
        // Manager can only access departments they manage
        if (department.managerId !== userId) {
          return fail(res, 403, "You can only access departments you manage");
        }
      } else {
        return fail(res, 403, "Forbidden");
      }

      // Get teams in this department
      const departmentTeams = await db
        .select({
          id: teams.id,
          name: teams.name,
          description: teams.description,
          createdAt: teams.createdAt,
          createdBy: teams.createdBy,
        })
        .from(teams)
        .where(eq(teams.departmentId, departmentId))
        .orderBy(desc(teams.createdAt));

      res.json(departmentTeams);
    } catch (error) {
      logRouteError("Error fetching department teams", error);
      fail(res, 500, "Failed to fetch department teams");
    }
  });

  // Get department statistics
  app.get("/api/departments/:id/stats", isAuthenticated, async (req, res) => {
    try {
      const departmentId = parseInt(req.params.id);
      if (isNaN(departmentId)) {
        return fail(res, 400, "Invalid department ID", { code: "invalid_id" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 401, "Unauthorized");
      }

      // Check if department exists
      const department = await storage.getDepartmentById(departmentId);
      if (!department) {
        return fail(res, 404, "Department not found");
      }

      // Permission check: Admin can access all, Manager can only access their departments
      if (user.role === "admin") {
        // Admin can access all departments
      } else if (user.role === "manager") {
        // Manager can only access departments they manage
        if (department.managerId !== userId) {
          return fail(res, 403, "You can only access departments you manage");
        }
      } else {
        return fail(res, 403, "Forbidden");
      }

      // Get teams in this department
      const deptTeams = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.departmentId, departmentId));

      const teamIds = deptTeams.map((t) => t.id);
      const teamCount = teamIds.length;

      // Initialize stats
      let totalTickets = 0;
      let openTickets = 0;
      let inProgressTickets = 0;
      let resolvedTickets = 0;
      let closedTickets = 0;
      let highPriorityTickets = 0;

      if (teamIds.length > 0) {
        // Get all tickets for teams in this department
        const deptTasks = await db
          .select({
            id: tasks.id,
            status: tasks.status,
            priority: tasks.priority,
          })
          .from(tasks)
          .where(
            and(
              inArray(tasks.assigneeTeamId, teamIds),
              eq(tasks.assigneeType, "team")
            )
          );

        totalTickets = deptTasks.length;
        openTickets = deptTasks.filter((t) => t.status === "open").length;
        inProgressTickets = deptTasks.filter(
          (t) => t.status === "in_progress"
        ).length;
        resolvedTickets = deptTasks.filter(
          (t) => t.status === "resolved"
        ).length;
        closedTickets = deptTasks.filter((t) => t.status === "closed").length;
        highPriorityTickets = deptTasks.filter(
          (t) => t.priority === "high" || t.priority === "urgent"
        ).length;
      }

      res.json({
        teamCount,
        totalTickets,
        openTickets,
        inProgressTickets,
        resolvedTickets,
        closedTickets,
        highPriorityTickets,
      });
    } catch (error) {
      logRouteError("Error fetching department stats", error);
      fail(res, 500, "Failed to fetch department statistics");
    }
  });

  // User invitation routes (admin only)
  app.get("/api/admin/invitations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      const { status } = req.query;
      const invitations = await storage.getUserInvitations({
        status: status as string,
      });
      // R33: the token is a credential; it travels only in the emailed link.
      res.json(invitations.map(toPublicInvitation));
    } catch (error) {
      logRouteError("Error fetching invitations", error);
      fail(res, 500, "Failed to fetch invitations");
    }
  });

  app.post("/api/admin/invitations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // Check if a user with this email already exists (case-insensitive)
      const existingUser = await storage.getUserByEmail(req.body.email);
      if (existingUser) {
        return fail(
          res,
          400,
          "A user with this email address already exists in the system. You cannot send an invitation to an existing user.",
          { code: "email_registered" }
        );
      }

      // Check for existing pending invitations (not expired)
      const existingInvitations = await storage.getUserInvitations({
        status: "pending",
      });
      const now = new Date();
      const hasPendingInvitation = existingInvitations.some(
        (inv) =>
          inv.email.toLowerCase() === req.body.email.toLowerCase() &&
          inv.status === "pending" &&
          new Date(inv.expiresAt) > now
      );

      if (hasPendingInvitation) {
        return fail(
          res,
          400,
          "An invitation has already been sent to this email address and is still pending. Please wait for it to expire or be accepted before sending a new invitation.",
          { code: "invitation_pending" }
        );
      }

      const inviteRole = normalizeRole(req.body.role);
      if (
        typeof req.body.role !== "string" ||
        req.body.role === "user" ||
        !inviteRole
      ) {
        return res.status(400).json({
          error: "invalid_role",
          message: "role must be one of agent, manager, admin, customer",
        });
      }

      // Whitelist fields: the caller may not set status, token, etc.
      let expiresAt: Date | undefined;
      if (
        req.body.expiresAt !== undefined &&
        req.body.expiresAt !== null &&
        req.body.expiresAt !== ""
      ) {
        expiresAt = new Date(req.body.expiresAt);
        if (Number.isNaN(expiresAt.getTime())) {
          return res.status(400).json({
            error: "invalid_expiry",
            message: "expiresAt must be a valid date",
          });
        }
        const MAX_INVITE_DAYS = 30;
        if (
          expiresAt.getTime() <= Date.now() ||
          expiresAt.getTime() > Date.now() + MAX_INVITE_DAYS * 86400000
        ) {
          return res.status(400).json({
            error: "invalid_expiry",
            message: `expiresAt must be in the future and at most ${MAX_INVITE_DAYS} days ahead`,
          });
        }
      }
      const invitation = await storage.createUserInvitation({
        email: req.body.email,
        role: inviteRole,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        department: req.body.department,
        departmentId: req.body.departmentId,
        ...(expiresAt ? { expiresAt } : {}),
        invitedBy: userId,
      } as any);

      // Send invitation email using the template
      const emailTemplate = await storage.getEmailTemplate("user_invitation");
      const companySettings = await storage.getCompanySettings();
      const emailProvider = await storage.getActiveEmailProvider();

      // R34: the link's origin is APP_BASE_URL, never the request's Host header.
      const inviteBase = publicBaseUrl(req);
      if (!inviteBase) console.warn("Invitation email not sent: APP_BASE_URL is not set");
      if (emailTemplate && emailProvider && inviteBase) {
        const inviteUrl = `${inviteBase}/auth?mode=register&email=${encodeURIComponent(
          invitation.email
        )}&token=${invitation.invitationToken}`;

        const department = invitation.departmentId
          ? await storage.getDepartmentById(invitation.departmentId)
          : null;

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

        // Use appropriate email service based on provider
        if (emailProvider.provider === EMAIL_PROVIDERS.MAILTRAP) {
          const { sendEmailWithTemplate } = await import(
            "../services/mailtrap"
          );
          const mailtrapToken =
            emailProvider.metadata?.mailtrapToken || process.env.MAILTRAP_TOKEN;

          await sendEmailWithTemplate({
            to: invitation.email,
            template: emailTemplate,
            variables: {
              companyName: companySettings?.companyName || "TicketFlow",
              invitedName: invitation.email.split("@")[0], // Use email prefix as name
              inviterName: user.firstName
                ? `${user.firstName} ${user.lastName}`
                : "Admin",
              email: invitation.email,
              role:
                invitation.role.charAt(0).toUpperCase() +
                invitation.role.slice(1),
              department: department?.name || "Not assigned",
              registrationUrl: inviteUrl,
              year: new Date().getFullYear().toString(),
            },
            fromEmail,
            fromName,
            mailtrapToken,
          });
        } else if (emailProvider.provider === EMAIL_PROVIDERS.AWS) {
          const { sendEmailWithTemplate } = await import("../services/ses");
          // Extract AWS credentials from email provider metadata
          const awsCredentials = emailProvider.metadata
            ? {
                awsAccessKeyId: emailProvider.metadata.awsAccessKeyId,
                awsSecretAccessKey: emailProvider.metadata.awsSecretAccessKey,
                awsRegion: emailProvider.metadata.awsRegion,
              }
            : {};

          await sendEmailWithTemplate({
            to: invitation.email,
            template: emailTemplate,
            variables: {
              companyName: companySettings?.companyName || "TicketFlow",
              invitedName: invitation.email.split("@")[0], // Use email prefix as name
              inviterName: user.firstName
                ? `${user.firstName} ${user.lastName}`
                : "Admin",
              email: invitation.email,
              role:
                invitation.role.charAt(0).toUpperCase() +
                invitation.role.slice(1),
              department: department?.name || "Not assigned",
              registrationUrl: inviteUrl,
              year: new Date().getFullYear().toString(),
            },
            fromEmail,
            fromName,
            ...awsCredentials,
          });
        }
      }

      // R33: never the token (it is in the emailed link only).
      res.status(201).json(toPublicInvitation(invitation));
    } catch (error) {
      logRouteError("Error creating invitation", error);
      fail(res, 500, "Failed to create invitation");
    }
  });

  // Check email service configuration status (admin only)
  app.get(
    "/api/admin/email-service/status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }
        // Check for active email provider
        let emailProviderConfigured = false;
        try {
          const emailProvider = await storage.getActiveEmailProvider();
          emailProviderConfigured =
            (emailProvider?.provider === EMAIL_PROVIDERS.MAILTRAP &&
              emailProvider?.metadata?.mailtrapToken) ||
            (emailProvider?.provider === EMAIL_PROVIDERS.AWS &&
              emailProvider?.metadata?.awsSecretAccessKey &&
              emailProvider?.metadata?.awsAccessKeyId);
        } catch (error) {
          // Email provider check failed, continue with env check
        }

        // Check if email template exists
        let emailTemplateExists = false;
        try {
          const template = await storage.getEmailTemplate("user_invitation");
          emailTemplateExists = !!template;
        } catch (error) {
          // Template check failed
        }

        const isEmailConfigured =
          emailProviderConfigured && emailTemplateExists;

        res.json({
          isConfigured: isEmailConfigured,
          hasEmailProvider: emailProviderConfigured,
          hasEmailTemplate: emailTemplateExists,
          message: isEmailConfigured
            ? "Email service is configured and ready"
            : "Email service is not configured. Please configure AWS SES credentials and email templates.",
        });
      } catch (error) {
        logRouteError("Error checking email service status", error);
        fail(res, 500, "Failed to check email service status");
      }
    }
  );

  // Public route to look up an invitation by its secret token
  app.get("/api/invitations/:token", async (req, res) => {
    try {
      const invitation = await storage.getUserInvitationByToken(
        req.params.token
      );

      // A cancelled token is indistinguishable from an unknown one.
      if (!invitation || invitation.status === "cancelled") {
        return res.status(404).json({
          error: "invitation_not_found",
          message: "Invalid invitation token",
        });
      }

      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: "invitation_used",
          message: "Invitation has already been accepted",
        });
      }

      if (new Date(invitation.expiresAt) <= new Date()) {
        return res.status(400).json({
          error: "invitation_expired",
          message: "Invitation has expired",
        });
      }

      res.json({
        email: invitation.email,
        role: invitation.role,
        departmentId: invitation.departmentId,
      });
    } catch (error) {
      logRouteError("Error validating invitation", error);
      fail(res, 500, "Failed to validate invitation");
    }
  });

  // Accept an invitation. Only a signed-in user whose email matches the
  // invitation gets the role. An anonymous caller creates nothing and is
  // told to register with the token (an account needs a password).
  app.post("/api/invitations/:token/accept", async (req: any, res) => {
    try {
      const invitation = await storage.getUserInvitationByToken(
        req.params.token
      );

      if (!invitation) {
        return res.status(404).json({
          error: "invitation_not_found",
          message: "Invalid invitation token",
        });
      }

      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: "invitation_unavailable",
          message:
            invitation.status === "accepted"
              ? "Invitation has already been accepted"
              : "Invitation is no longer valid",
        });
      }

      if (new Date(invitation.expiresAt) <= new Date()) {
        return res.status(400).json({
          error: "invitation_expired",
          message: "Invitation has expired",
        });
      }

      const sessionUserId =
        req.isAuthenticated && req.isAuthenticated()
          ? getUserId(req)
          : undefined;
      const current = sessionUserId
        ? await storage.getUser(sessionUserId)
        : undefined;

      if (!current) {
        return res.json({
          registrationRequired: true,
          email: invitation.email,
          registerPath: `/auth?mode=register&email=${encodeURIComponent(
            invitation.email
          )}&token=${encodeURIComponent(invitation.invitationToken)}`,
          message: "Create an account with this invitation to continue.",
        });
      }

      if ((current.email ?? "").toLowerCase() !== invitation.email.toLowerCase()) {
        return res.status(403).json({
          error: "invitation_email_mismatch",
          message: "This invitation was issued for a different email address.",
        });
      }

      const grantedRole = normalizeRole(invitation.role);
      // Claim and role change are one transaction; a lost race changes nothing.
      const claimed = grantedRole
        ? await storage.acceptInvitationForUser(
            invitation.id,
            current.id,
            grantedRole
          )
        : false;
      if (!claimed) {
        return res.status(400).json({
          error: "invalid_invitation",
          message: "This invitation is invalid, expired or already used.",
        });
      }

      res.json({ message: "Invitation accepted. Your role has been updated." });
    } catch (error) {
      logRouteError("Error accepting invitation", error);
      fail(res, 500, "Failed to accept invitation");
    }
  });

  // Clean up expired invitations periodically
  setInterval(async () => {
    try {
      await storage.deleteExpiredInvitations();
    } catch (error) {
      logRouteError("Error cleaning up expired invitations", error);
    }
  }, 24 * 60 * 60 * 1000); // Run once per day

  // Teams Integration routes. A webhook is an outbound call to a URL we are
  // given, and it receives ticket content: only an admin may configure one
  // (read, save, remove, test). Delivery is scoped in services/teamsNotifications.
  const teamsWebhookAdminOnly: RequestHandler = (req, _res, next) => {
    if (normalizeRole((req.user as any)?.role) !== "admin") {
      return next(new HttpError(403, "forbidden", "Admin access required"));
    }
    next();
  };

  app.get(
    "/api/teams-integration/settings",
    isAuthenticated,
    teamsWebhookAdminOnly,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const settings = await storage.getTeamsIntegrationSettings(userId);
        res.json(settings || { enabled: false });
      } catch (error) {
        logRouteError("Error fetching Teams settings", error);
        fail(res, 500, "Failed to fetch Teams settings");
      }
    }
  );

  app.post(
    "/api/teams-integration/settings",
    isAuthenticated,
    teamsWebhookAdminOnly,
    async (req: any, res, next) => {
      try {
        const userId = getUserId(req);
        const input = teamsSettingsInputSchema.parse(req.body ?? {});
        const settings = await storage.upsertTeamsIntegrationSettings({
          ...input,
          userId,
        });
        res.json(settings);
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof HttpError) return next(error);
        logRouteError("Error updating Teams settings", error);
        fail(res, 500, "Failed to update Teams settings");
      }
    }
  );

  app.delete(
    "/api/teams-integration/settings",
    isAuthenticated,
    teamsWebhookAdminOnly,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        await storage.deleteTeamsIntegrationSettings(userId);
        res.json({ message: "Teams integration disabled" });
      } catch (error) {
        logRouteError("Error disabling Teams integration", error);
        fail(res, 500, "Failed to disable Teams integration");
      }
    }
  );

  // Get user's teams and channels
  app.get(
    "/api/teams-integration/teams",
    isAuthenticated,
    teamsWebhookAdminOnly,
    async (req: any, res) => {
      try {
        if (!req.user.access_token) {
          return fail(res, 401, "Microsoft authentication required", {
            code: "microsoft_auth_required",
          });
        }

        const teams = await teamsIntegration.listTeamsAndChannels(
          req.user.access_token
        );
        res.json(teams);
      } catch (error) {
        logRouteError("Error fetching teams", error);
        fail(res, 500, "Failed to fetch teams");
      }
    }
  );

  // Send test notification
  app.post(
    "/api/teams-integration/test",
    isAuthenticated,
    teamsWebhookAdminOnly,
    async (req: any, res, next) => {
      try {
        const userId = getUserId(req);
        const settings = await storage.getTeamsIntegrationSettings(userId);

        if (!settings || !settings.enabled) {
          return fail(res, 400, "Teams integration not configured");
        }

        // A stored URL that is not allow-listed (or resolves to a private
        // address) is refused with 400 before any request is made.
        if (settings.webhookUrl) {
          validateWebhookUrl(settings.webhookUrl);
          await assertPublicHost(new URL(settings.webhookUrl).hostname);
        }

        const testTask = {
          id: 0,
          ticketNumber: "TKT-TEST",
          title: "Test Notification",
          description: "This is a test notification from TicketFlow",
          status: "open",
          priority: "medium",
          category: "support",
          createdBy: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any;

        // R34: APP_BASE_URL, never the request's Host header.
        const actionUrl = `${publicBaseUrl(req) ?? ""}/`;
        let success = false;

        if (settings.webhookUrl) {
          success = await teamsIntegration.sendWebhookNotification(
            settings.webhookUrl,
            testTask,
            "Test notification from TicketFlow",
            actionUrl
          );
        } else if (settings.teamId && settings.channelId) {
          success = await teamsIntegration.sendChannelNotification(
            settings.teamId,
            settings.channelId,
            testTask,
            "Test notification from TicketFlow",
            actionUrl
          );
        }

        if (success) {
          res.json({ message: "Test notification sent successfully" });
        } else {
          fail(res, 500, "Failed to send test notification");
        }
      } catch (error) {
        if (error instanceof HttpError) return next(error);
        logRouteError("Error sending test notification", error);
        fail(res, 500, "Failed to send test notification");
      }
    }
  );

  // Smart Helpdesk API Routes

  // Get AI auto-response for a ticket
  app.get("/api/tasks/:id/auto-response", isAuthenticated, requireTaskAccess(), async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const isStaff = isStaffRole((req.user as any)?.role);
      const [autoResponse] = await db
        .select({
          id: ticketAutoResponses.id,
          ticketId: ticketAutoResponses.ticketId,
          aiResponse: ticketAutoResponses.aiResponse,
          confidenceScore: ticketAutoResponses.confidenceScore,
          wasHelpful: ticketAutoResponses.wasHelpful,
          wasApplied: ticketAutoResponses.wasApplied,
          respondedBy: ticketAutoResponses.respondedBy,
          createdAt: ticketAutoResponses.createdAt,
          // Never an email (customers read applied rows); 'System' when nobody responded.
          respondedByName: sql<string | null>`CASE WHEN ${users.id} IS NULL THEN 'System' ELSE ${displayNameSql(
            sql`${users.firstName}`,
            sql`${users.lastName}`,
            sql`${users.role}`
          )} END`.as("responded_by_name"),
        })
        .from(ticketAutoResponses)
        .leftJoin(users, eq(ticketAutoResponses.respondedBy, users.id))
        // A customer is shown the latest APPLIED row (a newer staff draft must not hide it);
        // staff see the latest row of any kind.
        .where(
          and(
            eq(ticketAutoResponses.ticketId, taskId),
            isStaff ? undefined : eq(ticketAutoResponses.wasApplied, true)
          )
        )
        .orderBy(desc(ticketAutoResponses.createdAt), desc(ticketAutoResponses.id))
        .limit(1);

      if (!isStaff && !autoResponse) {
        return res.status(404).json({ error: "not_found", message: "No AI response for this ticket" });
      }

      if (autoResponse) {
        // If respondedBy is null, set respondedByName to "System"
        if (!autoResponse.respondedBy) {
          (autoResponse as any).respondedByName = "System";
        }
        res.json(autoResponse);
      } else {
        res.json(null);
      }
    } catch (error) {
      console.error("Error fetching auto-response:", describeAIError(error));
      fail(res, 500, "Failed to fetch auto-response");
    }
  });

  // Post the stored AI draft as a comment by the AI system user (staff only, idempotent).
  app.post(
    "/api/tasks/:id/auto-response/apply",
    isAuthenticated,
    requireTaskAccess(),
    requireStaff,
    asyncHandler(async (req, res) => {
      const taskId = parseInt(req.params.id);
      const [draft] = await db
        .select()
        .from(ticketAutoResponses)
        .where(eq(ticketAutoResponses.ticketId, taskId))
        .orderBy(desc(ticketAutoResponses.createdAt), desc(ticketAutoResponses.id))
        .limit(1);
      if (!draft) throw new HttpError(404, "not_found", "No AI draft exists for this ticket");
      if (draft.wasApplied) return res.json({ applied: true, alreadyApplied: true });

      const aiUserId = await ensureAiSystemUser();
      if (!aiUserId) throw new HttpError(503, "ai_user_unavailable", "AI authorship is unavailable");

      // Claim the draft first: of two concurrent applies only one gets the row back and posts.
      const claimed = await db
        .update(ticketAutoResponses)
        .set({ wasApplied: true })
        .where(and(eq(ticketAutoResponses.id, draft.id), eq(ticketAutoResponses.wasApplied, false)))
        .returning({ id: ticketAutoResponses.id });
      if (claimed.length === 0) return res.json({ applied: true, alreadyApplied: true });

      try {
        // The create path may have posted this comment and then failed to mark the draft
        // applied; posting again would duplicate it. The claim above already marked it applied.
        if (await autoResponseCommentExists(taskId, aiUserId, draft.aiResponse)) {
          return res.json({ applied: true, alreadyApplied: true });
        }
        await storage.addTaskComment({
          taskId,
          userId: aiUserId,
          content: autoResponseCommentBody(Number(draft.confidenceScore ?? 0), draft.aiResponse),
        } as any);
      } catch (error) {
        // Release the claim so the draft can be applied again. If that fails too, log
        // both (type/status only) and still surface the ORIGINAL error. (A transaction
        // was not used: the comment goes through storage.addTaskComment, which has its
        // own connection and side effects.)
        try {
          await db
            .update(ticketAutoResponses)
            .set({ wasApplied: false })
            .where(eq(ticketAutoResponses.id, draft.id));
        } catch (rollbackError) {
          console.error(
            `Apply of AI draft ${draft.id} failed (${describeAIError(error)}) and releasing the claim failed too (${describeAIError(rollbackError)})`
          );
        }
        throw error;
      }
      // The realtime event the REST comment route sends (ticketService.addComment). Never throws.
      await notifyCommentAdded(taskId);
      res.json({ applied: true, alreadyApplied: false });
    })
  );

  // Generate auto-response for an existing ticket (on-demand)
  app.post(
    "/api/tasks/:id/auto-response/generate",
    isAuthenticated,
    requireTaskAccess(),
    // After the access check, so a missing ticket is 404 and an outside one 403 for everyone.
    requireStaff,
    async (req, res, next) => {
      try {
        const taskId = parseInt(req.params.id);
        const task = await storage.getTask(taskId);

        if (!task) {
          return res.status(404).json({ error: "not_found", message: "Ticket not found" });
        }

        // Check if Bedrock is configured
        const bedrockSettings = await storage.getBedrockSettings();
        if (
          !bedrockSettings?.bedrockAccessKeyId ||
          !bedrockSettings?.bedrockSecretAccessKey
        ) {
          return res
            .status(503)
            .json({ error: "ai_not_configured", message: "AI service not configured" });
        }

        // Check AI settings
        const aiSettings = await getAISettings();
        if (!aiSettings.autoResponseEnabled) {
          return res
            .status(400)
            .json({ error: "ai_disabled", message: "Auto-response is disabled in settings" });
        }

        // Generate auto-response
        const { aiAutoResponseService } = await import(
          "../services/ai/aiAutoResponse"
        );
        // The service stores the one draft row (even below the confidence threshold: a
        // person asked for it), NOT applied: it becomes a comment only through /apply.
        const analysis = await aiAutoResponseService.analyzeTicket(task);

        if (!analysis.autoResponse) {
          throw new HttpError(503, "ai_unavailable", "Could not generate auto-response", {
            confidence: analysis.confidence,
          });
        }

        res.json({
          autoResponse: analysis.autoResponse,
          confidence: analysis.confidence,
          complexity: analysis.complexity,
          shouldEscalate: analysis.shouldEscalate,
        });
      } catch (error: any) {
        if (error instanceof HttpError) return next(error);
        console.error("Error generating auto-response:", describeAIError(error));

        // If request was blocked due to cost limits
        if (isQuotaBlocked(error)) return sendQuotaExceeded(res, error);

        res
          .status(500)
          .json({ error: "ai_failed", message: "Failed to generate auto-response" });
      }
    }
  );

  // Update auto-response effectiveness
  app.post(
    "/api/tasks/:id/auto-response/feedback",
    isAuthenticated,
    requireTaskAccess(),
    async (req, res, next) => {
      try {
        const taskId = parseInt(req.params.id);
        const { wasHelpful } = z
          .object({ wasHelpful: z.boolean() })
          .parse(req.body ?? {});

        const { aiAutoResponseService } = await import(
          "../services/ai/aiAutoResponse"
        );
        const marked = await aiAutoResponseService.updateResponseEffectiveness(
          taskId,
          wasHelpful
        );
        if (marked === 0) {
          throw new HttpError(404, "not_found", "This ticket has no auto-response");
        }

        res.json({ message: "Feedback recorded" });
      } catch (error) {
        next(error);
      }
    }
  );

  // Knowledge Base Routes

  // Search knowledge base
  const knowledgeListSearchQuery = z.object({
    query: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  });

  app.get("/api/knowledge/search", isAuthenticated, async (req, res, next) => {
    try {
      const parsed = knowledgeListSearchQuery.safeParse(req.query);
      if (!parsed.success) {
        throw parsed.error;
      }
      const { query, category, limit } = parsed.data;

      const articles = await db
        .select()
        .from(knowledgeArticles)
        .where(
          and(
            eq(knowledgeArticles.isPublished, true),
            query
              ? or(
                  ilike(knowledgeArticles.title, containsPattern(query)),
                  ilike(knowledgeArticles.content, containsPattern(query))
                )
              : undefined,
            category ? eq(knowledgeArticles.category, category) : undefined
          )
        )
        .orderBy(
          desc(knowledgeArticles.effectivenessScore),
          desc(knowledgeArticles.usageCount)
        )
        .limit(limit);

      res.json(articles);
    } catch (error) {
      // A ZodError becomes 400 validation_failed in the JSON error handler.
      if (error instanceof z.ZodError) return next(error);
      logRouteError("Error searching knowledge base", error);
      fail(res, 500, "Failed to search knowledge base");
    }
  });

  // Get knowledge articles (admin)
  app.get("/api/admin/knowledge", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // status and source filters ported from the removed shadowed copy: the
      // knowledge-base page sends them and the served copy silently ignored them.
      const { category, status, source, published } = req.query as any;
      const filters: any = {};
      if (category) filters.category = category as string;
      if (status) filters.status = status as string;
      if (source) filters.source = source as string;
      if (published !== undefined && published !== "all") {
        filters.isPublished = published === "true" || published === "published";
      }

      const articles = await storage.getAllKnowledgeArticles(filters);
      res.json(articles);
    } catch (error) {
      logRouteError("Error fetching knowledge articles", error);
      fail(res, 500, "Failed to fetch knowledge articles");
    }
  });

  // Create knowledge article (admin)
  app.post("/api/admin/knowledge", isAuthenticated, async (req: any, res, next) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // Ported from the removed shadowed copy: required fields and a field
      // whitelist (other body fields are ignored) instead of spreading the
      // whole body into the insert.
      const { title, summary, content, category, tags, isPublished } = req.body ?? {};
      if (!title || !content) {
        throw new HttpError(400, "validation_failed", "Title and content are required", {
          fieldErrors: {
            ...(title ? {} : { title: ["Required"] }),
            ...(content ? {} : { content: ["Required"] }),
          },
        });
      }

      const article = await storage.createKnowledgeArticle({
        title,
        summary: summary || null,
        content,
        category: category || "general",
        tags: tags || [],
        isPublished: isPublished || false,
        createdBy: userId,
        source: "manual",
      });
      res.status(201).json(article);
    } catch (error) {
      // HttpError keeps its status; anything else becomes the contract's 500.
      next(error);
    }
  });

  // Update knowledge article (admin)
  app.put(
    "/api/admin/knowledge/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const articleId = parseInt(req.params.id);
        // Protected fields ported from the removed shadowed copy.
        const updates = { ...req.body };
        delete updates.id;
        delete updates.createdAt;
        delete updates.usageCount;
        delete updates.createdBy;

        const article = await storage.updateKnowledgeArticle(
          articleId,
          updates
        );
        res.json(article);
      } catch (error) {
        logRouteError("Error updating knowledge article", error);
        fail(res, 500, "Failed to update knowledge article");
      }
    }
  );

  // Delete knowledge article (admin)
  app.delete(
    "/api/admin/knowledge/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const articleId = parseInt(req.params.id);
        await storage.deleteKnowledgeArticle(articleId);
        res.json({ message: "Knowledge article deleted successfully" });
      } catch (error) {
        logRouteError("Error deleting knowledge article", error);
        fail(res, 500, "Failed to delete knowledge article");
      }
    }
  );

  // Publish/unpublish knowledge article
  app.patch(
    "/api/admin/knowledge/:id/publish",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const articleId = parseInt(req.params.id);
        // With no body this is a toggle; an explicit boolean sets the state.
        const { isPublished: requested } = z
          .object({ isPublished: z.boolean().optional() })
          .parse(req.body ?? {});

        const [article] = await db
          .select({ isPublished: knowledgeArticles.isPublished })
          .from(knowledgeArticles)
          .where(eq(knowledgeArticles.id, articleId))
          .limit(1);
        if (!article) {
          throw new HttpError(404, "not_found", "Article not found");
        }
        const isPublished = requested ?? !article.isPublished;

        // Sets status together with isPublished (the shadowed copy's fix); the
        // old service calls left `status` stale.
        await storage.setKnowledgeArticleStatus(
          articleId,
          isPublished ? "published" : "draft"
        );

        res.json({ message: "Article updated", isPublished });
      } catch (error) {
        next(error);
      }
    }
  );

  // Feedback on knowledge article
  app.post("/api/knowledge/:id/feedback", isAuthenticated, async (req, res) => {
    try {
      const articleId = parseInt(req.params.id);
      const { wasHelpful } = req.body;

      const { knowledgeBaseService } = await import(
        "../services/ai/knowledgeBase"
      );
      await knowledgeBaseService.updateArticleEffectiveness(
        articleId,
        wasHelpful
      );

      res.json({ message: "Feedback recorded" });
    } catch (error) {
      logRouteError("Error recording feedback", error);
      fail(res, 500, "Failed to record feedback");
    }
  });

  // AI Analytics Routes

  // Get AI performance metrics
  app.get(
    "/api/analytics/ai-performance",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || (user.role !== "admin" && user.role !== "manager")) {
          return fail(res, 403, "Manager access required");
        }

        // Get auto-response statistics
        const autoResponseStats = await db
          .select({
            total: count(),
            // count(col) counts every non-null value, true and false alike: count only the trues.
            applied: sql<number>`count(*) FILTER (WHERE ${ticketAutoResponses.wasApplied} = true)::int`,
            helpful: sql<number>`count(*) FILTER (WHERE ${ticketAutoResponses.wasHelpful} = true)::int`,
            avgConfidence: avg(ticketAutoResponses.confidenceScore),
          })
          .from(ticketAutoResponses);

        // Get complexity distribution
        const complexityDist = await db
          .select({
            range: sql<string>`
            CASE 
              WHEN complexity_score < 20 THEN 'Very Low'
              WHEN complexity_score < 40 THEN 'Low'
              WHEN complexity_score < 60 THEN 'Medium'
              WHEN complexity_score < 80 THEN 'High'
              ELSE 'Very High'
            END
          `,
            count: count(),
          })
          .from(ticketComplexityScores)
          .groupBy(sql`1`);

        // Get knowledge base stats
        const kbStats = await db
          .select({
            totalArticles: count(),
            publishedArticles: sql<number>`count(*) FILTER (WHERE ${knowledgeArticles.isPublished} = true)::int`,
            avgEffectiveness: avg(knowledgeArticles.effectivenessScore),
            totalUsage: sum(knowledgeArticles.usageCount),
          })
          .from(knowledgeArticles);

        res.json({
          autoResponse: autoResponseStats[0],
          complexity: complexityDist,
          knowledgeBase: kbStats[0],
        });
      } catch (error) {
        console.error("Error fetching AI analytics:", describeAIError(error));
        fail(res, 500, "Failed to fetch AI analytics");
      }
    }
  );

  // Escalation Rules Management

  // Get escalation rules
  app.get(
    "/api/admin/escalation-rules",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const rules = await db
          .select()
          .from(escalationRules)
          .orderBy(desc(escalationRules.priority));

        res.json(rules);
      } catch (error) {
        logRouteError("Error fetching escalation rules", error);
        fail(res, 500, "Failed to fetch escalation rules");
      }
    }
  );

  // Create escalation rule
  app.post(
    "/api/admin/escalation-rules",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const rule = await db
          .insert(escalationRules)
          .values(req.body)
          .returning();

        res.json(rule[0]);
      } catch (error) {
        logRouteError("Error creating escalation rule", error);
        fail(res, 500, "Failed to create escalation rule");
      }
    }
  );

  // Update escalation rule
  app.put(
    "/api/admin/escalation-rules/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const ruleId = parseInt(req.params.id);
        const rule = await db
          .update(escalationRules)
          .set(req.body)
          .where(eq(escalationRules.id, ruleId))
          .returning();

        res.json(rule[0]);
      } catch (error) {
        logRouteError("Error updating escalation rule", error);
        fail(res, 500, "Failed to update escalation rule");
      }
    }
  );

  // Delete escalation rule
  app.delete(
    "/api/admin/escalation-rules/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const ruleId = parseInt(req.params.id);
        await db.delete(escalationRules).where(eq(escalationRules.id, ruleId));

        res.json({ message: "Rule deleted successfully" });
      } catch (error) {
        logRouteError("Error deleting escalation rule", error);
        fail(res, 500, "Failed to delete escalation rule");
      }
    }
  );

  // Self-Learning Knowledge Base Endpoints

  // Submit feedback on AI response
  app.post("/api/ai-feedback", isAuthenticated, async (req: any, res, next) => {
    try {
      const userId = getUserId(req);
      const { feedbackType, referenceId, rating, comment, ticketId } = req.body;

      // Feedback attached to a ticket needs access to that ticket. Feedback on
      // an auto-response belongs to that auto-response's ticket: the ticket is
      // derived from it, and a client ticketId may only confirm it.
      let feedbackTicketId: number | null = null;
      if (feedbackType === "auto_response") {
        const autoResponseId = parseIdParam(String(referenceId ?? ""), "referenceId");
        const [autoResponse] = await db
          .select({ ticketId: ticketAutoResponses.ticketId })
          .from(ticketAutoResponses)
          .where(eq(ticketAutoResponses.id, autoResponseId))
          .limit(1);
        if (!autoResponse) {
          throw new HttpError(404, "not_found", "Auto-response not found");
        }
        await assertTaskAccess(req.user, autoResponse.ticketId);
        if (
          ticketId !== undefined &&
          ticketId !== null &&
          Number(ticketId) !== autoResponse.ticketId
        ) {
          throw new HttpError(
            400,
            "validation_failed",
            "ticketId does not match the auto-response's ticket"
          );
        }
        feedbackTicketId = autoResponse.ticketId;
      } else if (ticketId !== undefined && ticketId !== null) {
        feedbackTicketId = parseIdParam(String(ticketId), "ticketId");
        await assertTaskAccess(req.user, feedbackTicketId);
      }

      // Validate rating
      if (![1, 5].includes(rating)) {
        throw new HttpError(
          400,
          "validation_failed",
          "Rating must be 1 (thumbs down) or 5 (thumbs up)"
        );
      }

      const feedback = await db
        .insert(aiFeedback)
        .values({
          feedbackType,
          referenceId,
          userId,
          rating,
          comment,
          ticketId: feedbackTicketId,
        })
        .returning();

      // Update knowledge article helpful/unhelpful counters and effectiveness
      if (feedbackType === "knowledge_article") {
        if (rating === 5 || rating === 1) {
          const field =
            rating === 5 ? sql`helpful_votes` : sql`unhelpful_votes`;
          await db.execute(
            sql`UPDATE knowledge_articles SET ${field} = ${field} + 1 WHERE id = ${referenceId}`
          );
        }
        await storage.updateArticleEffectiveness(referenceId, rating);
      }

      res.json(feedback[0]);
    } catch (error) {
      next(error);
    }
  });

  // Get AI feedback for a reference
  app.get(
    "/api/ai-feedback/:type/:referenceId",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const { type } = req.params;
        const referenceId = parseIdParam(req.params.referenceId, "referenceId");
        const sameReference = and(
          eq(aiFeedback.feedbackType, type),
          eq(aiFeedback.referenceId, referenceId)
        );

        if (type === "auto_response") {
          // Feedback on an auto-response is readable by whoever may see its ticket.
          const [autoResponse] = await db
            .select({ ticketId: ticketAutoResponses.ticketId })
            .from(ticketAutoResponses)
            .where(eq(ticketAutoResponses.id, referenceId))
            .limit(1);
          if (!autoResponse) {
            throw new HttpError(404, "not_found", "Auto-response not found");
          }
          await assertTaskAccess(req.user, autoResponse.ticketId);
          const feedback = await db
            .select()
            .from(aiFeedback)
            .where(sameReference)
            .orderBy(desc(aiFeedback.createdAt));
          return res.json(feedback);
        }

        // Other types: only rows whose ticket the user may see. A row with no
        // ticket matches no tasks row, so only an admin (rule TRUE) sees it.
        const feedback = await db
          .select(getTableColumns(aiFeedback))
          .from(aiFeedback)
          .leftJoin(tasks, eq(tasks.id, aiFeedback.ticketId))
          .where(and(sameReference, ticketVisibilityWhere(req.user)))
          .orderBy(desc(aiFeedback.createdAt));

        res.json(feedback);
      } catch (error) {
        next(error);
      }
    }
  );

  // Search knowledge base with semantic search
  app.post(
    "/api/knowledge-base/search",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { query, limit = 5 } = req.body;

        if (!query) {
          return fail(res, 400, "Search query is required");
        }

        const results = await intelligentKnowledgeSearch(
          query,
          undefined,
          limit
        );

        res.json(results);
      } catch (error) {
        logRouteError("Error searching knowledge base", error);
        fail(res, 500, "Failed to search knowledge base");
      }
    }
  );

  // Add ticket to learning queue when resolved
  app.post(
    "/api/tasks/:id/add-to-learning",
    isAuthenticated,
    requireTaskAccess(),
    async (req: any, res) => {
      try {
        const taskId = parseInt(req.params.id);

        // Check if ticket is resolved
        const [task] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1);

        if (!task || task.status !== "resolved") {
          return fail(res, 400, "Only resolved tickets can be added to learning queue");
        }

        // Check if already in queue
        const existing = await db
          .select()
          .from(learningQueue)
          .where(eq(learningQueue.ticketId, taskId))
          .limit(1);

        if (existing.length > 0) {
          return fail(res, 400, "Ticket already in learning queue");
        }

        // Add to queue
        const [queueItem] = await db
          .insert(learningQueue)
          .values({ ticketId: taskId })
          .returning();

        res.json(queueItem);
      } catch (error) {
        logRouteError("Error adding to learning queue", error);
        fail(res, 500, "Failed to add to learning queue");
      }
    }
  );

  // Process learning queue (admin only)
  app.post(
    "/api/admin/learning-queue/process",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        // Process knowledge learning queue asynchronously
        processKnowledgeLearning().catch(console.error);

        res.json({ message: "Learning queue processing started" });
      } catch (error) {
        logRouteError("Error starting learning queue", error);
        fail(res, 500, "Failed to start learning queue");
      }
    }
  );

  // Seed historical tickets for learning (admin only)
  app.post(
    "/api/admin/learning-queue/seed",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const { daysBack = 90 } = req.body;

        // Seed historical tickets for learning
        console.log(
          `Started seeding historical tickets from the last ${daysBack} days`
        );
        // Historical ticket seeding would be implemented here

        res.json({
          message: `Started seeding historical tickets from the last ${daysBack} days`,
        });
      } catch (error) {
        logRouteError("Error seeding historical tickets", error);
        fail(res, 500, "Failed to seed historical tickets");
      }
    }
  );

  // Get learning queue status (returns object format for client)
  app.get(
    "/api/admin/learning-queue",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const statusArray = await db
          .select({
            status: learningQueue.processStatus,
            count: count(),
          })
          .from(learningQueue)
          .groupBy(learningQueue.processStatus);

        // Transform array to object format expected by client
        const statusObj: any = {
          pending: 0,
          processing: 0,
          completedToday: 0,
        };

        // Get today's completed count separately
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [completedTodayResult] = await db
          .select({ count: count() })
          .from(learningQueue)
          .where(
            and(
              eq(learningQueue.processStatus, "completed"),
              sql`${learningQueue.processedAt} >= ${today}`
            )
          );

        statusArray.forEach((item: any) => {
          const status = item.status || "pending";
          const count = Number(item.count) || 0;

          if (status === "pending") {
            statusObj.pending = count;
          } else if (status === "processing") {
            statusObj.processing = count;
          }
        });

        statusObj.completedToday = Number(completedTodayResult?.count || 0);
        statusObj.isProcessing = statusObj.processing > 0;
        statusObj.totalInQueue = statusObj.pending + statusObj.processing;

        res.json(statusObj);
      } catch (error) {
        logRouteError("Error fetching learning queue status", error);
        fail(res, 500, "Failed to fetch learning queue status");
      }
    }
  );

  // Get learning queue status (alternative endpoint with array format)
  app.get(
    "/api/admin/learning-queue/status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const status = await db
          .select({
            status: learningQueue.processStatus,
            count: count(),
          })
          .from(learningQueue)
          .groupBy(learningQueue.processStatus);

        res.json(status);
      } catch (error) {
        logRouteError("Error fetching learning queue status", error);
        fail(res, 500, "Failed to fetch learning queue status");
      }
    }
  );

  // Batch process historical tickets for knowledge learning (admin only)
  app.post(
    "/api/admin/batch-process",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const { start, end } = req.body;

        if (!start || !end) {
          return fail(res, 400, "Start and end dates are required");
        }

        // Parse dates
        const startDate = new Date(start);
        const endDate = new Date(end);

        // Validate dates
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return fail(res, 400, "Invalid date format. Use YYYY-MM-DD format");
        }

        if (startDate > endDate) {
          return fail(res, 400, "Start date must be before end date");
        }

        // Check if there are any items currently being processed
        const [processingCountResult] = await db
          .select({ count: count() })
          .from(learningQueue)
          .where(eq(learningQueue.processStatus, "processing"))
          .limit(1);

        const processingCount = Number(processingCountResult?.count || 0);

        if (processingCount > 0) {
          return fail(
            res,
            409,
            "Batch processing is already in progress. Please wait for the current process to complete.",
            {
              code: "batch_in_progress",
              details: { isProcessing: true, processingCount },
            }
          );
        }

        // Get ticket count for the date range
        const tickets = await storage.getResolvedTicketsByDateRange(
          startDate,
          endDate
        );

        const ticketCount = tickets.length;

        if (ticketCount === 0) {
          return res.json({
            ticketCount: 0,
            message: "No resolved tickets found in the specified date range",
          });
        }

        // Add all tickets to learning queue with "pending" status
        let addedCount = 0;
        for (const ticket of tickets) {
          if (!ticket.id) continue;

          // Check if already in queue to avoid duplicates
          const existing = await db
            .select()
            .from(learningQueue)
            .where(eq(learningQueue.ticketId, ticket.id))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(learningQueue).values({
              ticketId: ticket.id,
              processStatus: "pending",
            });
            addedCount++;
          }
        }

        console.log(
          `Added ${addedCount} tickets to learning queue (${
            ticketCount - addedCount
          } already in queue)`
        );

        // Process knowledge learning asynchronously for the date range
        // Pass useQueueItems flag to process from queue
        processKnowledgeLearning({
          startDate,
          endDate,
          useQueueItems: true,
        }).catch((error) => {
          console.error("Error processing batch learning:", describeAIError(error));
        });

        res.json({
          ticketCount,
          message: `Batch processing started for ${ticketCount} resolved tickets from ${start} to ${end}`,
        });
      } catch (error) {
        console.error("Error starting batch processing:", describeAIError(error));
        fail(res, 500, "Failed to start batch processing");
      }
    }
  );

  // Get AI analytics for learning dashboard
  app.get("/api/admin/ai-analytics", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (!user || user.role !== "admin") {
        return fail(res, 403, "Admin access required");
      }

      // Get knowledge articles statistics
      const [articlesCount] = await db
        .select({ count: count() })
        .from(knowledgeArticles);

      // Get average effectiveness score
      const [avgEffectivenessResult] = await db
        .select({
          avgScore: avg(knowledgeArticles.effectivenessScore),
        })
        .from(knowledgeArticles)
        .where(
          and(
            sql`${knowledgeArticles.effectivenessScore} IS NOT NULL`,
            sql`${knowledgeArticles.effectivenessScore} > 0`
          )
        );

      const avgEffectiveness = avgEffectivenessResult?.avgScore
        ? Number(avgEffectivenessResult.avgScore)
        : 0;

      // Get auto-responses sent count
      // (applied ones only: a draft nobody posted was not "sent")
      const [autoResponsesCount] = await db
        .select({ count: count() })
        .from(ticketAutoResponses)
        .where(eq(ticketAutoResponses.wasApplied, true));

      // Tickets resolved by AI: DISTINCT tickets that are resolved/closed now and whose applied
      // auto-response was posted before the LATEST resolve/close (GREATEST, not COALESCE: after
      // a reopen and a second resolve, resolvedAt alone is stale). "Posted" is the AI comment's
      // time (the applied time; the draft's createdAt is when it was generated), falling back to
      // the draft's createdAt for a row whose comment cannot be found.
      const [ticketsResolvedByAIResult] = await db
        .select({ count: sql<number>`count(DISTINCT ${ticketAutoResponses.ticketId})::int` })
        .from(ticketAutoResponses)
        .innerJoin(tasks, eq(ticketAutoResponses.ticketId, tasks.id))
        .where(
          and(
            eq(ticketAutoResponses.wasApplied, true),
            inArray(tasks.status, ["resolved", "closed"]),
            sql`GREATEST(${tasks.resolvedAt}, ${tasks.closedAt}) >= COALESCE(
              (SELECT MIN(c.created_at) FROM task_comments c
                WHERE c.task_id = ${ticketAutoResponses.ticketId}
                  AND c.user_id = ${ticketAutoResponses.respondedBy}
                  AND c.content LIKE 'AI Auto-Response (confidence %'
                  AND c.created_at >= ${ticketAutoResponses.createdAt}),
              ${ticketAutoResponses.createdAt})`
          )
        );

      // Get top categories by article count
      const topCategories = await db
        .select({
          category: knowledgeArticles.category,
          count: count(),
        })
        .from(knowledgeArticles)
        .where(sql`${knowledgeArticles.category} IS NOT NULL`)
        .groupBy(knowledgeArticles.category)
        .orderBy(desc(count()))
        .limit(5);

      res.json({
        articlesCreated: Number(articlesCount?.count || 0),
        avgEffectiveness: avgEffectiveness,
        autoResponsesSent: Number(autoResponsesCount?.count || 0),
        ticketsResolvedByAI: Number(ticketsResolvedByAIResult?.count || 0),
        topCategories: topCategories.map((cat: any) => ({
          category: cat.category || "uncategorized",
          count: Number(cat.count || 0),
        })),
      });
    } catch (error) {
      console.error("Error fetching AI analytics:", describeAIError(error));
      fail(res, 500, "Failed to fetch AI analytics");
    }
  });

  const httpServer = createServer(app);

  // Real-time updates: the WebSocket lives in ../realtime/ws (session-authenticated upgrade).
  attachRealtime(httpServer, { trustProxy: Boolean(app.get("trust proxy")) });

  // Inbound email creates tickets outside this file; its "created" event goes to the
  // same recipients as POST /api/tasks (everyone connected who can see the ticket).
  setTicketCreatedBroadcaster((task) => {
    void notifyTicket(task.id, "created");
  });

  /* Staff tool on the AI Analytics page: runs Bedrock-powered analysis on a TICKET
   * the caller may see and returns (complexity, confidence, auto-response, ...).
   * Body is { ticketId }; the ticket text is loaded here, never taken from the client.
   * Order: 400 bad body, 404 missing, 403 outside scope or customer, 503 AI not configured, 429 over quota.
   */
  app.post(
    "/api/ai/analyze-ticket",
    isAuthenticated,
    loadAiTicket,
    async (req: any, res) => {
      try {
        const task = req.aiTicket;
        const { aiAutoResponseService } = await import(
          "../services/ai/aiAutoResponse"
        );
        // Without an id the analysis stores nothing about the ticket (it is a read-only tool).
        const analysis = await aiAutoResponseService.analyzeTicket({
          ...task,
          id: undefined,
        } as any);

        if (!analysis) {
          return res.status(503).json({
            error: "ai_unavailable",
            message: "AI analysis service unavailable",
          });
        }

        res.json(analysis);
      } catch (error) {
        console.error("AI analysis error:", describeAIError(error));
        if (isQuotaBlocked(error)) return sendQuotaExceeded(res, error);
        res
          .status(500)
          .json({ error: "ai_failed", message: "Failed to analyze ticket" });
      }
    }
  );

  app.post(
    "/api/ai/generate-response",
    isAuthenticated,
    loadAiTicket,
    async (req: any, res) => {
      try {
        const task = req.aiTicket;

        // Same switch as the on-demand auto-response: an admin who turned it off turned it off.
        const aiSettings = await getAISettings();
        if (!aiSettings.autoResponseEnabled) {
          return res
            .status(400)
            .json({ error: "ai_disabled", message: "Auto-response is disabled in settings" });
        }

        // The ticket text is the stored one; so is the analysis (computed here, not sent by the client).
        const ticketData = {
          title: task.title,
          description: task.description || "",
          category: task.category || "support",
          priority: task.priority || "medium",
          reporterId: req.user.id,
        };

        const analysis = await analyzeTicketWithAI(ticketData);
        if (!analysis) {
          return res.status(503).json({
            error: "ai_unavailable",
            message: "AI analysis service unavailable",
          });
        }

        const autoResponse = await generateAutoResponseForTicket(
          ticketData,
          analysis
        );

        if (!autoResponse) {
          return res.status(503).json({
            error: "ai_unavailable",
            message: "AI response generation service unavailable",
          });
        }

        return res.json(autoResponse);
      } catch (error: any) {
        console.error("AI response generation error:", describeAIError(error));

        // If Bedrock/cost limits blocked the request, surface that clearly
        if (isQuotaBlocked(error)) return sendQuotaExceeded(res, error);

        return res
          .status(500)
          .json({ error: "ai_failed", message: "Failed to generate response" });
      }
    }
  );

  // Knowledge Base Learning Routes
  app.post(
    "/api/ai/knowledge-learning/run",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        // Only admins can manually trigger knowledge learning
        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const results = await processKnowledgeLearning();
        res.json({
          message: "Knowledge learning process completed",
          ...results,
        });
      } catch (error) {
        console.error("Knowledge learning error:", describeAIError(error));
        fail(res, 500, "Failed to run knowledge learning");
      }
    }
  );

  app.get(
    "/api/ai/knowledge-search",
    // Only the staff AI Analytics page calls this (grep client/src): staff only.
    isAuthenticated,
    requireStaff,
    async (req: any, res, next) => {
      try {
        const parsed = knowledgeSearchQuery.parse(req.query ?? {});

        const results = await intelligentKnowledgeSearch(
          parsed.query,
          parsed.category as string,
          parsed.maxResults
        );

        res.json(results);
      } catch (error) {
        if (error instanceof z.ZodError) return next(error);
        console.error("Knowledge search error:", describeAIError(error));
        if (isQuotaBlocked(error)) return sendQuotaExceeded(res, error);
        res
          .status(500)
          .json({ error: "ai_failed", message: "Failed to search knowledge base" });
      }
    }
  );

  // AI System Status Route
  app.get("/api/ai/status", isAuthenticated, requireStaff, async (req: any, res) => {
    try {
      // 1) Check env credentials
      const envAwsConfigured = !!(
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        process.env.AWS_REGION
      );

      // 2) Check stored SMTP (SES) and Bedrock settings
      const smtp = undefined as any;
      let bedrock = undefined as any;
      try {
        //smtp = await storage.getSmtpSettings();
      } catch { /* SMTP settings are no longer read (see commented line above) */ }
      try {
        bedrock = await storage.getBedrockSettings();
      } catch { /* no stored Bedrock settings: treat as not configured */ }

      const sesConfigured = !!(
        smtp?.awsAccessKeyId &&
        smtp?.awsSecretAccessKey &&
        smtp?.awsRegion
      );
      const bedrockConfigured = !!(
        bedrock?.bedrockAccessKeyId &&
        bedrock?.bedrockSecretAccessKey &&
        (bedrock?.bedrockRegion || process.env.AWS_REGION)
      );

      const awsConfigured =
        envAwsConfigured || sesConfigured || bedrockConfigured;

      // Active model id if available
      const activeModelId: string | undefined =
        bedrock?.bedrockModelId || undefined;

      res.json({
        awsCredentials: awsConfigured,
        bedrockAvailable: awsConfigured,
        modelId: activeModelId,
        knowledgeLearning: awsConfigured,
        autoResponse: awsConfigured,
        features: {
          ticketAnalysis: awsConfigured,
          autoResponse: awsConfigured,
          knowledgeLearning: awsConfigured,
          intelligentSearch: awsConfigured,
        },
      });
    } catch (error) {
      console.error("AI status check error:", describeAIError(error));
      fail(res, 500, "Failed to check AI status");
    }
  });

  // Knowledge Base Management Routes (admin only)

  // Get a specific knowledge article
  app.get(
    "/api/admin/knowledge/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return fail(res, 403, "Admin access required");
        }

        const id = parseInt(req.params.id);
        const article = await storage.getKnowledgeArticle(id);

        if (!article) {
          return fail(res, 404, "Knowledge article not found");
        }

        res.json(article);
      } catch (error) {
        logRouteError("Error fetching knowledge article", error);
        fail(res, 500, "Failed to fetch knowledge article");
      }
    }
  );

  // Unpublish / Archive / Unarchive endpoints (publish is registered with the
  // other admin knowledge routes above)
  app.patch(
    "/api/admin/knowledge/:id/unpublish",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);
        if (user?.role !== "admin")
          return fail(res, 403, "Admin access required");
        const id = parseInt(req.params.id);
        const article = await storage.setKnowledgeArticleStatus(id, "draft");
        res.json(article);
      } catch (error) {
        logRouteError("Error unpublishing article", error);
        fail(res, 500, "Failed to unpublish article");
      }
    }
  );

  app.patch(
    "/api/admin/knowledge/:id/archive",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);
        if (user?.role !== "admin")
          return fail(res, 403, "Admin access required");
        const id = parseInt(req.params.id);
        const article = await storage.setKnowledgeArticleStatus(id, "archived");
        res.json(article);
      } catch (error) {
        logRouteError("Error archiving article", error);
        fail(res, 500, "Failed to archive article");
      }
    }
  );

  app.patch(
    "/api/admin/knowledge/:id/unarchive",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);
        if (user?.role !== "admin")
          return fail(res, 403, "Admin access required");
        const id = parseInt(req.params.id);
        const article = await storage.setKnowledgeArticleStatus(id, "draft");
        res.json(article);
      } catch (error) {
        logRouteError("Error unarchiving article", error);
        fail(res, 500, "Failed to unarchive article");
      }
    }
  );

  // Get published knowledge articles (for all users)
  app.get("/api/knowledge/articles", isAuthenticated, async (req: any, res) => {
    try {
      const { category } = req.query;
      const articles = await storage.getPublishedKnowledgeArticles(
        category as string
      );
      res.json(articles);
    } catch (error) {
      logRouteError("Error fetching published articles", error);
      fail(res, 500, "Failed to fetch knowledge articles");
    }
  });

  // Increment knowledge article view count
  app.post(
    "/api/knowledge/articles/:id/view",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id);
        await storage.incrementKnowledgeArticleView(id);
        res.json({ success: true });
      } catch (error) {
        logRouteError("Error incrementing view count", error);
        fail(res, 500, "Failed to increment view count");
      }
    }
  );

  // Track article usage (when users view an article)
  app.post(
    "/api/knowledge/:id/track-usage",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id);
        await storage.incrementKnowledgeArticleUsage(id);
        res.json({ message: "Usage tracked successfully" });
      } catch (error) {
        logRouteError("Error tracking article usage", error);
        fail(res, 500, "Failed to track usage");
      }
    }
  );

  // Rate article effectiveness (user feedback)
  app.post(
    "/api/knowledge/:id/rate",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id);
        const { rating } = req.body;

        if (rating < 1 || rating > 5) {
          return fail(res, 400, "Rating must be between 1 and 5");
        }

        // Update helpful/unhelpful counters based on rating
        // 5 => helpful, 1 => unhelpful, others ignored for counters but still recalculated
        if (rating === 5 || rating === 1) {
          const field = rating === 5 ? "helpful_votes" : "unhelpful_votes";
          await db.execute(
            sql`UPDATE knowledge_articles SET ${sql.raw(field)} = ${sql.raw(
              field
            )} + 1 WHERE id = ${id}`
          );
        }
        await storage.updateArticleEffectiveness(id, rating);
        res.json({ message: "Rating submitted successfully" });
      } catch (error) {
        logRouteError("Error rating article", error);
        fail(res, 500, "Failed to submit rating");
      }
    }
  );

  // Stats endpoints
  app.get("/api/stats/agent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 404, "User not found", { code: "user_not_found" });
      }

      if (user.role !== "agent") {
        return fail(res, 403, "Access denied. Agent role required.");
      }

      const stats = await storage.getAgentStats(userId);
      res.json(stats);
    } catch (error) {
      logRouteError("Error fetching agent stats", error);
      fail(res, 500, "Failed to fetch agent stats");
    }
  });

  app.get("/api/stats/manager", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 404, "User not found", { code: "user_not_found" });
      }

      if (user.role !== "manager") {
        return fail(res, 403, "Access denied. Manager role required.");
      }

      const stats = await storage.getManagerStats(userId);
      res.json(stats);
    } catch (error) {
      logRouteError("Error fetching manager stats", error);
      fail(res, 500, "Failed to fetch manager stats");
    }
  });

  // Initialize AI systems
  try {
    // Start knowledge learning scheduler
    scheduleKnowledgeLearning();
    console.log("AI systems initialized successfully");
  } catch (error) {
    logRouteError("AI system initialization error", error);
  }

  // MCP (Streamable HTTP, stateless): after every REST route, before the /api 404 handler
  // the caller installs. Bearer auth ran in setupAuth; the router requires an mcp:tickets key.
  app.use("/api/mcp", createMcpRouter());

  return httpServer;
}
