/**
 * TicketFlow API Routes
 * 
 * This module defines all REST API endpoints for the TicketFlow application.
 * Routes are organized by feature area and protected by authentication middleware.
 * 
 * @module routes
 */

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./auth";
import { setupMicrosoftAuth, isMicrosoftUser } from "./microsoftAuth";
import { teamsIntegration } from "./microsoftTeams";
import { sendTestEmail } from "./ses";
import { 
  insertTaskSchema, 
  insertTeamSchema, 
  insertTaskCommentSchema,
  insertTaskAttachmentSchema,
  insertCompanySettingsSchema,
  insertApiKeySchema 
} from "@shared/schema";
import { z } from "zod";
import { createHash } from 'crypto';
import multer from 'multer';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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

  // Users route
  app.get('/api/users', isAuthenticated, async (req, res) => {
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
      
      const { status, category, assigneeId, search, limit, offset } = req.query;
      
      // If user is a customer, only show their own tickets
      let filters: any = {
        status,
        category,
        assigneeId,
        search,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      };
      
      if (user?.role === 'customer') {
        filters.createdBy = userId;
        delete filters.assigneeId; // Customers can't filter by assignee
      } else if (user?.role !== 'admin' && !assigneeId) {
        // For non-admin users (not customers), show tasks they created or are assigned to
        filters.userIdFilter = userId;
      }
      // Admins see all tasks by default
      
      const tasks = await storage.getTasks(filters);
      res.json(tasks);
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
      if (user?.role === 'customer' && task.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(task);
    } catch (error) {
      console.error("Error fetching task:", error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const taskData = insertTaskSchema.parse({
        ...req.body,
        createdBy: userId,
      });
      const task = await storage.createTask(taskData);
      
      // Send Teams notification for new task
      try {
        const user = await storage.getUser(userId);
        const allUsers = await storage.getAllUsers();
        const notificationPromises = allUsers.map(async (notifyUser) => {
          const settings = await storage.getTeamsIntegrationSettings(notifyUser.id);
          if (settings?.enabled && settings.notificationTypes?.includes('ticket_created')) {
            const actionUrl = `${req.protocol}://${req.get('host')}/my-tasks`;
            const message = `New ticket created by ${user?.email || 'a user'}`;
            
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
      
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

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
      
      // Customers can only update their own tickets
      if (user?.role === 'customer' && task.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const updates = insertTaskSchema.partial().parse(req.body);
      const updatedTask = await storage.updateTask(taskId, updates, userId);
      
      // Send Teams notification for task update
      try {
        const user = await storage.getUser(userId);
        const allUsers = await storage.getAllUsers();
        const notificationPromises = allUsers.map(async (notifyUser) => {
          const settings = await storage.getTeamsIntegrationSettings(notifyUser.id);
          if (settings?.enabled && 
              (settings.notificationTypes?.includes('ticket_updated') ||
               (updates.assigneeId && settings.notificationTypes?.includes('ticket_assigned')))) {
            const actionUrl = `${req.protocol}://${req.get('host')}/my-tasks`;
            let message = `Ticket updated by ${user?.email || 'a user'}`;
            
            if (updates.assigneeId && updates.assigneeId === notifyUser.id) {
              message = `Ticket assigned to you by ${user?.email || 'a user'}`;
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
        return res.status(400).json({ message: "Invalid update data", errors: error.errors });
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
      
      // Customers cannot delete tasks
      if (user?.role === 'customer') {
        return res.status(403).json({ message: "Customers cannot delete tickets" });
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
      if (user?.role === 'customer') {
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

  app.post("/api/tasks/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      // Check if customer has access to this task
      if (user?.role === 'customer') {
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
      res.status(201).json(comment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid comment data", errors: error.errors });
      }
      console.error("Error creating comment:", error);
      res.status(500).json({ message: "Failed to create comment" });
    }
  });

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
      if (user?.role === 'customer') {
        return res.status(403).json({ message: "Customers cannot access teams" });
      }
      
      const teams = await storage.getTeams();
      res.json(teams);
    } catch (error) {
      console.error("Error fetching teams:", error);
      res.status(500).json({ message: "Failed to fetch teams" });
    }
  });

  app.get("/api/teams/my", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      // Customers cannot access teams
      if (user?.role === 'customer') {
        return res.status(403).json({ message: "Customers cannot access teams" });
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
        return res.status(400).json({ message: "Invalid team data", errors: error.errors });
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

  app.get("/api/teams/:id/members", isAuthenticated, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id);
      const members = await storage.getTeamMembers(teamId);
      res.json(members);
    } catch (error) {
      console.error("Error fetching team members:", error);
      res.status(500).json({ message: "Failed to fetch team members" });
    }
  });

  // Update team member role
  app.patch("/api/teams/:teamId/members/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { teamId, userId } = req.params;
      const { role } = req.body;
      
      const updatedMember = await storage.updateTeamMemberRole(userId, parseInt(teamId), role);
      res.json(updatedMember);
    } catch (error) {
      console.error("Error updating team member role:", error);
      res.status(500).json({ message: "Failed to update team member role" });
    }
  });

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

  app.patch("/api/admin/users/:userId", isAuthenticated, async (req: any, res) => {
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
  });

  app.post("/api/admin/users/:userId/toggle-status", isAuthenticated, async (req: any, res) => {
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
  });

  app.post("/api/admin/users/:userId/approve", isAuthenticated, async (req: any, res) => {
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
  });

  app.post("/api/admin/users/:userId/assign-team", isAuthenticated, async (req: any, res) => {
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
  });

  app.delete("/api/admin/users/:userId/remove-team/:teamId", isAuthenticated, async (req: any, res) => {
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
  });

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

  app.post("/api/admin/users/:userId/reset-password", isAuthenticated, async (req: any, res) => {
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
  });

  // Statistics
  app.get("/api/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      // If admin, show all stats, otherwise show user-specific stats
      const stats = await storage.getTaskStats(user?.role === 'admin' ? undefined : userId);
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
  app.post("/api/tasks/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = getUserId(req);
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ message: "Comment content is required" });
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
  });

  // Attachment routes
  app.get("/api/tasks/:id/attachments", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      // Check if customer has access to this task
      if (user?.role === 'customer') {
        const task = await storage.getTask(taskId);
        if (!task || task.createdBy !== userId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const attachments = await storage.getTaskAttachments(taskId);
      res.json(attachments);
    } catch (error) {
      console.error("Error fetching attachments:", error);
      res.status(500).json({ message: "Failed to fetch attachments" });
    }
  });

  app.post("/api/tasks/:id/attachments", isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      // Check if customer has access to this task
      if (user?.role === 'customer') {
        const task = await storage.getTask(taskId);
        if (!task || task.createdBy !== userId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const attachmentData = insertTaskAttachmentSchema.parse({
        ...req.body,
        taskId,
        userId,
      });
      const attachment = await storage.addTaskAttachment(attachmentData);
      res.status(201).json(attachment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid attachment data", errors: error.errors });
      }
      console.error("Error creating attachment:", error);
      res.status(500).json({ message: "Failed to create attachment" });
    }
  });

  app.delete("/api/attachments/:id", isAuthenticated, async (req, res) => {
    try {
      const attachmentId = parseInt(req.params.id);
      await storage.deleteTaskAttachment(attachmentId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting attachment:", error);
      res.status(500).json({ message: "Failed to delete attachment" });
    }
  });

  // Company settings routes
  app.get("/api/company-settings", isAuthenticated, async (req, res) => {
    try {
      const settings = await storage.getCompanySettings();
      res.json(settings || { companyName: "TicketFlow", primaryColor: "#3b82f6" });
    } catch (error) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: "Failed to fetch company settings" });
    }
  });

  app.patch("/api/company-settings", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Only admins can update company settings" });
      }
      
      const userId = getUserId(req);
      const settingsData = insertCompanySettingsSchema.parse(req.body);
      const settings = await storage.updateCompanySettings(settingsData, userId);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid settings data", errors: error.errors });
      }
      console.error("Error updating company settings:", error);
      res.status(500).json({ message: "Failed to update company settings" });
    }
  });

  // Logo upload endpoint
  app.post("/api/company-settings/logo", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Only admins can update company logo" });
      }
      
      const { fileName, fileType, fileData } = req.body;
      
      // Validate file type
      if (!['image/jpeg', 'image/jpg', 'image/png'].includes(fileType)) {
        return res.status(400).json({ message: "Invalid file type. Only JPG and PNG are allowed." });
      }
      
      // Convert base64 to data URL
      const logoUrl = `data:${fileType};base64,${fileData}`;
      
      const userId = getUserId(req);
      const settings = await storage.updateCompanySettings({ logoUrl }, userId);
      res.json(settings);
    } catch (error) {
      console.error("Error uploading logo:", error);
      res.status(500).json({ message: "Failed to upload logo" });
    }
  });

  // API key routes
  app.get("/api/api-keys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const apiKeys = await storage.getApiKeys(userId);
      // Don't send the actual key hashes to the client
      const sanitizedKeys = apiKeys.map(key => ({
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
        return res.status(400).json({ message: "Invalid API key data", errors: error.errors });
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
      const keyExists = apiKeys.some(key => key.id === keyId);
      
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
  app.post('/api/api-keys/perplexity', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ message: "API key is required" });
      }
      
      // Check if Perplexity key already exists
      const existingKeys = await storage.getApiKeys('system');
      const perplexityKey = existingKeys.find(key => key.name === 'Perplexity API Key');
      
      if (perplexityKey) {
        // Update existing key
        await storage.updateApiKey(perplexityKey.id, { keyHash: apiKey });
      } else {
        // Create new key
        await storage.createApiKey({
          userId: 'system',
          name: 'Perplexity API Key',
          keyHash: apiKey,
          keyPrefix: apiKey.substring(0, 8),
          permissions: ['ai_chat'],
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
  app.get('/api/api-keys/perplexity/status', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const apiKeys = await storage.getApiKeys('system');
      const perplexityKey = apiKeys.find(key => key.name === 'Perplexity API Key' && key.isActive);
      
      res.json({ exists: !!perplexityKey });
    } catch (error) {
      console.error("Error checking Perplexity API key:", error);
      res.status(500).json({ message: "Failed to check Perplexity API key" });
    }
  });

  // SMTP settings routes (admin only)
  app.get("/api/smtp/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const settings = await storage.getSmtpSettings();
      res.json(settings || null);
    } catch (error) {
      console.error("Error fetching SMTP settings:", error);
      res.status(500).json({ message: "Failed to fetch SMTP settings" });
    }
  });

  app.post("/api/smtp/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const settings = await storage.updateSmtpSettings(req.body, userId);
      res.json(settings);
    } catch (error) {
      console.error("Error updating SMTP settings:", error);
      res.status(500).json({ message: "Failed to update SMTP settings" });
    }
  });

  // Email template routes (admin only)
  app.get("/api/email/templates", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const templates = await storage.getEmailTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  app.get("/api/email/templates/:name", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const template = await storage.getEmailTemplate(req.params.name);
      if (template) {
        res.json(template);
      } else {
        res.status(404).json({ message: "Template not found" });
      }
    } catch (error) {
      console.error("Error fetching email template:", error);
      res.status(500).json({ message: "Failed to fetch email template" });
    }
  });

  app.put("/api/email/templates/:name", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const template = await storage.updateEmailTemplate(req.params.name, req.body, userId);
      res.json(template);
    } catch (error) {
      console.error("Error updating email template:", error);
      res.status(500).json({ message: "Failed to update email template" });
    }
  });

  // SSO Configuration routes
  app.get("/api/sso/config", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const config = await storage.getSsoConfiguration();
      res.json(config || { clientId: '', clientSecret: '', tenantId: '' });
    } catch (error) {
      console.error("Error fetching SSO configuration:", error);
      res.status(500).json({ message: "Failed to fetch SSO configuration" });
    }
  });
  
  // SSO Status check (available to all authenticated users)
  app.get("/api/sso/status", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getSsoConfiguration();
      const isConfigured = !!(config?.clientId && config?.clientSecret && config?.tenantId);
      res.json({ configured: isConfigured });
    } catch (error) {
      console.error("Error checking SSO status:", error);
      res.status(500).json({ message: "Failed to check SSO status" });
    }
  });
  
  // Test SSO Configuration (admin only)
  app.post("/api/sso/test", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const config = await storage.getSsoConfiguration();
      if (!config?.clientId || !config?.clientSecret || !config?.tenantId) {
        return res.status(400).json({ message: "SSO not configured" });
      }
      
      // Test the configuration by trying to fetch the OpenID configuration
      const metadataUrl = `https://login.microsoftonline.com/${config.tenantId}/v2.0/.well-known/openid-configuration`;
      
      try {
        const response = await fetch(metadataUrl);
        if (!response.ok) {
          return res.status(400).json({ 
            message: "Invalid tenant ID or Azure AD configuration", 
            details: `Failed to fetch metadata from ${metadataUrl}` 
          });
        }
        
        const metadata = await response.json();
        res.json({ 
          success: true, 
          message: "SSO configuration is valid",
          issuer: metadata.issuer 
        });
      } catch (fetchError) {
        console.error("Error testing SSO config:", fetchError);
        res.status(400).json({ 
          message: "Failed to connect to Azure AD", 
          details: fetchError.message 
        });
      }
    } catch (error) {
      console.error("Error testing SSO configuration:", error);
      res.status(500).json({ message: "Failed to test SSO configuration" });
    }
  });

  app.post("/api/sso/config", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const config = await storage.upsertSsoConfiguration({
        ...req.body,
        updatedBy: userId,
      });
      res.json(config);
    } catch (error) {
      console.error("Error updating SSO configuration:", error);
      res.status(500).json({ message: "Failed to update SSO configuration" });
    }
  });

  // Send test email (admin only)
  app.post("/api/email/test", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      // This will be implemented when we integrate email templates
      const { to, templateName } = req.body;
      
      // For now, just return success
      res.json({ message: "Test email functionality will be available after email template integration" });
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({ message: "Failed to send test email" });
    }
  });

  // Get SMTP settings (admin only)
  app.get('/api/smtp/settings', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const settings = await storage.getSmtpSettings();
      
      // Return AWS SES settings in the format expected by frontend
      if (settings) {
        res.json({
          awsAccessKeyId: settings.awsAccessKeyId,
          awsSecretAccessKey: settings.awsSecretAccessKey,
          awsRegion: settings.awsRegion || 'us-east-1',
          fromEmail: settings.fromEmail,
          fromName: settings.fromName || 'TicketFlow',
        });
      } else {
        res.json({});
      }
    } catch (error) {
      console.error("Error fetching SMTP settings:", error);
      res.status(500).json({ message: "Failed to fetch SMTP settings" });
    }
  });
  
  // Save SMTP settings (admin only)
  app.post('/api/smtp/settings', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      // Save AWS SES settings
      const smtpSettings = {
        awsAccessKeyId: req.body.awsAccessKeyId,
        awsSecretAccessKey: req.body.awsSecretAccessKey,
        awsRegion: req.body.awsRegion || 'us-east-1',
        fromEmail: req.body.fromEmail,
        fromName: req.body.fromName || 'TicketFlow',
        useAwsSes: true,
        isActive: true,
      };
      
      const settings = await storage.updateSmtpSettings(smtpSettings, userId);
      
      // Return in the format expected by frontend
      res.json({
        awsAccessKeyId: settings.awsAccessKeyId,
        awsSecretAccessKey: settings.awsSecretAccessKey,
        awsRegion: settings.awsRegion,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
      });
    } catch (error) {
      console.error("Error saving SMTP settings:", error);
      res.status(500).json({ message: "Failed to save SMTP settings" });
    }
  });

  // Test SMTP configuration
  app.post('/api/smtp/test', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { testEmail } = req.body;
      
      if (!testEmail) {
        return res.status(400).json({ message: "Test email address is required" });
      }

      // Get current SMTP settings
      const smtpSettings = await storage.getSmtpSettings();
      
      if (!smtpSettings) {
        return res.status(400).json({ message: "SMTP settings not configured" });
      }

      // Test sending email using AWS SES
      const success = await sendTestEmail(
        '', // host not used for AWS SES
        0, // port not used for AWS SES
        smtpSettings.awsAccessKeyId || '',
        smtpSettings.awsSecretAccessKey || '',
        smtpSettings.awsRegion || 'us-east-1',
        smtpSettings.fromEmail,
        smtpSettings.fromName,
        testEmail
      );

      if (success) {
        res.json({ message: "Test email sent successfully" });
      } else {
        res.status(500).json({ message: "Failed to send test email. Please check your AWS credentials and ensure the email addresses are verified in SES." });
      }
    } catch (error) {
      console.error("SMTP test error:", error);
      res.status(500).json({ message: "Failed to test SMTP configuration" });
    }
  });

  // Email template routes
  
  // Get all email templates (admin only)
  app.get('/api/email-templates', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.put('/api/email-templates/:name', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { name } = req.params;
      const template = await storage.updateEmailTemplate(name, req.body, userId);
      res.json(template);
    } catch (error) {
      console.error("Error updating email template:", error);
      res.status(500).json({ message: "Failed to update email template" });
    }
  });

  // Help documentation routes
  
  // Get all help documents (public)
  app.get('/api/help', async (req, res) => {
    try {
      const documents = await storage.getHelpDocuments();
      res.json(documents);
    } catch (error) {
      console.error("Error fetching help documents:", error);
      res.status(500).json({ message: "Failed to fetch help documents" });
    }
  });

  // Search help documents (public)
  app.get('/api/help/search', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
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
  app.get('/api/help/:id', async (req, res) => {
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
  app.post('/api/admin/help', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { title, filename, content, fileData, category, tags } = req.body;
      
      if (!title || !filename || !content || !fileData) {
        return res.status(400).json({ message: "Title, filename, content, and file data are required" });
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
  app.put('/api/admin/help/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.delete('/api/admin/help/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.get('/api/guide-categories', isAuthenticated, async (req, res) => {
    try {
      const categories = await storage.getUserGuideCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching guide categories:", error);
      res.status(500).json({ message: "Failed to fetch guide categories" });
    }
  });

  // Get all guides (optionally filter by published status)
  app.get('/api/guides', isAuthenticated, async (req, res) => {
    try {
      const { published } = req.query;
      const guides = await storage.getUserGuides(published === 'true' ? { isPublished: true } : undefined);
      res.json(guides);
    } catch (error) {
      console.error("Error fetching guides:", error);
      res.status(500).json({ message: "Failed to fetch guides" });
    }
  });

  // Get single guide
  app.get('/api/guides/:id', isAuthenticated, async (req, res) => {
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
  app.post('/api/admin/guide-categories', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.put('/api/admin/guide-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const category = await storage.updateUserGuideCategory(id, req.body);
      res.json(category);
    } catch (error) {
      console.error("Error updating guide category:", error);
      res.status(500).json({ message: "Failed to update guide category" });
    }
  });

  // Delete guide category (admin only)
  app.delete('/api/admin/guide-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      await storage.deleteUserGuideCategory(id);
      res.json({ message: "Guide category deleted successfully" });
    } catch (error) {
      console.error("Error deleting guide category:", error);
      res.status(500).json({ message: "Failed to delete guide category" });
    }
  });

  // Create guide (admin only)
  app.post('/api/admin/guides', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.put('/api/admin/guides/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.delete('/api/admin/guides/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // Helper function to calculate question hash
  function calculateQuestionHash(normalizedQuestion: string): string {
    return createHash('sha256').update(normalizedQuestion).digest('hex');
  }
  
  // Helper function to calculate token costs for Bedrock
  function calculateBedrockCost(inputTokens: number, outputTokens: number, modelId: string): number {
    // Claude 3 Sonnet pricing per 1M tokens (as of 2024)
    const pricePerMillionInputTokens = 3.00; // $3 per 1M input tokens
    const pricePerMillionOutputTokens = 15.00; // $15 per 1M output tokens
    
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
  app.post('/api/chat', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { sessionId, message } = req.body;
      
      if (!sessionId || !message) {
        return res.status(400).json({ message: "Session ID and message are required" });
      }

      // Save user message
      await storage.createChatMessage({
        userId,
        sessionId,
        role: 'user',
        content: message,
      });

      // Check FAQ cache first
      const normalizedQuestion = normalizeQuestion(message);
      const questionHash = calculateQuestionHash(normalizedQuestion);
      
      const cachedAnswer = await storage.getFaqCacheEntry(questionHash);
      if (cachedAnswer) {
        // Update hit count
        await storage.updateFaqCacheHit(cachedAnswer.id);
        
        // Save cached response
        const aiMessage = await storage.createChatMessage({
          userId,
          sessionId,
          role: 'assistant',
          content: cachedAnswer.answer,
          relatedDocumentIds: [],
        });
        
        return res.json({
          message: aiMessage,
          relatedDocuments: [],
          fromCache: true,
        });
      }

      // Check if we have AWS Bedrock credentials
      const smtpSettings = await storage.getSmtpSettings();
      const hasBedrockCredentials = smtpSettings?.awsAccessKeyId && smtpSettings?.awsSecretAccessKey && smtpSettings?.awsRegion;
      
      let response = "";
      const relevantDocIds: number[] = [];
      let usageData = null;
      
      if (hasBedrockCredentials) {
        // Use AWS Bedrock for intelligent responses
        try {
          // Import AWS Bedrock client
          const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
          
          // Get help documents for context
          const helpDocs = await storage.searchHelpDocuments(message);
          let context = "";
          
          if (helpDocs.length > 0) {
            context = "\n\nRelevant documentation context:\n";
            const topDocs = helpDocs.slice(0, 3);
            for (const doc of topDocs) {
              relevantDocIds.push(doc.id);
              context += `- ${doc.title}: ${doc.content.substring(0, 200)}...\n`;
            }
          }
          
          // Configure AWS Bedrock client
          const bedrockClient = new BedrockRuntimeClient({
            region: smtpSettings.awsRegion,
            credentials: {
              accessKeyId: smtpSettings.awsAccessKeyId,
              secretAccessKey: smtpSettings.awsSecretAccessKey,
            },
          });
          
          // Prepare the system message and user message
          const systemMessage = "You are a helpful assistant for TicketFlow, a ticketing system. Answer questions based on the provided context when available. Be concise and helpful.";
          
          let userMessage = message;
          if (context) {
            userMessage = `Context:\n${context}\n\nUser question: ${message}`;
          }
          
          // Create the request payload for Claude
          const command = new InvokeModelCommand({
            modelId: "anthropic.claude-3-sonnet-20240229-v1:0", // Using Claude 3 Sonnet
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({
              anthropic_version: "bedrock-2023-05-31",
              max_tokens: 1000,
              temperature: 0.2,
              system: systemMessage,
              messages: [{
                role: "user",
                content: userMessage
              }]
            }),
          });
          
          // Invoke the model
          const bedrockResponse = await bedrockClient.send(command);
          const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
          response = responseBody.content[0].text;
          
          // Track usage
          const inputTokens = estimateTokenCount(systemMessage + userMessage);
          const outputTokens = estimateTokenCount(response);
          const totalTokens = inputTokens + outputTokens;
          const modelId = "anthropic.claude-3-sonnet-20240229-v1:0";
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
          console.error("Error details:", error.message, error.name);
          // Fallback to simple response
          response = "I apologize, but I'm having trouble processing your request. Please try again later or contact support.";
        }
      } else {
        // No AWS credentials configured - use simple fallback
        try {
          const helpDocs = await storage.searchHelpDocuments(message);
          
          if (helpDocs.length > 0) {
            response = "I found some relevant documentation:\n\n";
            const topDocs = helpDocs.slice(0, 3);
            
            for (const doc of topDocs) {
              relevantDocIds.push(doc.id);
              response += `**${doc.title}**\n`;
              const contentPreview = doc.content.substring(0, 300) + (doc.content.length > 300 ? '...' : '');
              response += `${contentPreview}\n\n`;
            }
          } else {
            response = "I'm here to help! However, the AI service is not configured. Please ask your administrator to configure AWS credentials in the Admin Panel > Email Settings tab.";
          }
        } catch (error) {
          console.error("Error searching help documents:", error);
          response = "I'm experiencing technical difficulties. Please try again later.";
        }
      }

      // Save AI response
      const aiMessage = await storage.createChatMessage({
        userId,
        sessionId,
        role: 'assistant',
        content: response,
        relatedDocumentIds: relevantDocIds.length > 0 ? relevantDocIds : undefined,
      });

      res.json({
        message: aiMessage,
        relatedDocuments: [],
        usageData: usageData ? {
          inputTokens: usageData.inputTokens,
          outputTokens: usageData.outputTokens,
          totalTokens: usageData.totalTokens,
          cost: parseFloat(usageData.cost),
        } : undefined,
      });
    } catch (error: any) {
      console.error("Error in chat:", error);
      console.error("Chat error details:", error.message, error.stack);
      res.status(500).json({ message: "Failed to process chat message" });
    }
  });

  // Get chat history
  app.get('/api/chat/:sessionId', isAuthenticated, async (req, res) => {
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
  app.get('/api/chat-sessions', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const sessions = await storage.getChatSessions(userId);
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching chat sessions:", error);
      res.status(500).json({ message: "Failed to fetch chat sessions" });
    }
  });

  // Bedrock usage endpoints
  app.get('/api/bedrock/usage', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      // Allow users to see their own usage, admins to see all
      const targetUserId = user?.role === 'admin' && req.query.userId ? 
        req.query.userId as string : userId;
      
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      
      const usage = await storage.getBedrockUsageByUser(targetUserId, startDate, endDate);
      res.json(usage);
    } catch (error) {
      console.error("Error fetching Bedrock usage:", error);
      res.status(500).json({ message: "Failed to fetch Bedrock usage" });
    }
  });

  app.get('/api/bedrock/usage/summary', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      
      const summary = await storage.getBedrockUsageSummary(startDate, endDate);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching Bedrock usage summary:", error);
      res.status(500).json({ message: "Failed to fetch Bedrock usage summary" });
    }
  });

  // FAQ cache endpoints
  app.get('/api/faq-cache', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
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

  app.delete('/api/faq-cache', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
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
  app.get('/api/company-policies', isAuthenticated, async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const policies = await storage.getAllCompanyPolicies(includeInactive);
      res.json(policies);
    } catch (error) {
      console.error("Error fetching company policies:", error);
      res.status(500).json({ message: "Failed to fetch company policies" });
    }
  });

  app.get('/api/company-policies/:id', isAuthenticated, async (req, res) => {
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

  app.post('/api/admin/company-policies', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "File is required" });
      }

      const { title, description } = req.body;
      
      // Convert file to Base64 for storage
      const fileData = req.file.buffer.toString('base64');
      
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
  });

  app.put('/api/admin/company-policies/:id', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const policyId = parseInt(req.params.id);
      const { title, description } = req.body;
      
      const updateData: any = { title, description };
      
      if (req.file) {
        const fileData = req.file.buffer.toString('base64');
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
  });

  app.delete('/api/admin/company-policies/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const policyId = parseInt(req.params.id);
      await storage.deleteCompanyPolicy(policyId);
      res.json({ message: "Company policy deleted successfully" });
    } catch (error) {
      console.error("Error deleting company policy:", error);
      res.status(500).json({ message: "Failed to delete company policy" });
    }
  });

  app.post('/api/admin/company-policies/:id/toggle', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const policyId = parseInt(req.params.id);
      const policy = await storage.toggleCompanyPolicyStatus(policyId);
      res.json(policy);
    } catch (error) {
      console.error("Error toggling company policy status:", error);
      res.status(500).json({ message: "Failed to toggle company policy status" });
    }
  });

  app.get('/api/company-policies/:id/download', isAuthenticated, async (req, res) => {
    try {
      const policyId = parseInt(req.params.id);
      const policy = await storage.getCompanyPolicyById(policyId);
      
      if (!policy) {
        return res.status(404).json({ message: "Company policy not found" });
      }
      
      // Check if fileData exists (new format) or fall back to content (old format)
      const fileBuffer = policy.fileData 
        ? Buffer.from(policy.fileData, 'base64')
        : Buffer.from(policy.content || '', 'utf-8');
      
      res.setHeader('Content-Type', policy.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${policy.fileName}"`);
      res.send(fileBuffer);
    } catch (error) {
      console.error("Error downloading company policy:", error);
      res.status(500).json({ message: "Failed to download company policy" });
    }
  });

  // User Guide routes
  // Get all user guide categories
  app.get('/api/guide-categories', isAuthenticated, async (req, res) => {
    try {
      const categories = await storage.getUserGuideCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching guide categories:", error);
      res.status(500).json({ message: "Failed to fetch guide categories" });
    }
  });

  // Create user guide category (admin only)
  app.post('/api/admin/guide-categories', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const category = await storage.createUserGuideCategory(req.body);
      res.json(category);
    } catch (error) {
      console.error("Error creating guide category:", error);
      res.status(500).json({ message: "Failed to create guide category" });
    }
  });

  // Update user guide category (admin only)
  app.put('/api/admin/guide-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const category = await storage.updateUserGuideCategory(id, req.body);
      res.json(category);
    } catch (error) {
      console.error("Error updating guide category:", error);
      res.status(500).json({ message: "Failed to update guide category" });
    }
  });

  // Delete user guide category (admin only)
  app.delete('/api/admin/guide-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      await storage.deleteUserGuideCategory(id);
      res.json({ message: "Category deleted successfully" });
    } catch (error) {
      console.error("Error deleting guide category:", error);
      res.status(500).json({ message: "Failed to delete guide category" });
    }
  });

  // Get all user guides (filtered by query params)
  app.get('/api/guides', isAuthenticated, async (req, res) => {
    try {
      const { category, type, published } = req.query;
      const guides = await storage.getUserGuides({
        category: category as string,
        type: type as string,
        isPublished: published !== undefined ? published === 'true' : undefined,
      });
      res.json(guides);
    } catch (error) {
      console.error("Error fetching guides:", error);
      res.status(500).json({ message: "Failed to fetch guides" });
    }
  });

  // Get single user guide
  app.get('/api/guides/:id', isAuthenticated, async (req, res) => {
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
  app.post('/api/admin/guides', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.put('/api/admin/guides/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.delete('/api/admin/guides/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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
  app.delete('/api/admin/invitations/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      await storage.cancelUserInvitation(id);
      res.json({ message: "Invitation cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling invitation:", error);
      res.status(500).json({ message: "Failed to cancel invitation" });
    }
  });

  // Resend user invitation (admin only)
  app.post('/api/admin/invitations/:id/resend', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const invitation = await storage.getUserInvitationById(id);
      
      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      if (invitation.status === 'accepted') {
        return res.status(400).json({ message: "Cannot resend accepted invitation" });
      }

      // Send invitation email using the template
      const smtpSettings = await storage.getSmtpSettings();
      const emailTemplate = await storage.getEmailTemplate('user_invitation');
      const companySettings = await storage.getCompanySettings();
      
      if (smtpSettings && emailTemplate && smtpSettings.awsAccessKeyId && smtpSettings.awsSecretAccessKey) {
        const { sendEmailWithTemplate } = await import('./ses');
        const inviteUrl = `${req.protocol}://${req.get('host')}/auth?mode=register&email=${encodeURIComponent(invitation.email)}&token=${invitation.invitationToken}`;
        
        const department = invitation.departmentId ? await storage.getDepartmentById(invitation.departmentId) : null;
        const inviter = await storage.getUser(invitation.invitedBy);
        
        await sendEmailWithTemplate({
          to: invitation.email,
          template: emailTemplate,
          variables: {
            companyName: companySettings?.companyName || 'TicketFlow',
            invitedName: invitation.email.split('@')[0], // Use email prefix as name
            inviterName: inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Admin',
            email: invitation.email,
            role: invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1),
            department: department?.name || 'Not assigned',
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
  });

  // Department routes (admin only)
  app.get('/api/departments', isAuthenticated, async (req, res) => {
    try {
      const departments = await storage.getAllDepartments();
      res.json(departments);
    } catch (error) {
      console.error("Error fetching departments:", error);
      res.status(500).json({ message: "Failed to fetch departments" });
    }
  });

  app.post('/api/admin/departments', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const department = await storage.createDepartment(req.body);
      res.json(department);
    } catch (error) {
      console.error("Error creating department:", error);
      res.status(500).json({ message: "Failed to create department" });
    }
  });

  app.put('/api/admin/departments/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
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

  app.delete('/api/admin/departments/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      await storage.deleteDepartment(id);
      res.json({ message: "Department deleted successfully" });
    } catch (error) {
      console.error("Error deleting department:", error);
      res.status(500).json({ message: "Failed to delete department" });
    }
  });

  // User invitation routes (admin only)
  app.get('/api/admin/invitations', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { status } = req.query;
      const invitations = await storage.getUserInvitations({ status: status as string });
      res.json(invitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });

  app.post('/api/admin/invitations', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const invitation = await storage.createUserInvitation({
        ...req.body,
        expiresAt: new Date(req.body.expiresAt),
        invitedBy: userId,
      });

      // Send invitation email using the template
      const smtpSettings = await storage.getSmtpSettings();
      const emailTemplate = await storage.getEmailTemplate('user_invitation');
      const companySettings = await storage.getCompanySettings();
      
      if (smtpSettings && emailTemplate && smtpSettings.awsAccessKeyId && smtpSettings.awsSecretAccessKey) {
        const { sendEmailWithTemplate } = await import('./ses');
        const inviteUrl = `${req.protocol}://${req.get('host')}/auth?mode=register&email=${encodeURIComponent(invitation.email)}&token=${invitation.invitationToken}`;
        
        const department = invitation.departmentId ? await storage.getDepartmentById(invitation.departmentId) : null;
        
        await sendEmailWithTemplate({
          to: invitation.email,
          template: emailTemplate,
          variables: {
            companyName: companySettings?.companyName || 'TicketFlow',
            invitedName: invitation.email.split('@')[0], // Use email prefix as name
            inviterName: user.firstName ? `${user.firstName} ${user.lastName}` : 'Admin',
            email: invitation.email,
            role: invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1),
            department: department?.name || 'Not assigned',
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
  app.get('/api/invitations/:token', async (req, res) => {
    try {
      const invitation = await storage.getUserInvitationByToken(req.params.token);
      
      if (!invitation) {
        return res.status(404).json({ message: "Invalid invitation token" });
      }

      if (invitation.status === 'accepted') {
        return res.status(400).json({ message: "Invitation has already been accepted" });
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

  app.post('/api/invitations/:token/accept', async (req, res) => {
    try {
      const invitation = await storage.getUserInvitationByToken(req.params.token);
      
      if (!invitation) {
        return res.status(404).json({ message: "Invalid invitation token" });
      }

      if (invitation.status === 'accepted') {
        return res.status(400).json({ message: "Invitation has already been accepted" });
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
  app.get('/api/teams-integration/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.getTeamsIntegrationSettings(userId);
      res.json(settings || { enabled: false });
    } catch (error) {
      console.error("Error fetching Teams settings:", error);
      res.status(500).json({ message: "Failed to fetch Teams settings" });
    }
  });

  app.post('/api/teams-integration/settings', isAuthenticated, async (req: any, res) => {
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
  });

  app.delete('/api/teams-integration/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      await storage.deleteTeamsIntegrationSettings(userId);
      res.json({ message: "Teams integration disabled" });
    } catch (error) {
      console.error("Error disabling Teams integration:", error);
      res.status(500).json({ message: "Failed to disable Teams integration" });
    }
  });

  // Get user's teams and channels
  app.get('/api/teams-integration/teams', isAuthenticated, async (req: any, res) => {
    try {
      if (!req.user.access_token) {
        return res.status(401).json({ message: "Microsoft authentication required" });
      }

      const teams = await teamsIntegration.listTeamsAndChannels(req.user.access_token);
      res.json(teams);
    } catch (error) {
      console.error("Error fetching teams:", error);
      res.status(500).json({ message: "Failed to fetch teams" });
    }
  });

  // Send test notification
  app.post('/api/teams-integration/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.getTeamsIntegrationSettings(userId);
      
      if (!settings || !settings.enabled) {
        return res.status(400).json({ message: "Teams integration not configured" });
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

      const actionUrl = `${req.protocol}://${req.get('host')}/`;
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
  });

  const httpServer = createServer(app);
  return httpServer;
}
