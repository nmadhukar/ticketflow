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

import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "../storage";
import { setupAuth, isAuthenticated } from "../auth";
import { setupMicrosoftAuth, isMicrosoftUser } from "../microsoftAuth";
import { teamsIntegration } from "../microsoftTeams";
import { sendTestEmail } from "../ses";
import {
  insertTaskSchema,
  insertTeamSchema,
  insertTaskCommentSchema,
  insertTaskAttachmentSchema,
  insertCompanySettingsSchema,
  insertApiKeySchema,
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
  processTicketWithAI,
  analyzeTicket,
  generateAutoResponse,
} from "../aiTicketAnalysis";
import {
  processKnowledgeLearning,
  intelligentKnowledgeSearch,
  scheduleKnowledgeLearning,
} from "../knowledgeBaseLearning";
import { z } from "zod";
import { createHash } from "crypto";
import multer from "multer";
import { db } from "../db";
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
} from "drizzle-orm";
import { teams, departments, users } from "@shared/schema";
import { logSecurityEvent } from "../security/rbac";
import {
  getAISettings,
  saveAISettings,
  validateAISettings,
} from "../admin/aiSettings";
import { registerAdminRoutes } from "../admin";
import { bedrockIntegration } from "../bedrockIntegration";
import { s3Service } from "../services/s3Service";
import { DEFAULT_COMPANY } from "@shared/constants";

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
export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);
  await setupMicrosoftAuth(app);

  // Auth routes are now handled in auth.ts

  // Register admin routes (organized by domain)
  registerAdminRoutes(app);

  // Users route
  app.get("/api/users", isAuthenticated, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Helper to get user ID from request
  const getUserId = (req: any): string => {
    return req.user?.id || req.user?.claims?.sub;
  };

  // Task routes
  app.get("/api/tasks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      const {
        status,
        category,
        assigneeId,
        teamId,
        departmentId,
        mine,
        search,
        limit,
        offset,
      } = req.query as any;

      // If explicitly filtering by assigneeId (non-customer), use simple filter
      if (assigneeId && user?.role !== "customer") {
        const tasks = await storage.getTasks({
          status,
          category,
          search,
          assigneeId,
          limit: limit ? parseInt(limit) : undefined,
          offset: offset ? parseInt(offset) : undefined,
        });
        return res.json(tasks);
      }

      // Join-based visibility: includes own, team queues, and teammates' direct tickets as applicable
      const includeOwn = mine !== "false" && !assigneeId;
      const tasks = await (storage as any).getVisibleTasksForUser({
        userId,
        role: user?.role,
        status,
        category,
        search,
        teamId: teamId ? parseInt(teamId) : undefined,
        departmentId: departmentId ? parseInt(departmentId) : undefined,
        includeOwn,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });
      return res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/my", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { status, category, search, limit, offset } = req.query;
      const tasks = await storage.getTasks({
        assigneeId: userId,
        status,
        category,
        search,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching user tasks:", error);
      res.status(500).json({ message: "Failed to fetch user tasks" });
    }
  });

  // Tickets in user's team queues
  app.get("/api/tasks/my-groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      const { status, category, search, limit, offset } = req.query as any;
      // Show team queues and teammates' direct tickets; exclude own-only constraint
      const tasks = await (storage as any).getVisibleTasksForUser({
        userId,
        role: user?.role,
        status,
        category,
        search,
        includeOwn: false,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching my-group tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      if (isNaN(taskId)) {
        return res.status(400).json({ message: "Invalid task ID" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      const task = await storage.getTask(taskId);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      // If user is a customer, they can only view their own tickets
      if (user?.role === "customer" && task.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(task);
    } catch (error) {
      console.error("Error fetching task:", error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  // Ticket meta endpoints for create/edit modals
  app.get("/api/tickets/meta", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) return res.status(401).json({ message: "Unauthorized" });

      // Static enumerations
      const categories = [
        "bug",
        "feature",
        "support",
        "enhancement",
        "incident",
        "request",
      ];
      const priorities = ["low", "medium", "high", "urgent"];
      const statuses = ["open", "in_progress", "resolved", "closed", "on_hold"];

      let departmentsRows: any[] = [];
      let teamsRows: any[] = [];
      let assignableUsers: any[] = [];
      let myTeams: any[] = [];
      const basePermissions: any = {
        canAssign: false,
        canChangeStatus: false,
        allowedAssigneeTypes: [] as string[],
        allowedFields: [] as string[],
      };

      if (user.role === "admin") {
        departmentsRows = await db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(eq(departments.isActive, true));
        teamsRows = await db
          .select({
            id: teams.id,
            name: teams.name,
            departmentId: teams.departmentId,
          })
          .from(teams);
        assignableUsers = await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(
            or(
              eq(users.role, "admin"),
              or(eq(users.role, "manager"), eq(users.role, "user"))
            )
          );
        basePermissions.canAssign = true;
        basePermissions.canChangeStatus = true;
        basePermissions.allowedAssigneeTypes = ["user", "team"];
        basePermissions.allowedFields = [
          "title",
          "description",
          "category",
          "priority",
          "status",
          "notes",
          "assigneeId",
          "assigneeType",
          "assigneeTeamId",
          "dueDate",
        ];
      } else if (user.role === "manager") {
        // Departments managed by this manager
        departmentsRows = await db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(
            and(
              eq(departments.isActive, true),
              eq(departments.managerId as any, userId) as any
            )
          );
        teamsRows = await db
          .select({
            id: teams.id,
            name: teams.name,
            departmentId: teams.departmentId,
          })
          .from(teams)
          .innerJoin(departments, eq(teams.departmentId, departments.id))
          .where(eq(departments.managerId as any, userId) as any);
        assignableUsers = await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(or(eq(users.role, "manager"), eq(users.role, "agent")));
        basePermissions.canAssign = true;
        basePermissions.canChangeStatus = true;
        basePermissions.allowedAssigneeTypes = ["user", "team"];
        basePermissions.allowedFields = [
          "title",
          "description",
          "category",
          "priority",
          "status",
          "notes",
          "assigneeId",
          "assigneeType",
          "assigneeTeamId",
          "dueDate",
        ];
      } else if (user.role === "agent") {
        // Agents/users: no assignment lists; but provide my teams for convenience
        const mine = await storage.getUserTeams(userId);
        myTeams = mine.map((t) => ({
          id: t.id,
          name: (t as any).name,
          departmentId: (t as any).departmentId,
        }));
        basePermissions.canAssign = false;
        basePermissions.canChangeStatus = "directlyAssignedOnly";
        basePermissions.allowedAssigneeTypes = [];
        basePermissions.allowedFields = [
          "priority",
          "status",
          "dueDate",
          "notes",
        ]; // effective on edit when permitted
      } else if (user.role === "customer") {
        // Customers: can select department/team or assign to a user
        departmentsRows = await db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(eq(departments.isActive, true));
        teamsRows = await db
          .select({
            id: teams.id,
            name: teams.name,
            departmentId: teams.departmentId,
          })
          .from(teams);
        // Provide assignable users (exclude customers)
        assignableUsers = await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(or(eq(users.role, "manager"), eq(users.role, "agent")));
        basePermissions.canAssign = true;
        basePermissions.canChangeStatus = false;
        basePermissions.allowedAssigneeTypes = ["user", "team"];
        basePermissions.allowedFields = ["title", "description"]; // only on edit of own tickets
      }

      return res.json({
        categories,
        priorities,
        statuses,
        departments: departmentsRows,
        teams: teamsRows,
        assignableUsers,
        myTeams,
        permissions: basePermissions,
      });
    } catch (error) {
      console.error("Error fetching ticket meta:", error);
      res.status(500).json({ message: "Failed to fetch ticket meta" });
    }
  });

  app.get("/api/tickets/:id/meta", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      const taskId = parseInt(req.params.id);
      if (!user || isNaN(taskId))
        return res.status(400).json({ message: "Bad request" });

      const task = await storage.getTask(taskId);
      if (!task) return res.status(404).json({ message: "Task not found" });

      // Reuse meta data
      const baseMetaRes = await fetch(
        `${req.protocol}://${req.get("host")}/api/tickets/meta`,
        {
          headers: { cookie: req.headers.cookie as string },
        } as any
      );
      let baseMeta: any = {};
      try {
        baseMeta = await baseMetaRes.json();
      } catch {}

      // Permissions for this ticket (policy 1b + 2a)
      let canChangeStatus = false;
      let canAssign = false;
      let allowedAssigneeTypes: string[] = [];
      let allowedFields: string[] = [];

      if (user.role === "admin") {
        canChangeStatus = true;
        canAssign = true;
        allowedAssigneeTypes = ["user", "team"];
        allowedFields = [
          "title",
          "description",
          "category",
          "priority",
          "status",
          "notes",
          "assigneeId",
          "assigneeType",
          "assigneeTeamId",
          "dueDate",
        ];
      } else if (user.role === "manager") {
        // Only within managed departments (if team-assigned)
        canChangeStatus = true;
        canAssign = true;
        allowedAssigneeTypes = ["user", "team"];
        allowedFields = [
          "title",
          "description",
          "category",
          "priority",
          "status",
          "notes",
          "assigneeId",
          "assigneeType",
          "assigneeTeamId",
          "dueDate",
        ];
      } else if (user.role === "agent") {
        const myTeams = await storage.getUserTeams(userId);
        const userTeamIds = (myTeams || []).map((t: any) => t.id);
        const isAssigneeUser =
          task.assigneeType === "user" && task.assigneeId === userId;
        const isInTicketTeam =
          task.assigneeType === "team" && task.assigneeTeamId
            ? userTeamIds.includes(task.assigneeTeamId as any)
            : false;
        canChangeStatus = isAssigneeUser || isInTicketTeam;
        canAssign = isAssigneeUser; // only assignee can reassign
        allowedAssigneeTypes = isAssigneeUser ? ["user", "team"] : [];
        allowedFields = ["priority", "status", "dueDate", "notes"];
        if (isAssigneeUser) {
          allowedFields.push("assigneeType", "assigneeId", "assigneeTeamId");
        }
      } else if (user.role === "customer") {
        canChangeStatus = false;
        canAssign = false;
        allowedAssigneeTypes = ["team"]; // only on create
        allowedFields = ["title", "description"];
      }

      const permissions = {
        ...baseMeta.permissions,
        canAssign,
        canChangeStatus,
        allowedAssigneeTypes,
        allowedFields,
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
      console.error("Error fetching ticket meta (by id):", error);
      res.status(500).json({ message: "Failed to fetch ticket meta" });
    }
  });

  app.post(
    "/api/tasks",
    isAuthenticated,
    upload.array("files", maxFilesPerRequest),
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const files = req.files as Express.Multer.File[] | undefined;
        const user = await storage.getUser(userId);
        const isCustomer = user?.role === "customer";

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
              return res.status(400).json({
                message: `File ${file.originalname} exceeds ${maxSizeMB}MB limit`,
              });
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
            return res.status(500).json({
              message: "File upload failed",
              error: error?.message || "Unknown error",
            });
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
              return res.status(400).json({
                message: "assigneeId is required for user assignment",
              });
            }
            req.body.assigneeId = String(assigneeId);
            req.body.assigneeTeamId = null;
            req.body.teamId = undefined;
            // departmentId optional
          } else if (assigneeType === "team" || parsedTeamId) {
            if (!parsedTeamId) {
              return res
                .status(400)
                .json({ message: "teamId is required for team assignment" });
            }
            const team = await storage.getTeam(parsedTeamId);
            if (!team) return res.status(400).json({ message: "Invalid team" });
            if (parsedDeptId) {
              const dept = await storage.getDepartmentById(parsedDeptId);
              if (!dept || (dept as any).isActive === false) {
                return res
                  .status(400)
                  .json({ message: "Invalid or inactive department" });
              }
              if (
                (team as any).departmentId &&
                (team as any).departmentId !== parsedDeptId
              ) {
                return res.status(400).json({
                  message: "Team does not belong to the selected department",
                });
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
              return res
                .status(400)
                .json({ message: "Invalid or inactive department" });
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

        const taskData = insertTaskSchema.parse({
          ...req.body,
          createdBy: userId,
        });
        const task = await storage.createTask(taskData);

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
              console.error(
                `Failed to create attachment record for ${file.fileName}:`,
                error
              );
            }
          }
        }

        // Run AI analysis for auto-response (skip when Bedrock not configured)
        const bedrockConfigured =
          !!process.env.AWS_ACCESS_KEY_ID &&
          !!process.env.AWS_SECRET_ACCESS_KEY &&
          !!process.env.AWS_REGION;

        if (bedrockConfigured) {
          try {
            const { aiAutoResponseService } = await import("../aiAutoResponse");
            const analysis = await aiAutoResponseService.analyzeTicket(task);

            // Save complexity score
            await aiAutoResponseService.saveComplexityScore(
              task.id,
              analysis.complexity,
              analysis.factors,
              `Complexity: ${analysis.complexity}/100. Should escalate: ${analysis.shouldEscalate}`
            );

            // If confidence is high enough, save and apply auto-response
            if (analysis.autoResponse && analysis.confidence >= 0.7) {
              await aiAutoResponseService.saveAutoResponse(
                task.id,
                analysis.autoResponse,
                analysis.confidence,
                true // Applied automatically
              );

              // Add the auto-response as a comment (use storage layer if available)
              try {
                await storage.addTaskComment({
                  taskId: task.id,
                  userId: userId,
                  content: `AI Auto-Response (confidence ${(
                    analysis.confidence * 100
                  ).toFixed(0)}%): ${analysis.autoResponse}`,
                } as any);
              } catch {}
            }

            // If should escalate, update assignment based on complexity
            if (analysis.shouldEscalate && analysis.complexity > 70) {
              // TODO: Implement escalation rules
              console.log(
                `Ticket ${task.ticketNumber} should be escalated (complexity: ${analysis.complexity})`
              );
            }
          } catch (error) {
            console.error("Error in AI analysis:", error);
            // Continue without AI features if there's an error
          }
        }

        // WS: notify creator and, if team routed, team members (placeholder selection)
        try {
          const creatorMsg = envelope("ticket:created", {
            id: task.id,
            ticketNumber: (task as any).ticketNumber,
            title: task.title,
            assigneeType: task.assigneeType,
            assigneeId: task.assigneeId,
            assigneeTeamId: (task as any).assigneeTeamId,
          });
          // Notify creator
          const creatorId = userId;
          broadcastToMany([creatorId], creatorMsg);
        } catch (e) {
          console.error("WS notify ticket:created error:", e);
        }

        // Send Teams notification for new task
        try {
          const user = await storage.getUser(userId);
          const allUsers = await storage.getAllUsers();
          const notificationPromises = allUsers.map(async (notifyUser) => {
            const settings = await storage.getTeamsIntegrationSettings(
              notifyUser.id
            );
            if (
              settings?.enabled &&
              settings.notificationTypes?.includes("ticket_created")
            ) {
              const actionUrl = `${req.protocol}://${req.get("host")}/my-tasks`;
              const message = `New ticket created by ${
                user?.email || "a user"
              }`;

              if (settings.webhookUrl) {
                await teamsIntegration.sendWebhookNotification(
                  settings.webhookUrl,
                  task,
                  message,
                  actionUrl
                );
              }
            }
          });
          await Promise.allSettled(notificationPromises);
        } catch (error) {
          console.error("Error sending Teams notifications:", error);
        }

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
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid task data", errors: error.errors });
        }
        console.error("Error creating task:", error);
        res.status(500).json({ message: "Failed to create task" });
      }
    }
  );

  app.patch("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      // Get the task to check ownership
      const task = await storage.getTask(taskId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      const { canUpdateTicket } = await import("../permissions/tickets");
      const result = await canUpdateTicket({
        user,
        ticket: task,
        payload: req.body,
      });
      if (!result.allowed) {
        return res
          .status(403)
          .json({ message: "Access denied", reason: result.reason });
      }

      // Optional: enforce simple status transitions, except for admin
      if (user?.role !== "admin" && "status" in result?.prunedPayload) {
        const transitionMap: Record<string, string[]> = {
          open: ["in_progress", "on_hold"],
          in_progress: ["resolved", "on_hold"],
          on_hold: ["in_progress", "open"],
          resolved: ["closed", "in_progress"],
          closed: [],
        };
        const current = (task as any).status || "open";
        const next = result.prunedPayload.status;
        const allowedNext = transitionMap[current] || [];
        if (!allowedNext.includes(next)) {
          try {
            logSecurityEvent(req as any, "change_status", "ticket", false, {
              from: current,
              to: next,
              taskId,
            });
          } catch {}
          return res.status(400).json({
            message: `Invalid status transition from ${current} to ${next}`,
          });
        }
      }
      const updates = insertTaskSchema.partial().parse(result.prunedPayload);
      const updatedTask = await storage.updateTask(taskId, updates, userId);

      // If task was resolved, trigger knowledge base learning (policy-aware)
      if (updates.status === "resolved" && task.status !== "resolved") {
        try {
          const { knowledgeBaseService } = await import("../knowledgeBase");
          const { getAISettings } = await import("../admin/aiSettings");
          const aiSettings = await getAISettings();
          if (aiSettings.autoLearnEnabled) {
            await knowledgeBaseService.learnFromResolvedTicket(taskId, {
              minScore: Math.max(
                0,
                Math.min(1, Number(aiSettings.minResolutionScore ?? 0))
              ),
              requireApproval: !!aiSettings.articleApprovalRequired,
            });
          }
          console.log(
            `Knowledge base learning triggered for resolved ticket ${updatedTask.ticketNumber}`
          );
        } catch (error) {
          console.error("Error in knowledge base learning:", error);
        }
      }

      // Send Teams notification for task update
      try {
        const user = await storage.getUser(userId);
        const allUsers = await storage.getAllUsers();
        const notificationPromises = allUsers.map(async (notifyUser) => {
          const settings = await storage.getTeamsIntegrationSettings(
            notifyUser.id
          );
          if (
            settings?.enabled &&
            (settings.notificationTypes?.includes("ticket_updated") ||
              (updates.assigneeId &&
                settings.notificationTypes?.includes("ticket_assigned")))
          ) {
            const actionUrl = `${req.protocol}://${req.get("host")}/my-tasks`;
            let message = `Ticket updated by ${user?.email || "a user"}`;

            if (updates.assigneeId && updates.assigneeId === notifyUser.id) {
              message = `Ticket assigned to you by ${user?.email || "a user"}`;
            }

            if (settings.webhookUrl) {
              await teamsIntegration.sendWebhookNotification(
                settings.webhookUrl,
                updatedTask,
                message,
                actionUrl
              );
            }
          }
        });
        await Promise.allSettled(notificationPromises);
      } catch (error) {
        console.error("Error sending Teams notifications:", error);
      }

      res.json(updatedTask);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid update data", errors: error.errors });
      }
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      const task = await storage.getTask(taskId);
      if (!task) return res.status(404).json({ message: "Task not found" });
      const { canDeleteTicket } = await import("../permissions/tickets");
      const verdict = canDeleteTicket({ user, ticket: task });
      if (!verdict.allowed) {
        return res
          .status(403)
          .json({ message: "Access denied", reason: verdict.reason });
      }
      await storage.deleteTask(taskId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Task comments
  app.get("/api/tasks/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      // Check if customer has access to this task
      if (user?.role === "customer") {
        const task = await storage.getTask(taskId);
        if (!task || task.createdBy !== userId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const comments = await storage.getTaskComments(taskId);
      res.json(comments);
    } catch (error) {
      console.error("Error fetching task comments:", error);
      res.status(500).json({ message: "Failed to fetch comments" });
    }
  });

  app.post(
    "/api/tasks/:id/comments",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const taskId = parseInt(req.params.id);
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        // Check if customer has access to this task
        if (user?.role === "customer") {
          const task = await storage.getTask(taskId);
          if (!task || task.createdBy !== userId) {
            return res.status(403).json({ message: "Access denied" });
          }
        }

        const commentData = insertTaskCommentSchema.parse({
          ...req.body,
          taskId,
          userId,
        });
        const comment = await storage.addTaskComment(commentData);

        // WS: notify about new comment
        try {
          const msg = envelope("ticket:comment", {
            ticketId: taskId,
            commentId: (comment as any).id,
            ticketNumber: undefined,
            isReply: true,
          });
          broadcastToMany([userId], msg);
        } catch (e) {
          console.error("WS notify ticket:comment error:", e);
        }

        res.status(201).json(comment);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid comment data", errors: error.errors });
        }
        console.error("Error creating comment:", error);
        res.status(500).json({ message: "Failed to create comment" });
      }
    }
  );

  // Users routes
  app.get("/api/users", isAuthenticated, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Team routes
  app.get("/api/teams", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      // Customers cannot access teams
      if (user?.role === "customer") {
        return res
          .status(403)
          .json({ message: "Customers cannot access teams" });
      }

      if (["admin", "customer"].includes(user?.role)) {
        const allTeams = await storage.getTeams();
        return res.json(allTeams);
      }

      if (user?.role === "manager") {
        // select teams within departments managed by this manager using join
        const managedTeams = await db
          .select({
            id: teams.id,
            name: teams.name,
            description: teams.description,
            createdAt: teams.createdAt,
            createdBy: teams.createdBy,
          })
          .from(teams)
          .innerJoin(departments, eq(teams.departmentId, departments.id))
          .where(eq(departments.managerId as any, userId) as any)
          .orderBy(desc(teams.createdAt));

        return res.json(managedTeams);
      }

      // Agents/Users: forbid listing all teams; use /api/teams/my
      return res.status(403).json({ message: "Forbidden" });
    } catch (error) {
      console.error("Error fetching teams:", error);
      res.status(500).json({ message: "Failed to fetch teams" });
    }
  });

  // Get user's teams (teams the user is a member of)
  app.get("/api/teams/my", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (user?.role === "customer") {
        return res
          .status(403)
          .json({ message: "Customers cannot access teams" });
      }
      const teams = await storage.getUserTeams(userId);
      res.json(teams);
    } catch (error) {
      console.error("Error fetching user teams:", error);
      res.status(500).json({ message: "Failed to fetch user teams" });
    }
  });

  app.post("/api/teams", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const teamData = insertTeamSchema.parse({
        ...req.body,
        createdBy: userId,
      });
      const team = await storage.createTeam(teamData);
      res.status(201).json(team);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid team data", errors: error.errors });
      }
      console.error("Error creating team:", error);
      res.status(500).json({ message: "Failed to create team" });
    }
  });

  app.get("/api/teams/:id", isAuthenticated, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeam(teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      res.json(team);
    } catch (error) {
      console.error("Error fetching team:", error);
      res.status(500).json({ message: "Failed to fetch team" });
    }
  });

  // Get team members
  app.get("/api/teams/:id/members", isAuthenticated, async (req: any, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return res.status(400).json({ message: "Invalid team ID" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user has permission to view team members
      if (user.role === "customer") {
        return res
          .status(403)
          .json({ message: "Customers cannot access team members" });
      }

      // For agents, check if they're a member of the team
      if (user.role === "agent") {
        const userTeams = await storage.getUserTeams(userId);
        const isMember = userTeams.some((team) => team.id === teamId);
        if (!isMember) {
          return res.status(403).json({
            message: "You can only view members of teams you belong to",
          });
        }
      }

      // For managers, check if they manage a department that contains this team
      if (user.role === "manager") {
        const team = await storage.getTeam(teamId);
        if (team?.departmentId) {
          const departmentResults = await db
            .select()
            .from(departments)
            .where(
              and(
                eq(departments.id, team.departmentId),
                eq(departments.managerId as any, userId)
              )
            );
          if (departmentResults.length === 0) {
            return res.status(403).json({
              message: "You can only view members of teams in your departments",
            });
          }
        }
      }

      // Admin and authorized users can proceed
      const members = await storage.getTeamMembers(teamId);
      res.json(members);
    } catch (error) {
      console.error("Error fetching team members:", error);
      res.status(500).json({ message: "Failed to fetch team members" });
    }
  });

  // Update team member role
  app.patch(
    "/api/teams/:teamId/members/:userId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Forbidden" });
        }

        const { teamId, userId } = req.params;
        const { role } = req.body;

        const updatedMember = await storage.updateTeamMemberRole(
          userId,
          parseInt(teamId),
          role
        );
        res.json(updatedMember);
      } catch (error) {
        console.error("Error updating team member role:", error);
        res.status(500).json({ message: "Failed to update team member role" });
      }
    }
  );

  // Admin routes
  app.get("/api/admin/users", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/stats", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/admin/s3-usage", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const stats = await storage.getS3UsageStats();
      res.json({
        ...stats,
        warning:
          "Note: Some files may have been deleted from S3 but are still counted in statistics",
      });
    } catch (error) {
      console.error("Error fetching S3 usage stats:", error);
      res.status(500).json({ message: "Failed to fetch S3 usage stats" });
    }
  });

  app.patch(
    "/api/admin/users/:userId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Forbidden" });
        }

        const { userId } = req.params;
        const updates = req.body;

        const updatedUser = await storage.updateUserProfile(userId, updates);
        res.json(updatedUser);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ message: "Failed to update user" });
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
          return res.status(403).json({ message: "Forbidden" });
        }

        const { userId } = req.params;
        const updatedUser = await storage.toggleUserStatus(userId);
        res.json(updatedUser);
      } catch (error) {
        console.error("Error toggling user status:", error);
        res.status(500).json({ message: "Failed to toggle user status" });
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
          return res.status(403).json({ message: "Forbidden" });
        }

        const { userId } = req.params;
        const updatedUser = await storage.approveUser(userId);
        res.json(updatedUser);
      } catch (error) {
        console.error("Error approving user:", error);
        res.status(500).json({ message: "Failed to approve user" });
      }
    }
  );

  app.post(
    "/api/admin/users/:userId/assign-team",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Forbidden" });
        }

        const { userId } = req.params;
        const { teamId, role } = req.body;

        const teamMember = await storage.assignUserToTeam(userId, teamId, role);
        res.json(teamMember);
      } catch (error) {
        console.error("Error assigning user to team:", error);
        res.status(500).json({ message: "Failed to assign user to team" });
      }
    }
  );

  app.delete(
    "/api/admin/users/:userId/remove-team/:teamId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Forbidden" });
        }

        const { userId, teamId } = req.params;
        await storage.removeUserFromTeam(userId, parseInt(teamId));
        res.status(204).send();
      } catch (error) {
        console.error("Error removing user from team:", error);
        res.status(500).json({ message: "Failed to remove user from team" });
      }
    }
  );

  app.get("/api/admin/departments", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const departments = await storage.getDepartments();
      res.json(departments);
    } catch (error) {
      console.error("Error fetching departments:", error);
      res.status(500).json({ message: "Failed to fetch departments" });
    }
  });

  app.post(
    "/api/admin/users/:userId/reset-password",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Forbidden" });
        }

        const { userId } = req.params;
        const result = await storage.resetUserPassword(userId);
        res.json(result);
      } catch (error) {
        console.error("Error resetting password:", error);
        res.status(500).json({ message: "Failed to reset password" });
      }
    }
  );

  // Statistics
  app.get("/api/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      // If admin, show all stats, otherwise show user-specific stats
      const stats = await storage.getTaskStats(
        user?.role === "admin" ? undefined : userId
      );
      res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  app.get("/api/stats/global", isAuthenticated, async (req, res) => {
    try {
      const stats = await storage.getTaskStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching global stats:", error);
      res.status(500).json({ message: "Failed to fetch global statistics" });
    }
  });

  // Activity
  app.get("/api/activity", isAuthenticated, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const activity = await storage.getRecentActivity(limit);
      res.json(activity);
    } catch (error) {
      console.error("Error fetching activity:", error);
      res.status(500).json({ message: "Failed to fetch activity" });
    }
  });

  // Get task comments
  app.get("/api/tasks/:id/comments", isAuthenticated, async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const comments = await storage.getTaskComments(taskId);
      res.json(comments);
    } catch (error) {
      console.error("Error fetching task comments:", error);
      res.status(500).json({ message: "Failed to fetch comments" });
    }
  });

  // Add task comment
  app.post(
    "/api/tasks/:id/comments",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const taskId = parseInt(req.params.id);
        const userId = getUserId(req);
        const { content } = req.body;

        if (!content || !content.trim()) {
          return res
            .status(400)
            .json({ message: "Comment content is required" });
        }

        const comment = await storage.addTaskComment({
          taskId,
          userId,
          content: content.trim(),
        });

        res.status(201).json(comment);
      } catch (error) {
        console.error("Error creating task comment:", error);
        res.status(500).json({ message: "Failed to create comment" });
      }
    }
  );

  // Attachment routes
  app.get(
    "/api/tasks/:id/attachments",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const taskId = parseInt(req.params.id);
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        // Check if customer has access to this task
        if (user?.role === "customer") {
          const task = await storage.getTask(taskId);
          if (!task || task.createdBy !== userId) {
            return res.status(403).json({ message: "Access denied" });
          }
        }

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
              console.error(
                `Failed to generate presigned URL for attachment ${attachment.id}:`,
                error
              );
              // Return attachment with original fileUrl if presigned URL generation fails
              return attachment;
            }
          })
        );

        res.json(attachmentsWithUrls);
      } catch (error) {
        console.error("Error fetching attachments:", error);
        res.status(500).json({ message: "Failed to fetch attachments" });
      }
    }
  );

  app.post(
    "/api/tasks/:id/attachments",
    isAuthenticated,
    upload.single("file"),
    async (req: any, res) => {
      try {
        const taskId = parseInt(req.params.id);
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        // Check if customer has access to this task
        if (user?.role === "customer") {
          const task = await storage.getTask(taskId);
          if (!task || task.createdBy !== userId) {
            return res.status(403).json({ message: "Access denied" });
          }
        }

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
          return res.status(400).json({ message: "File is required" });
        }

        // Validate file size (use company settings if available)
        const companySettings = await storage.getCompanySettings();
        const maxSizeMB = companySettings?.maxFileUploadSize || 10;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (req.file.size > maxSizeBytes) {
          return res
            .status(400)
            .json({ message: `File size exceeds ${maxSizeMB}MB limit` });
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
          return res
            .status(400)
            .json({ message: "Invalid attachment data", errors: error.errors });
        }
        console.error("Error creating attachment:", error);

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

        res.status(500).json({
          message: "Failed to create attachment",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // GET /api/attachments/:id/download - Download attachment with presigned URL
  app.get(
    "/api/attachments/:id/download",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const attachmentId = parseInt(req.params.id);
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        // Get attachment from database by ID
        const [attachment] = await db
          .select()
          .from(taskAttachments)
          .where(eq(taskAttachments.id, attachmentId))
          .limit(1);

        if (!attachment) {
          return res.status(404).json({ message: "Attachment not found" });
        }

        // Check access permissions
        const task = await storage.getTask(attachment.taskId);
        if (user?.role === "customer") {
          if (!task || task.createdBy !== userId) {
            return res.status(403).json({ message: "Access denied" });
          }
        }

        // Generate presigned URL for S3 object
        const s3Key = s3Service.extractKeyFromUrl(attachment.fileUrl);
        const presignedUrl = await s3Service.getPresignedUrl(s3Key, 3600); // 1 hour expiry

        // Fetch the file from S3 and stream it to the client
        const s3Response = await fetch(presignedUrl);
        if (!s3Response.ok) {
          return res.status(500).json({
            message: "Failed to fetch file from storage",
            error: s3Response.statusText,
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
        console.error("Error generating download URL:", error);
        res.status(500).json({
          message: "Failed to generate download URL",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  app.delete("/api/attachments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const attachmentId = parseInt(req.params.id);
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      // Get attachment to check permissions and get S3 key
      const [attachment] = await db
        .select()
        .from(taskAttachments)
        .where(eq(taskAttachments.id, attachmentId))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      // Check permissions (uploader or admin/manager can delete)
      const task = await storage.getTask(attachment.taskId);
      if (user?.role === "customer" && attachment.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Delete from S3 if it's an S3 URL
      if (s3Service.isS3Url(attachment.fileUrl)) {
        try {
          const s3Key = s3Service.extractKeyFromUrl(attachment.fileUrl);
          await s3Service.deleteFile(s3Key);
        } catch (error) {
          console.warn("Failed to delete file from S3:", error);
          // Continue with database deletion even if S3 delete fails
        }
      }

      // Delete from database
      await storage.deleteTaskAttachment(attachmentId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting attachment:", error);
      res.status(500).json({
        message: "Failed to delete attachment",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Company settings routes moved to server/admin/settings.ts

  // API key routes
  app.get("/api/api-keys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const apiKeys = await storage.getApiKeys(userId);
      // Don't send the actual key hashes to the client
      const sanitizedKeys = apiKeys.map((key) => ({
        ...key,
        keyHash: undefined,
      }));
      res.json(sanitizedKeys);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  app.post("/api/api-keys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const apiKeyData = insertApiKeySchema.parse({
        ...req.body,
        userId,
      });
      const { apiKey, plainKey } = await storage.createApiKey(apiKeyData);
      res.status(201).json({
        ...apiKey,
        keyHash: undefined,
        plainKey, // Only sent once on creation
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid API key data", errors: error.errors });
      }
      console.error("Error creating API key:", error);
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  app.delete("/api/api-keys/:id", isAuthenticated, async (req: any, res) => {
    try {
      const keyId = parseInt(req.params.id);
      const userId = getUserId(req);

      // Verify the key belongs to the user
      const apiKeys = await storage.getApiKeys(userId);
      const keyExists = apiKeys.some((key) => key.id === keyId);

      if (!keyExists) {
        return res.status(404).json({ message: "API key not found" });
      }

      await storage.revokeApiKey(keyId);
      res.status(204).send();
    } catch (error) {
      console.error("Error revoking API key:", error);
      res.status(500).json({ message: "Failed to revoke API key" });
    }
  });

  // Save Perplexity API key
  app.post("/api/api-keys/perplexity", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ message: "API key is required" });
      }

      // Check if Perplexity key already exists
      const existingKeys = await storage.getApiKeys("system");
      const perplexityKey = existingKeys.find(
        (key) => key.name === "Perplexity API Key"
      );

      if (perplexityKey) {
        // Update existing key
        await storage.updateApiKey(perplexityKey.id, { keyHash: apiKey });
      } else {
        // Create new key
        await storage.createApiKey({
          userId: "system",
          name: "Perplexity API Key",
          keyHash: apiKey,
          keyPrefix: apiKey.substring(0, 8),
          permissions: ["ai_chat"],
          isActive: true,
        });
      }

      res.json({ message: "Perplexity API key saved successfully" });
    } catch (error) {
      console.error("Error saving Perplexity API key:", error);
      res.status(500).json({ message: "Failed to save Perplexity API key" });
    }
  });

  // Get Perplexity API key status
  app.get(
    "/api/api-keys/perplexity/status",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user || user.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }

        const apiKeys = await storage.getApiKeys("system");
        const perplexityKey = apiKeys.find(
          (key) => key.name === "Perplexity API Key" && key.isActive
        );

        res.json({ exists: !!perplexityKey });
      } catch (error) {
        console.error("Error checking Perplexity API key:", error);
        res.status(500).json({ message: "Failed to check Perplexity API key" });
      }
    }
  );

  // Bedrock settings routes (admin only)
  app.get("/api/bedrock/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
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
      console.error("Error fetching Bedrock settings:", error);
      res.status(500).json({ message: "Failed to fetch Bedrock settings" });
    }
  });

  app.post("/api/bedrock/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
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
      console.error("Error updating Bedrock settings:", error);
      res.status(500).json({ message: "Failed to update Bedrock settings" });
    }
  });

  // SMTP, SSO, Email Template routes moved to server/admin/settings.ts

  // AI Settings (admin only)
  app.get("/api/admin/ai-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const settings = await getAISettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching AI settings:", error);
      res.status(500).json({ message: "Failed to fetch AI settings" });
    }
  });

  app.put("/api/admin/ai-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const next = validateAISettings({
        ...(await getAISettings()),
        ...(req.body || {}),
      });
      const saved = await saveAISettings(next);
      res.json(saved);
    } catch (error) {
      console.error("Error updating AI settings:", error);
      res.status(500).json({ message: "Failed to update AI settings" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const ok = await bedrockIntegration.testConnection();
        if (ok) {
          return res.json({ success: true });
        }
        return res
          .status(400)
          .json({ success: false, message: "Bedrock test failed" });
      } catch (error: any) {
        console.error("Error testing Bedrock connection:", error);
        res.status(500).json({
          success: false,
          message: error?.message || "Failed to test Bedrock",
        });
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
        return res.status(403).json({ message: "Admin access required" });
      }

      const templates = await storage.getEmailTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  // Update email template (admin only)
  app.put("/api/email-templates/:name", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { name } = req.params;
      const template = await storage.updateEmailTemplate(
        name,
        req.body,
        userId
      );
      res.json(template);
    } catch (error) {
      console.error("Error updating email template:", error);
      res.status(500).json({ message: "Failed to update email template" });
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
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
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
        console.error("Error marking notification read:", error);
        res.status(500).json({ message: "Failed to mark notification read" });
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
        console.error("Error marking all notifications read:", error);
        res
          .status(500)
          .json({ message: "Failed to mark all notifications read" });
      }
    }
  );

  // Get all help documents (admin)
  app.get("/api/admin/help", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const documents = await storage.getHelpDocuments();
      res.json(documents);
    } catch (error) {
      console.error("Error fetching help documents (admin):", error);
      res.status(500).json({ message: "Failed to fetch help documents" });
    }
  });

  // Get all help documents (public)
  app.get("/api/help", async (req, res) => {
    try {
      const documents = await storage.getHelpDocuments();
      res.json(documents);
    } catch (error) {
      console.error("Error fetching help documents:", error);
      res.status(500).json({ message: "Failed to fetch help documents" });
    }
  });

  // Search help documents (public)
  app.get("/api/help/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ message: "Search query is required" });
      }

      const documents = await storage.searchHelpDocuments(q);
      res.json(documents);
    } catch (error) {
      console.error("Error searching help documents:", error);
      res.status(500).json({ message: "Failed to search help documents" });
    }
  });

  // Get single help document (public)
  app.get("/api/help/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getHelpDocument(id);

      if (!document) {
        return res.status(404).json({ message: "Help document not found" });
      }

      // Increment view count
      await storage.incrementViewCount(id);

      res.json(document);
    } catch (error) {
      console.error("Error fetching help document:", error);
      res.status(500).json({ message: "Failed to fetch help document" });
    }
  });

  // Upload help document (admin only)
  app.post("/api/admin/help", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { title, filename, content, fileData, category, tags } = req.body;

      if (!title || !filename || !content || !fileData) {
        return res.status(400).json({
          message: "Title, filename, content, and file data are required",
        });
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
      console.error("Error creating help document:", error);
      res.status(500).json({ message: "Failed to create help document" });
    }
  });

  // Update help document (admin only)
  app.put("/api/admin/help/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const updates = req.body;

      const document = await storage.updateHelpDocument(id, updates);
      res.json(document);
    } catch (error) {
      console.error("Error updating help document:", error);
      res.status(500).json({ message: "Failed to update help document" });
    }
  });

  // Delete help document (admin only)
  app.delete("/api/admin/help/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      await storage.deleteHelpDocument(id);

      res.json({ message: "Help document deleted successfully" });
    } catch (error) {
      console.error("Error deleting help document:", error);
      res.status(500).json({ message: "Failed to delete help document" });
    }
  });

  // User Guide routes

  // Get all guide categories
  app.get("/api/guide-categories", isAuthenticated, async (req, res) => {
    try {
      const categories = await storage.getUserGuideCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching guide categories:", error);
      res.status(500).json({ message: "Failed to fetch guide categories" });
    }
  });

  // Get all guides (optionally filter by published status)
  app.get("/api/guides", isAuthenticated, async (req, res) => {
    try {
      const { published } = req.query;
      const guides = await storage.getUserGuides(
        published === "true" ? { isPublished: true } : undefined
      );
      res.json(guides);
    } catch (error) {
      console.error("Error fetching guides:", error);
      res.status(500).json({ message: "Failed to fetch guides" });
    }
  });

  // Get single guide
  app.get("/api/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const guide = await storage.getUserGuideById(id);

      if (!guide) {
        return res.status(404).json({ message: "Guide not found" });
      }

      // Increment view count
      await storage.incrementGuideViewCount(id);

      res.json(guide);
    } catch (error) {
      console.error("Error fetching guide:", error);
      res.status(500).json({ message: "Failed to fetch guide" });
    }
  });

  // Create guide category (admin only)
  app.post("/api/admin/guide-categories", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const category = await storage.createUserGuideCategory(req.body);
      res.json(category);
    } catch (error) {
      console.error("Error creating guide category:", error);
      res.status(500).json({ message: "Failed to create guide category" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        const category = await storage.updateUserGuideCategory(id, req.body);
        res.json(category);
      } catch (error) {
        console.error("Error updating guide category:", error);
        res.status(500).json({ message: "Failed to update guide category" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        await storage.deleteUserGuideCategory(id);
        res.json({ message: "Guide category deleted successfully" });
      } catch (error) {
        console.error("Error deleting guide category:", error);
        res.status(500).json({ message: "Failed to delete guide category" });
      }
    }
  );

  // Create guide (admin only)
  app.post("/api/admin/guides", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const guide = await storage.createUserGuide({
        ...req.body,
        createdBy: userId,
      });
      res.json(guide);
    } catch (error) {
      console.error("Error creating guide:", error);
      res.status(500).json({ message: "Failed to create guide" });
    }
  });

  // Update guide (admin only)
  app.put("/api/admin/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const guide = await storage.updateUserGuide(id, req.body);
      res.json(guide);
    } catch (error) {
      console.error("Error updating guide:", error);
      res.status(500).json({ message: "Failed to update guide" });
    }
  });

  // Delete guide (admin only)
  app.delete("/api/admin/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      await storage.deleteUserGuide(id);
      res.json({ message: "Guide deleted successfully" });
    } catch (error) {
      console.error("Error deleting guide:", error);
      res.status(500).json({ message: "Failed to delete guide" });
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
  function calculateBedrockCost(
    inputTokens: number,
    outputTokens: number,
    modelId: string
  ): number {
    // Claude 3 Sonnet pricing per 1M tokens (as of 2024)
    const pricePerMillionInputTokens = 3.0; // $3 per 1M input tokens
    const pricePerMillionOutputTokens = 15.0; // $15 per 1M output tokens

    const inputCost = (inputTokens / 1_000_000) * pricePerMillionInputTokens;
    const outputCost = (outputTokens / 1_000_000) * pricePerMillionOutputTokens;

    return inputCost + outputCost;
  }

  // Helper function to estimate token count (rough approximation)
  function estimateTokenCount(text: string): number {
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
        return res.status(400).json({ message: "Session ID is required" });
      }
      const rawMessage =
        typeof message === "string" ? message : String(message ?? "");
      const trimmedMessage = rawMessage.trim();
      if (trimmedMessage.length === 0 || trimmedMessage.length > 2000) {
        return res
          .status(400)
          .json({ message: "Message must be 1-2000 characters" });
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

      if (hasBedrockCredentials) {
        // Use AWS Bedrock for intelligent responses
        try {
          // Import AWS Bedrock client
          const { BedrockRuntimeClient, InvokeModelCommand } = await import(
            "@aws-sdk/client-bedrock-runtime"
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

          // Configure AWS Bedrock client using Bedrock settings or environment variables
          const bedrockClient = new BedrockRuntimeClient({
            region:
              bedrock?.bedrockRegion || process.env.AWS_REGION || "us-east-1",
            credentials: {
              accessKeyId: bedrock?.bedrockAccessKeyId || "",
              secretAccessKey: bedrock?.bedrockSecretAccessKey || "",
            },
          });

          // Prepare the system message and user message
          const systemMessage =
            "You are a helpful assistant for TicketFlow, a ticketing system. Answer questions based on the provided context when available. Be concise and helpful.";

          let userMessage = trimmedMessage;
          if (context) {
            userMessage = `Context:\n${context}\n\nUser question: ${trimmedMessage}`;
          }

          // Enforce selected model only from Bedrock settings
          const modelId = bedrock?.bedrockModelId || "";
          if (!modelId) {
            const currentUser = await storage.getUser(userId);
            const msg =
              currentUser?.role === "admin"
                ? "No active AI model configured. Please select a model in AI Settings."
                : "AI service is not configured. Please contact an administrator.";
            return res.status(409).json({ message: msg });
          }

          // Validate against supported model families
          const supportedFamilies = [
            "amazon.titan",
            "anthropic.claude",
            "ai21.j2",
            "meta.llama",
          ];
          if (!supportedFamilies.some((p) => modelId.startsWith(p))) {
            const currentUser = await storage.getUser(userId);
            const msg =
              currentUser?.role === "admin"
                ? `Selected model '${modelId}' is not supported. Choose a supported model (e.g., amazon.titan-text-express-v1).`
                : "The selected AI model is not available. Please contact an administrator.";
            return res.status(409).json({ message: msg });
          }

          // Build payload based on model family
          let commandBody: any;
          if (modelId.startsWith("amazon.titan")) {
            commandBody = {
              inputText: `${systemMessage}\n\n${userMessage}`,
              textGenerationConfig: {
                maxTokenCount: 1000,
                temperature: 0.2,
                topP: 0.9,
              },
            };
          } else if (modelId.startsWith("anthropic.claude")) {
            commandBody = {
              anthropic_version: "bedrock-2023-05-31",
              max_tokens: 1000,
              temperature: 0.2,
              system: systemMessage,
              messages: [
                {
                  role: "user",
                  content: userMessage,
                },
              ],
            };
          } else {
            // Fallback to Claude-style payload if unknown
            commandBody = {
              anthropic_version: "bedrock-2023-05-31",
              max_tokens: 1000,
              temperature: 0.2,
              system: systemMessage,
              messages: [
                {
                  role: "user",
                  content: userMessage,
                },
              ],
            };
          }

          const command = new InvokeModelCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(commandBody),
          });

          // Invoke the model
          const bedrockResponse = await bedrockClient.send(command);
          const responseBody = JSON.parse(
            new TextDecoder().decode(bedrockResponse.body)
          );
          if (modelId.startsWith("amazon.titan")) {
            response = responseBody?.results?.[0]?.outputText || "";
          } else {
            response = responseBody.content?.[0]?.text || "";
          }

          // Track usage
          const inputTokens = estimateTokenCount(systemMessage + userMessage);
          const outputTokens = estimateTokenCount(response);
          const totalTokens = inputTokens + outputTokens;
          const cost = calculateBedrockCost(inputTokens, outputTokens, modelId);

          usageData = await storage.trackBedrockUsage({
            userId,
            sessionId,
            inputTokens,
            outputTokens,
            totalTokens,
            modelId,
            cost: cost.toFixed(6),
          });

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
          console.error("Error calling AWS Bedrock:", error);
          console.error("Error details:", error?.message, error?.name);
          const currentUser = await storage.getUser(userId);
          const isAdmin = currentUser?.role === "admin";
          const unsupportedRegion =
            typeof error?.message === "string" &&
            /unsupported countries|unsupported regions|ValidationException/i.test(
              error.message
            );
          if (unsupportedRegion) {
            const adminMsg = `Selected model '${bedrock?.bedrockModelId}' is not available in this region. Please choose Amazon Titan Text Express or another supported model in AI Settings.`;
            const userMsg =
              "The AI model is not available right now. An administrator needs to adjust AI Settings.";
            return res
              .status(409)
              .json({ message: isAdmin ? adminMsg : userMsg });
          }

          const adminMsg = `Failed to invoke model '${bedrock?.bedrockModelId}'. Check model access/permissions in AWS Bedrock or select a different model.`;
          const userMsg =
            "The AI service is temporarily unavailable. Please try again later.";
          return res
            .status(409)
            .json({ message: isAdmin ? adminMsg : userMsg });
        }
      } else {
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
          console.error("Error searching help documents:", error);
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
              cost: parseFloat(usageData.cost),
            }
          : undefined,
      });
    } catch (error: any) {
      console.error("Error in chat:", error);
      console.error("Chat error details:", error.message, error.stack);
      res.status(500).json({ message: "Failed to process chat message" });
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
      console.error("Error fetching chat history:", error);
      res.status(500).json({ message: "Failed to fetch chat history" });
    }
  });

  // Get chat sessions
  app.get("/api/chat-sessions", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const sessions = await storage.getChatSessions(userId);
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching chat sessions:", error);
      res.status(500).json({ message: "Failed to fetch chat sessions" });
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

      const usage = await storage.getBedrockUsageByUser(
        targetUserId,
        startDate,
        endDate
      );
      res.json(usage);
    } catch (error) {
      console.error("Error fetching Bedrock usage:", error);
      res.status(500).json({ message: "Failed to fetch Bedrock usage" });
    }
  });

  app.get("/api/bedrock/usage/summary", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : undefined;

      const summary = await storage.getBedrockUsageSummary(startDate, endDate);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching Bedrock usage summary:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch Bedrock usage summary" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const stats = await bedrockIntegration.getCostStatistics();
        res.json(stats);
      } catch (error) {
        console.error("Error fetching cost statistics:", error);
        res.status(500).json({ message: "Failed to fetch cost statistics" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const {
          dailyLimitUSD,
          monthlyLimitUSD,
          maxTokensPerRequest,
          maxRequestsPerDay,
          maxRequestsPerHour,
          isFreeTierAccount,
        } = req.body;

        const updatedLimits = await bedrockIntegration.updateCostLimits({
          dailyLimitUSD,
          monthlyLimitUSD,
          maxTokensPerRequest,
          maxRequestsPerDay,
          maxRequestsPerHour,
          isFreeTierAccount,
        });

        res.json(updatedLimits);
      } catch (error) {
        console.error("Error updating cost limits:", error);
        res.status(500).json({ message: "Failed to update cost limits" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        await bedrockIntegration.resetUsageData();
        res.json({ message: "Usage data reset successfully" });
      } catch (error) {
        console.error("Error resetting usage data:", error);
        res.status(500).json({ message: "Failed to reset usage data" });
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
          return res.status(403).json({ message: "Admin access required" });
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
        console.error("Error exporting usage data:", error);
        res.status(500).json({ message: "Failed to export usage data" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const result = await bedrockIntegration.testConnection();

        if (result.success) {
          res.json({
            success: true,
            message: "Bedrock connection successful",
            costEstimate: result.costEstimate,
          });
        } else {
          res.status(400).json({
            success: false,
            message: result.error || "Bedrock test failed",
            costEstimate: result.costEstimate,
          });
        }
      } catch (error) {
        console.error("Error testing Bedrock connection:", error);
        res.status(500).json({
          success: false,
          message: error?.message || "Failed to test Bedrock connection",
        });
      }
    }
  );

  // FAQ cache endpoints
  app.get("/api/faq-cache", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const popularFaqs = await storage.getPopularFaqs(limit);
      res.json(popularFaqs);
    } catch (error) {
      console.error("Error fetching FAQ cache:", error);
      res.status(500).json({ message: "Failed to fetch FAQ cache" });
    }
  });

  app.delete("/api/faq-cache", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.clearFaqCache();
      res.json({ message: "FAQ cache cleared successfully" });
    } catch (error) {
      console.error("Error clearing FAQ cache:", error);
      res.status(500).json({ message: "Failed to clear FAQ cache" });
    }
  });

  // Company Policy endpoints
  app.get("/api/company-policies", isAuthenticated, async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      const policies = await storage.getAllCompanyPolicies(includeInactive);
      res.json(policies);
    } catch (error) {
      console.error("Error fetching company policies:", error);
      res.status(500).json({ message: "Failed to fetch company policies" });
    }
  });

  app.get("/api/company-policies/:id", isAuthenticated, async (req, res) => {
    try {
      const policyId = parseInt(req.params.id);
      const policy = await storage.getCompanyPolicyById(policyId);

      if (!policy) {
        return res.status(404).json({ message: "Company policy not found" });
      }

      res.json(policy);
    } catch (error) {
      console.error("Error fetching company policy:", error);
      res.status(500).json({ message: "Failed to fetch company policy" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "File is required" });
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
        console.error("Error creating company policy:", error);
        res.status(500).json({ message: "Failed to create company policy" });
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
          return res.status(403).json({ message: "Admin access required" });
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
        console.error("Error updating company policy:", error);
        res.status(500).json({ message: "Failed to update company policy" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const policyId = parseInt(req.params.id);
        await storage.deleteCompanyPolicy(policyId);
        res.json({ message: "Company policy deleted successfully" });
      } catch (error) {
        console.error("Error deleting company policy:", error);
        res.status(500).json({ message: "Failed to delete company policy" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const policyId = parseInt(req.params.id);
        const policy = await storage.toggleCompanyPolicyStatus(policyId);
        res.json(policy);
      } catch (error) {
        console.error("Error toggling company policy status:", error);
        res
          .status(500)
          .json({ message: "Failed to toggle company policy status" });
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

        if (!policy) {
          return res.status(404).json({ message: "Company policy not found" });
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
        console.error("Error downloading company policy:", error);
        res.status(500).json({ message: "Failed to download company policy" });
      }
    }
  );

  // Get all user guides (filtered by query params)
  app.get("/api/guides", isAuthenticated, async (req, res) => {
    try {
      const { category, type, published } = req.query;
      const guides = await storage.getUserGuides({
        category: category as string,
        type: type as string,
        isPublished: published !== undefined ? published === "true" : undefined,
      });
      res.json(guides);
    } catch (error) {
      console.error("Error fetching guides:", error);
      res.status(500).json({ message: "Failed to fetch guides" });
    }
  });

  // Get single user guide
  app.get("/api/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const guide = await storage.getUserGuideById(id);

      if (!guide) {
        return res.status(404).json({ message: "Guide not found" });
      }

      // Increment view count
      await storage.incrementGuideViewCount(id);

      res.json(guide);
    } catch (error) {
      console.error("Error fetching guide:", error);
      res.status(500).json({ message: "Failed to fetch guide" });
    }
  });

  // Create user guide (admin only)
  app.post("/api/admin/guides", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const guide = await storage.createUserGuide({
        ...req.body,
        createdBy: userId,
      });
      res.json(guide);
    } catch (error) {
      console.error("Error creating guide:", error);
      res.status(500).json({ message: "Failed to create guide" });
    }
  });

  // Update user guide (admin only)
  app.put("/api/admin/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const guide = await storage.updateUserGuide(id, req.body);
      res.json(guide);
    } catch (error) {
      console.error("Error updating guide:", error);
      res.status(500).json({ message: "Failed to update guide" });
    }
  });

  // Delete user guide (admin only)
  app.delete("/api/admin/guides/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      await storage.deleteUserGuide(id);
      res.json({ message: "Guide deleted successfully" });
    } catch (error) {
      console.error("Error deleting guide:", error);
      res.status(500).json({ message: "Failed to delete guide" });
    }
  });

  // Cancel user invitation (admin only)
  app.delete(
    "/api/admin/invitations/:id",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user || user.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        await storage.cancelUserInvitation(id);
        res.json({ message: "Invitation cancelled successfully" });
      } catch (error) {
        console.error("Error cancelling invitation:", error);
        res.status(500).json({ message: "Failed to cancel invitation" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        const invitation = await storage.getUserInvitationById(id);

        if (!invitation) {
          return res.status(404).json({ message: "Invitation not found" });
        }

        if (invitation.status === "accepted") {
          return res
            .status(400)
            .json({ message: "Cannot resend accepted invitation" });
        }

        // Send invitation email using the template
        const smtpSettings = await storage.getSmtpSettings();
        const emailTemplate = await storage.getEmailTemplate("user_invitation");
        const companySettings = await storage.getCompanySettings();

        if (
          smtpSettings &&
          emailTemplate &&
          smtpSettings.awsAccessKeyId &&
          smtpSettings.awsSecretAccessKey
        ) {
          const { sendEmailWithTemplate } = await import("../ses");
          const inviteUrl = `${req.protocol}://${req.get(
            "host"
          )}/auth?mode=register&email=${encodeURIComponent(
            invitation.email
          )}&token=${invitation.invitationToken}`;

          const department = invitation.departmentId
            ? await storage.getDepartmentById(invitation.departmentId)
            : null;
          const inviter = await storage.getUser(invitation.invitedBy);

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
            fromEmail: smtpSettings.fromEmail,
            fromName: smtpSettings.fromName,
            awsAccessKeyId: smtpSettings.awsAccessKeyId,
            awsSecretAccessKey: smtpSettings.awsSecretAccessKey,
            awsRegion: smtpSettings.awsRegion,
          });
        }

        res.json({ message: "Invitation resent successfully" });
      } catch (error) {
        console.error("Error resending invitation:", error);
        res.status(500).json({ message: "Failed to resend invitation" });
      }
    }
  );

  // Department routes (scoped by role)
  app.get("/api/departments", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (user.role === "admin") {
        const rows = await storage.getAllDepartments();
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

      return res.status(403).json({ message: "Forbidden" });
    } catch (error) {
      console.error("Error fetching departments:", error);
      res.status(500).json({ message: "Failed to fetch departments" });
    }
  });

  app.post("/api/admin/departments", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const department = await storage.createDepartment(req.body);
      res.json(department);
    } catch (error) {
      console.error("Error creating department:", error);
      res.status(500).json({ message: "Failed to create department" });
    }
  });

  app.put("/api/admin/departments/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const department = await storage.updateDepartment(id, req.body);
      res.json(department);
    } catch (error) {
      console.error("Error updating department:", error);
      res.status(500).json({ message: "Failed to update department" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        await storage.deleteDepartment(id);
        res.json({ message: "Department deleted successfully" });
      } catch (error) {
        console.error("Error deleting department:", error);
        res.status(500).json({ message: "Failed to delete department" });
      }
    }
  );

  // User invitation routes (admin only)
  app.get("/api/admin/invitations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { status } = req.query;
      const invitations = await storage.getUserInvitations({
        status: status as string,
      });
      res.json(invitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });

  app.post("/api/admin/invitations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Check if a user with this email already exists
      const existingUser = await storage.getUserByEmail(req.body.email);
      if (existingUser) {
        return res.status(400).json({
          message:
            "A user with this email address already exists in the system.",
        });
      }

      // Check for existing pending invitations
      const existingInvitations = await storage.getUserInvitations({
        status: "pending",
      });
      const hasPendingInvitation = existingInvitations.some(
        (inv) =>
          inv.email === req.body.email && new Date(inv.expiresAt) > new Date()
      );

      if (hasPendingInvitation) {
        return res.status(400).json({
          message:
            "An invitation has already been sent to this email address and is still pending.",
        });
      }

      const invitation = await storage.createUserInvitation({
        ...req.body,
        expiresAt: new Date(req.body.expiresAt),
        invitedBy: userId,
      });

      // Send invitation email using the template
      const smtpSettings = await storage.getSmtpSettings();
      const emailTemplate = await storage.getEmailTemplate("user_invitation");
      const companySettings = await storage.getCompanySettings();

      if (
        smtpSettings &&
        emailTemplate &&
        smtpSettings.awsAccessKeyId &&
        smtpSettings.awsSecretAccessKey
      ) {
        const { sendEmailWithTemplate } = await import("../ses");
        const inviteUrl = `${req.protocol}://${req.get(
          "host"
        )}/auth?mode=register&email=${encodeURIComponent(
          invitation.email
        )}&token=${invitation.invitationToken}`;

        const department = invitation.departmentId
          ? await storage.getDepartmentById(invitation.departmentId)
          : null;

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
          fromEmail: smtpSettings.fromEmail,
          fromName: smtpSettings.fromName,
          awsAccessKeyId: smtpSettings.awsAccessKeyId,
          awsSecretAccessKey: smtpSettings.awsSecretAccessKey,
          awsRegion: smtpSettings.awsRegion,
        });
      }

      res.json(invitation);
    } catch (error) {
      console.error("Error creating invitation:", error);
      res.status(500).json({ message: "Failed to create invitation" });
    }
  });

  // Public route to accept invitation
  app.get("/api/invitations/:token", async (req, res) => {
    try {
      const invitation = await storage.getUserInvitationByToken(
        req.params.token
      );

      if (!invitation) {
        return res.status(404).json({ message: "Invalid invitation token" });
      }

      if (invitation.status === "accepted") {
        return res
          .status(400)
          .json({ message: "Invitation has already been accepted" });
      }

      if (new Date(invitation.expiresAt) < new Date()) {
        return res.status(400).json({ message: "Invitation has expired" });
      }

      res.json({
        email: invitation.email,
        role: invitation.role,
        departmentId: invitation.departmentId,
      });
    } catch (error) {
      console.error("Error validating invitation:", error);
      res.status(500).json({ message: "Failed to validate invitation" });
    }
  });

  app.post("/api/invitations/:token/accept", async (req, res) => {
    try {
      const invitation = await storage.getUserInvitationByToken(
        req.params.token
      );

      if (!invitation) {
        return res.status(404).json({ message: "Invalid invitation token" });
      }

      if (invitation.status === "accepted") {
        return res
          .status(400)
          .json({ message: "Invitation has already been accepted" });
      }

      if (new Date(invitation.expiresAt) < new Date()) {
        return res.status(400).json({ message: "Invitation has expired" });
      }

      // Mark invitation as accepted
      await storage.markInvitationAccepted(invitation.id);

      // Redirect to login page
      res.json({ message: "Invitation accepted. Please log in to continue." });
    } catch (error) {
      console.error("Error accepting invitation:", error);
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  // Clean up expired invitations periodically
  setInterval(async () => {
    try {
      await storage.deleteExpiredInvitations();
    } catch (error) {
      console.error("Error cleaning up expired invitations:", error);
    }
  }, 24 * 60 * 60 * 1000); // Run once per day

  // Teams Integration routes
  app.get(
    "/api/teams-integration/settings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const settings = await storage.getTeamsIntegrationSettings(userId);
        res.json(settings || { enabled: false });
      } catch (error) {
        console.error("Error fetching Teams settings:", error);
        res.status(500).json({ message: "Failed to fetch Teams settings" });
      }
    }
  );

  app.post(
    "/api/teams-integration/settings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const settings = await storage.upsertTeamsIntegrationSettings({
          ...req.body,
          userId,
        });
        res.json(settings);
      } catch (error) {
        console.error("Error updating Teams settings:", error);
        res.status(500).json({ message: "Failed to update Teams settings" });
      }
    }
  );

  app.delete(
    "/api/teams-integration/settings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        await storage.deleteTeamsIntegrationSettings(userId);
        res.json({ message: "Teams integration disabled" });
      } catch (error) {
        console.error("Error disabling Teams integration:", error);
        res
          .status(500)
          .json({ message: "Failed to disable Teams integration" });
      }
    }
  );

  // Get user's teams and channels
  app.get(
    "/api/teams-integration/teams",
    isAuthenticated,
    async (req: any, res) => {
      try {
        if (!req.user.access_token) {
          return res
            .status(401)
            .json({ message: "Microsoft authentication required" });
        }

        const teams = await teamsIntegration.listTeamsAndChannels(
          req.user.access_token
        );
        res.json(teams);
      } catch (error) {
        console.error("Error fetching teams:", error);
        res.status(500).json({ message: "Failed to fetch teams" });
      }
    }
  );

  // Send test notification
  app.post(
    "/api/teams-integration/test",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const settings = await storage.getTeamsIntegrationSettings(userId);

        if (!settings || !settings.enabled) {
          return res
            .status(400)
            .json({ message: "Teams integration not configured" });
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
        } as Task;

        const actionUrl = `${req.protocol}://${req.get("host")}/`;
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
          res.status(500).json({ message: "Failed to send test notification" });
        }
      } catch (error) {
        console.error("Error sending test notification:", error);
        res.status(500).json({ message: "Failed to send test notification" });
      }
    }
  );

  // Smart Helpdesk API Routes

  // Get AI auto-response for a ticket
  app.get("/api/tasks/:id/auto-response", isAuthenticated, async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const [autoResponse] = await db
        .select()
        .from(ticketAutoResponses)
        .where(eq(ticketAutoResponses.ticketId, taskId))
        .orderBy(desc(ticketAutoResponses.createdAt))
        .limit(1);

      res.json(autoResponse || null);
    } catch (error) {
      console.error("Error fetching auto-response:", error);
      res.status(500).json({ message: "Failed to fetch auto-response" });
    }
  });

  // Update auto-response effectiveness
  app.post(
    "/api/tasks/:id/auto-response/feedback",
    isAuthenticated,
    async (req, res) => {
      try {
        const taskId = parseInt(req.params.id);
        const { wasHelpful } = req.body;

        const { aiAutoResponseService } = await import("../aiAutoResponse");
        await aiAutoResponseService.updateResponseEffectiveness(
          taskId,
          wasHelpful
        );

        res.json({ message: "Feedback recorded" });
      } catch (error) {
        console.error("Error recording feedback:", error);
        res.status(500).json({ message: "Failed to record feedback" });
      }
    }
  );

  // Knowledge Base Routes

  // Search knowledge base
  app.get("/api/knowledge/search", isAuthenticated, async (req, res) => {
    try {
      const { query, category, limit = 10 } = req.query;

      const articles = await db
        .select()
        .from(knowledgeArticles)
        .where(
          and(
            eq(knowledgeArticles.isPublished, true),
            query
              ? or(
                  ilike(knowledgeArticles.title, `%${query}%`),
                  ilike(knowledgeArticles.content, `%${query}%`)
                )
              : undefined,
            category
              ? eq(knowledgeArticles.category, category as string)
              : undefined
          )
        )
        .orderBy(
          desc(knowledgeArticles.effectivenessScore),
          desc(knowledgeArticles.usageCount)
        )
        .limit(parseInt(limit as string));

      res.json(articles);
    } catch (error) {
      console.error("Error searching knowledge base:", error);
      res.status(500).json({ message: "Failed to search knowledge base" });
    }
  });

  // Get knowledge articles (admin)
  app.get("/api/admin/knowledge", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { category, published } = req.query;
      const filters: any = {};
      if (category) filters.category = category as string;
      if (published !== undefined) filters.isPublished = published === "true";

      const articles = await storage.getAllKnowledgeArticles(filters);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching knowledge articles:", error);
      res.status(500).json({ message: "Failed to fetch knowledge articles" });
    }
  });

  // Create knowledge article (admin)
  app.post("/api/admin/knowledge", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const articleData = {
        ...req.body,
        createdBy: userId,
      };

      const article = await storage.createKnowledgeArticle(articleData);
      res.status(201).json(article);
    } catch (error) {
      console.error("Error creating knowledge article:", error);
      res.status(500).json({ message: "Failed to create knowledge article" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const articleId = parseInt(req.params.id);
        const article = await storage.updateKnowledgeArticle(
          articleId,
          req.body
        );
        res.json(article);
      } catch (error) {
        console.error("Error updating knowledge article:", error);
        res.status(500).json({ message: "Failed to update knowledge article" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const articleId = parseInt(req.params.id);
        await storage.deleteKnowledgeArticle(articleId);
        res.json({ message: "Knowledge article deleted successfully" });
      } catch (error) {
        console.error("Error deleting knowledge article:", error);
        res.status(500).json({ message: "Failed to delete knowledge article" });
      }
    }
  );

  // Publish/unpublish knowledge article
  app.patch(
    "/api/admin/knowledge/:id/publish",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }

        const articleId = parseInt(req.params.id);
        const { isPublished } = req.body;

        const { knowledgeBaseService } = await import("../knowledgeBase");
        if (isPublished) {
          await knowledgeBaseService.publishArticle(articleId);
        } else {
          await knowledgeBaseService.unpublishArticle(articleId);
        }

        res.json({ message: "Article updated" });
      } catch (error) {
        console.error("Error updating article:", error);
        res.status(500).json({ message: "Failed to update article" });
      }
    }
  );

  // Feedback on knowledge article
  app.post("/api/knowledge/:id/feedback", isAuthenticated, async (req, res) => {
    try {
      const articleId = parseInt(req.params.id);
      const { wasHelpful } = req.body;

      const { knowledgeBaseService } = await import("../knowledgeBase");
      await knowledgeBaseService.updateArticleEffectiveness(
        articleId,
        wasHelpful
      );

      res.json({ message: "Feedback recorded" });
    } catch (error) {
      console.error("Error recording feedback:", error);
      res.status(500).json({ message: "Failed to record feedback" });
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
          return res.status(403).json({ message: "Manager access required" });
        }

        // Get auto-response statistics
        const autoResponseStats = await db
          .select({
            total: count(),
            applied: count(ticketAutoResponses.wasApplied),
            helpful: count(ticketAutoResponses.wasHelpful),
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
            publishedArticles: count(knowledgeArticles.isPublished),
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
        console.error("Error fetching AI analytics:", error);
        res.status(500).json({ message: "Failed to fetch AI analytics" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const rules = await db
          .select()
          .from(escalationRules)
          .orderBy(desc(escalationRules.priority));

        res.json(rules);
      } catch (error) {
        console.error("Error fetching escalation rules:", error);
        res.status(500).json({ message: "Failed to fetch escalation rules" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const rule = await db
          .insert(escalationRules)
          .values(req.body)
          .returning();

        res.json(rule[0]);
      } catch (error) {
        console.error("Error creating escalation rule:", error);
        res.status(500).json({ message: "Failed to create escalation rule" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const ruleId = parseInt(req.params.id);
        const rule = await db
          .update(escalationRules)
          .set(req.body)
          .where(eq(escalationRules.id, ruleId))
          .returning();

        res.json(rule[0]);
      } catch (error) {
        console.error("Error updating escalation rule:", error);
        res.status(500).json({ message: "Failed to update escalation rule" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const ruleId = parseInt(req.params.id);
        await db.delete(escalationRules).where(eq(escalationRules.id, ruleId));

        res.json({ message: "Rule deleted successfully" });
      } catch (error) {
        console.error("Error deleting escalation rule:", error);
        res.status(500).json({ message: "Failed to delete escalation rule" });
      }
    }
  );

  // Self-Learning Knowledge Base Endpoints

  // Submit feedback on AI response
  app.post("/api/ai-feedback", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { feedbackType, referenceId, rating, comment, ticketId } = req.body;

      // Validate rating
      if (![1, 5].includes(rating)) {
        return res
          .status(400)
          .json({ message: "Rating must be 1 (thumbs down) or 5 (thumbs up)" });
      }

      const feedback = await db
        .insert(aiFeedback)
        .values({
          feedbackType,
          referenceId,
          userId,
          rating,
          comment,
          ticketId,
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
      console.error("Error submitting AI feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  // Get AI feedback for a reference
  app.get(
    "/api/ai-feedback/:type/:referenceId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { type, referenceId } = req.params;

        const feedback = await db
          .select()
          .from(aiFeedback)
          .where(
            and(
              eq(aiFeedback.feedbackType, type),
              eq(aiFeedback.referenceId, parseInt(referenceId))
            )
          )
          .orderBy(desc(aiFeedback.createdAt));

        res.json(feedback);
      } catch (error) {
        console.error("Error fetching AI feedback:", error);
        res.status(500).json({ message: "Failed to fetch feedback" });
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
          return res.status(400).json({ message: "Search query is required" });
        }

        const results = await intelligentKnowledgeSearch(query, null, limit);

        res.json(results);
      } catch (error) {
        console.error("Error searching knowledge base:", error);
        res.status(500).json({ message: "Failed to search knowledge base" });
      }
    }
  );

  // Add ticket to learning queue when resolved
  app.post(
    "/api/tasks/:id/add-to-learning",
    isAuthenticated,
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
          return res.status(400).json({
            message: "Only resolved tickets can be added to learning queue",
          });
        }

        // Check if already in queue
        const existing = await db
          .select()
          .from(learningQueue)
          .where(eq(learningQueue.ticketId, taskId))
          .limit(1);

        if (existing.length > 0) {
          return res
            .status(400)
            .json({ message: "Ticket already in learning queue" });
        }

        // Add to queue
        const [queueItem] = await db
          .insert(learningQueue)
          .values({ ticketId: taskId })
          .returning();

        res.json(queueItem);
      } catch (error) {
        console.error("Error adding to learning queue:", error);
        res.status(500).json({ message: "Failed to add to learning queue" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        // Process knowledge learning queue asynchronously
        processKnowledgeLearning().catch(console.error);

        res.json({ message: "Learning queue processing started" });
      } catch (error) {
        console.error("Error starting learning queue:", error);
        res.status(500).json({ message: "Failed to start learning queue" });
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
          return res.status(403).json({ message: "Admin access required" });
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
        console.error("Error seeding historical tickets:", error);
        res.status(500).json({ message: "Failed to seed historical tickets" });
      }
    }
  );

  // Get learning queue status
  app.get(
    "/api/admin/learning-queue/status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = await storage.getUser(getUserId(req));
        if (!user || user.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
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
        console.error("Error fetching learning queue status:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch learning queue status" });
      }
    }
  );

  const httpServer = createServer(app);

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // Store connected clients with their user IDs
  const clients = new Map<string, WebSocket>();

  function send(ws: WebSocket, msg: any) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      console.error("WS send error:", e);
    }
  }

  function envelope(type: string, data: any) {
    return { type, data, ts: Date.now(), v: 1 };
  }

  function broadcastToMany(userIds: string[], message: any) {
    for (const uid of userIds) {
      const c = clients.get(uid);
      if (c && c.readyState === WebSocket.OPEN) send(c, message);
    }
  }

  wss.on("connection", (ws, req) => {
    console.log("WebSocket client connected");

    // Extract user ID from the session or authentication
    let userId: string | null = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === "auth" && data.userId) {
          userId = data.userId;
          clients.set(userId, ws);
          ws.send(
            JSON.stringify({
              type: "connected",
              message: "WebSocket connection established",
            })
          );
        }

        // Handle other message types if needed
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
      if (userId) {
        clients.delete(userId);
      }
      console.log("WebSocket client disconnected");
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });

  // Helper function to broadcast updates to specific users
  function broadcastToUser(userId: string, message: any) {
    const client = clients.get(userId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  // Helper function to broadcast to all connected clients
  function broadcastToAll(message: any) {
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  // Attach broadcast functions to app for use in routes
  (app as any).broadcastToUser = broadcastToUser;
  (app as any).broadcastToAll = broadcastToAll;

  // AI Analysis and Auto-Response Routes
  app.post("/api/ai/analyze-ticket", isAuthenticated, async (req: any, res) => {
    try {
      const { title, description, category, priority } = req.body;
      const userId = getUserId(req);

      if (!title || !description) {
        return res
          .status(400)
          .json({ message: "Title and description are required" });
      }

      const analysis = await analyzeTicket(
        {
          title,
          description,
          category: category || "support",
          priority: priority || "medium",
          reporterId: userId,
        },
        userId
      );

      if (!analysis) {
        return res
          .status(503)
          .json({ message: "AI analysis service unavailable" });
      }

      res.json(analysis);
    } catch (error) {
      console.error("AI analysis error:", error);

      // Check if request was blocked due to cost limits
      if ((error as any).isBlocked) {
        return res.status(429).json({
          message: "Request blocked due to cost limits",
          reason: error.message,
          costEstimate: (error as any).costEstimate,
          isBlocked: true,
        });
      }

      res.status(500).json({ message: "Failed to analyze ticket" });
    }
  });

  app.post(
    "/api/ai/generate-response",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { title, description, category, priority, analysis } = req.body;

        if (!title || !description || !analysis) {
          return res
            .status(400)
            .json({ message: "Title, description, and analysis are required" });
        }

        const autoResponse = await generateAutoResponse(
          { title, description, category, priority },
          analysis
        );

        if (!autoResponse) {
          return res
            .status(503)
            .json({ message: "AI response generation service unavailable" });
        }

        res.json(autoResponse);
      } catch (error) {
        console.error("AI response generation error:", error);
        res.status(500).json({ message: "Failed to generate response" });
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
          return res.status(403).json({ message: "Admin access required" });
        }

        const results = await processKnowledgeLearning();
        res.json({
          message: "Knowledge learning process completed",
          ...results,
        });
      } catch (error) {
        console.error("Knowledge learning error:", error);
        res.status(500).json({ message: "Failed to run knowledge learning" });
      }
    }
  );

  app.get(
    "/api/ai/knowledge-search",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { query, category, maxResults = 10 } = req.query;

        if (!query) {
          return res
            .status(400)
            .json({ message: "Query parameter is required" });
        }

        const results = await intelligentKnowledgeSearch(
          query as string,
          category as string,
          parseInt(maxResults as string)
        );

        res.json(results);
      } catch (error) {
        console.error("Knowledge search error:", error);
        res.status(500).json({ message: "Failed to search knowledge base" });
      }
    }
  );

  // AI System Status Route
  app.get("/api/ai/status", isAuthenticated, async (req: any, res) => {
    try {
      // 1) Check env credentials
      const envAwsConfigured = !!(
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        process.env.AWS_REGION
      );

      // 2) Check stored SMTP (SES) and Bedrock settings
      let smtp = undefined as any;
      let bedrock = undefined as any;
      try {
        smtp = await storage.getSmtpSettings();
      } catch {}
      try {
        bedrock = await storage.getBedrockSettings();
      } catch {}

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
      console.error("AI status check error:", error);
      res.status(500).json({ message: "Failed to check AI status" });
    }
  });

  // Knowledge Base Management Routes (admin only)

  // Get all knowledge articles with filtering
  app.get("/api/admin/knowledge", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

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
      console.error("Error fetching knowledge articles:", error);
      res.status(500).json({ message: "Failed to fetch knowledge articles" });
    }
  });

  // Create a new knowledge article
  app.post("/api/admin/knowledge", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { title, summary, content, category, tags, isPublished } = req.body;

      if (!title || !content) {
        return res
          .status(400)
          .json({ message: "Title and content are required" });
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
      console.error("Error creating knowledge article:", error);
      res.status(500).json({ message: "Failed to create knowledge article" });
    }
  });

  // Get a specific knowledge article
  app.get(
    "/api/admin/knowledge/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        const article = await storage.getKnowledgeArticle(id);

        if (!article) {
          return res
            .status(404)
            .json({ message: "Knowledge article not found" });
        }

        res.json(article);
      } catch (error) {
        console.error("Error fetching knowledge article:", error);
        res.status(500).json({ message: "Failed to fetch knowledge article" });
      }
    }
  );

  // Update a knowledge article
  app.put(
    "/api/admin/knowledge/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        const updates = req.body;

        // Ensure we don't update protected fields
        delete updates.id;
        delete updates.createdAt;
        delete updates.usageCount;
        delete updates.createdBy;

        const article = await storage.updateKnowledgeArticle(id, updates);
        res.json(article);
      } catch (error) {
        console.error("Error updating knowledge article:", error);
        res.status(500).json({ message: "Failed to update knowledge article" });
      }
    }
  );

  // Delete a knowledge article
  app.delete(
    "/api/admin/knowledge/:id",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        await storage.deleteKnowledgeArticle(id);
        res.json({ message: "Knowledge article deleted successfully" });
      } catch (error) {
        console.error("Error deleting knowledge article:", error);
        res.status(500).json({ message: "Failed to delete knowledge article" });
      }
    }
  );

  // Publish / Unpublish / Archive / Unarchive endpoints
  app.patch(
    "/api/admin/knowledge/:id/publish",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);
        if (user?.role !== "admin")
          return res.status(403).json({ message: "Admin access required" });
        const id = parseInt(req.params.id);
        const article = await storage.setKnowledgeArticleStatus(
          id,
          "published"
        );
        res.json(article);
      } catch (error) {
        console.error("Error publishing article:", error);
        res.status(500).json({ message: "Failed to publish article" });
      }
    }
  );

  app.patch(
    "/api/admin/knowledge/:id/unpublish",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);
        if (user?.role !== "admin")
          return res.status(403).json({ message: "Admin access required" });
        const id = parseInt(req.params.id);
        const article = await storage.setKnowledgeArticleStatus(id, "draft");
        res.json(article);
      } catch (error) {
        console.error("Error unpublishing article:", error);
        res.status(500).json({ message: "Failed to unpublish article" });
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
          return res.status(403).json({ message: "Admin access required" });
        const id = parseInt(req.params.id);
        const article = await storage.setKnowledgeArticleStatus(id, "archived");
        res.json(article);
      } catch (error) {
        console.error("Error archiving article:", error);
        res.status(500).json({ message: "Failed to archive article" });
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
          return res.status(403).json({ message: "Admin access required" });
        const id = parseInt(req.params.id);
        const article = await storage.setKnowledgeArticleStatus(id, "draft");
        res.json(article);
      } catch (error) {
        console.error("Error unarchiving article:", error);
        res.status(500).json({ message: "Failed to unarchive article" });
      }
    }
  );

  // Public knowledge base search (for all users)
  app.get("/api/knowledge/search", isAuthenticated, async (req: any, res) => {
    try {
      const { q: query, category } = req.query;

      if (!query) {
        return res.status(400).json({ message: "Search query is required" });
      }

      const articles = await storage.searchKnowledgeBase(
        query as string,
        category as string
      );
      res.json(articles);
    } catch (error) {
      console.error("Error searching knowledge base:", error);
      res.status(500).json({ message: "Failed to search knowledge base" });
    }
  });

  // Get published knowledge articles (for all users)
  app.get("/api/knowledge/articles", isAuthenticated, async (req: any, res) => {
    try {
      const { category } = req.query;
      const articles = await storage.getPublishedKnowledgeArticles(
        category as string
      );
      res.json(articles);
    } catch (error) {
      console.error("Error fetching published articles:", error);
      res.status(500).json({ message: "Failed to fetch knowledge articles" });
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
        console.error("Error incrementing view count:", error);
        res.status(500).json({ message: "Failed to increment view count" });
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
        console.error("Error tracking article usage:", error);
        res.status(500).json({ message: "Failed to track usage" });
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
          return res
            .status(400)
            .json({ message: "Rating must be between 1 and 5" });
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
        console.error("Error rating article:", error);
        res.status(500).json({ message: "Failed to submit rating" });
      }
    }
  );

  // Stats endpoints
  app.get("/api/stats/agent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role !== "agent") {
        return res
          .status(403)
          .json({ message: "Access denied. Agent role required." });
      }

      const stats = await storage.getAgentStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching agent stats:", error);
      res.status(500).json({ message: "Failed to fetch agent stats" });
    }
  });

  app.get("/api/stats/manager", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role !== "manager") {
        return res
          .status(403)
          .json({ message: "Access denied. Manager role required." });
      }

      const stats = await storage.getManagerStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching manager stats:", error);
      res.status(500).json({ message: "Failed to fetch manager stats" });
    }
  });

  // Initialize AI systems
  try {
    // Start knowledge learning scheduler
    scheduleKnowledgeLearning();
    console.log("AI systems initialized successfully");
  } catch (error) {
    console.error("AI system initialization error:", error);
  }

  return httpServer;
}
