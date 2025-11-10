import {
  departments,
  insertTeamSchema,
  teams,
  teamAdmins,
  teamMembers,
} from "@shared/schema";
import { and, desc, eq, or, not, inArray } from "drizzle-orm";
import type { Express } from "express";
import { isAuthenticated } from "server/auth";
import { db } from "server/db";
import { getUserId } from "server/middleware/admin.middleware";
import {
  canGrantTeamAdmin,
  canManageTeam,
  isTeamAdmin,
} from "server/permissions/teams";
import { storage } from "server/storage";
import { z } from "zod";

export function registerTeamsRoutes(app: Express): void {
  // Team routes
  app.get("/api/teams", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user: any = await storage.getUser(userId);

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
        // Get team IDs where manager is admin
        const adminTeamIds = await db
          .select({ teamId: teamAdmins.teamId })
          .from(teamAdmins)
          .where(eq(teamAdmins.userId, userId));

        // Get team IDs where manager is member
        const memberTeamIds = await db
          .select({ teamId: teamMembers.teamId })
          .from(teamMembers)
          .where(eq(teamMembers.userId, userId));

        // Combine team IDs (remove duplicates)
        const allTeamIds = Array.from(
          new Set([
            ...adminTeamIds.map((t) => t.teamId),
            ...memberTeamIds.map((t) => t.teamId),
          ])
        );

        if (allTeamIds.length === 0) {
          return res.json([]);
        }

        // Get full team data, excluding teams created by the manager
        // Optionally scope to teams in departments managed by the manager
        const managedTeams = await db
          .select({
            id: teams.id,
            name: teams.name,
            description: teams.description,
            departmentId: teams.departmentId,
            createdAt: teams.createdAt,
            createdBy: teams.createdBy,
          })
          .from(teams)
          .where(
            and(inArray(teams.id, allTeamIds), not(eq(teams.createdBy, userId)))
          )
          .orderBy(desc(teams.createdAt));

        // Filter to only teams in departments managed by this manager
        // Since departmentId is now required, all teams will have a department
        const filteredTeams = [];
        for (const team of managedTeams) {
          const [department] = await db
            .select()
            .from(departments)
            .where(
              and(
                eq(departments.id, team.departmentId),
                eq(departments.managerId as any, userId)
              )
            )
            .limit(1);
          if (department) {
            filteredTeams.push(team);
          }
        }

        return res.json(filteredTeams);
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

      // For managers, return teams created by them
      if (user?.role === "manager") {
        const createdTeams = await db
          .select()
          .from(teams)
          .where(eq(teams.createdBy, userId))
          .orderBy(desc(teams.createdAt));
        return res.json(createdTeams);
      }

      // For agents/other roles, return teams where user is a member
      const userTeams = await storage.getUserTeams(userId);
      res.json(userTeams);
    } catch (error) {
      console.error("Error fetching user teams:", error);
      res.status(500).json({ message: "Failed to fetch user teams" });
    }
  });

  app.post("/api/teams", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      // Parse and validate team data (departmentId is now required by schema)
      const teamData = insertTeamSchema.parse({
        ...req.body,
        createdBy: userId,
      });

      // Validate department exists and is active
      const [department] = await db
        .select()
        .from(departments)
        .where(eq(departments.id, teamData.departmentId))
        .limit(1);

      if (!department) {
        return res.status(400).json({ message: "Department not found" });
      }

      if (!department.isActive) {
        return res.status(400).json({ message: "Department is not active" });
      }

      // Permission check: Verify user can assign teams to the selected department
      if (user?.role === "manager") {
        // Managers can only assign to departments they manage
        if (department.managerId !== userId) {
          return res.status(403).json({
            message:
              "You don't have permission to create teams in this department",
          });
        }
      }
      // Admins can assign to any department (no additional check needed)

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

  // Get departments for team creation (role-based filtering)
  // This route must be defined BEFORE /api/teams/:id to avoid route conflicts
  app.get("/api/teams/departments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (user?.role === "admin") {
        // Return all active departments
        const allDepts = await db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(eq(departments.isActive, true))
          .orderBy(departments.name);
        return res.json(allDepts);
      }

      if (user?.role === "manager") {
        // Return only departments managed by this manager
        const managedDepts = await db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(
            and(
              eq(departments.isActive, true),
              eq(departments.managerId as any, userId)
            )
          )
          .orderBy(departments.name);
        return res.json(managedDepts);
      }

      // Agents/customers: return empty array
      return res.json([]);
    } catch (error) {
      console.error("Error fetching departments for team creation:", error);
      res.status(500).json({ message: "Failed to fetch departments" });
    }
  });

  app.get("/api/teams/:id", isAuthenticated, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return res.status(400).json({ message: "Invalid team ID" });
      }
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

      // If taskId is provided, filter out members already assigned to this task
      let filteredMembers = members;
      const taskId = req.query.taskId
        ? parseInt(req.query.taskId as string)
        : null;
      if (taskId && !isNaN(taskId)) {
        const existingAssignments = await storage.getTaskAssignments(
          taskId,
          teamId
        );
        const assignedUserIds = new Set(
          existingAssignments
            .map((assignment) => assignment.assignedUserId)
            .filter((id): id is string => id !== null)
        );

        filteredMembers = members.filter(
          (member) => !assignedUserIds.has(member.userId)
        );
      }

      // Add isAdmin flag to each member (remove role field from response)
      const membersWithAdminFlag = await Promise.all(
        filteredMembers.map(async (member) => {
          const { role, ...memberWithoutRole } = member;
          const isAdmin = await storage.isTeamAdmin(member.userId, teamId);
          return {
            ...memberWithoutRole,
            isAdmin,
          };
        })
      );

      res.json(membersWithAdminFlag);
    } catch (error) {
      console.error("Error fetching team members:", error);
      res.status(500).json({ message: "Failed to fetch team members" });
    }
  });

  // Get team admins
  app.get("/api/teams/:id/admins", isAuthenticated, async (req: any, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return res.status(400).json({ message: "Invalid team ID" });
      }

      const userId = getUserId(req);

      // Check if user can manage the team
      const canManage = await canManageTeam(storage, userId, teamId);
      if (!canManage) {
        return res.status(403).json({
          message: "You don't have permission to view team admins",
        });
      }

      const admins = await storage.getTeamAdmins(teamId);
      res.json(admins);
    } catch (error) {
      console.error("Error fetching team admins:", error);
      res.status(500).json({ message: "Failed to fetch team admins" });
    }
  });

  // Grant team admin status
  app.post("/api/teams/:id/admins", isAuthenticated, async (req: any, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return res.status(400).json({ message: "Invalid team ID" });
      }

      const userId = getUserId(req);
      const { memberId } = req.body;

      if (!memberId) {
        return res.status(400).json({ message: "memberId is required" });
      }

      // Check if user can grant team admin status
      const canGrant = await canGrantTeamAdmin(storage, userId, teamId);
      if (!canGrant) {
        return res.status(403).json({
          message: "You don't have permission to grant team admin status",
        });
      }

      // Validate that the member is actually a team member
      const members = await storage.getTeamMembers(teamId);
      const isMember = members.some((m) => m.userId === memberId);
      if (!isMember) {
        return res.status(400).json({
          message:
            "User must be a team member before being granted admin status",
        });
      }

      // Check if user is already a team admin
      const alreadyAdmin = await storage.isTeamAdmin(memberId, teamId);
      if (alreadyAdmin) {
        return res.status(400).json({
          message: "User is already a team admin",
        });
      }

      const admin = await storage.addTeamAdmin(memberId, teamId, userId);
      res.status(201).json(admin);
    } catch (error) {
      console.error("Error granting team admin status:", error);
      res.status(500).json({
        message: "Failed to grant team admin status",
      });
    }
  });

  // Remove team admin status
  app.delete(
    "/api/teams/:id/admins/:adminId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const teamId = parseInt(req.params.id);
        const adminId = req.params.adminId;

        if (isNaN(teamId) || !adminId) {
          return res
            .status(400)
            .json({ message: "Invalid team ID or admin ID" });
        }

        const userId = getUserId(req);

        // Check if user can manage the team
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return res.status(403).json({
            message: "You don't have permission to remove team admin status",
          });
        }

        // Optional: Prevent removing yourself (safety check)
        if (adminId === userId) {
          return res.status(400).json({
            message: "You cannot remove your own admin status",
          });
        }

        await storage.removeTeamAdmin(adminId, teamId);
        res.json({ message: "Team admin status removed successfully" });
      } catch (error) {
        console.error("Error removing team admin status:", error);
        res.status(500).json({
          message: "Failed to remove team admin status",
        });
      }
    }
  );

  // Get team permissions for current user
  app.get(
    "/api/teams/:id/permissions",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const teamId = parseInt(req.params.id);
        if (isNaN(teamId)) {
          return res.status(400).json({ message: "Invalid team ID" });
        }

        const userId = getUserId(req);
        const team = await storage.getTeam(teamId);

        if (!team) {
          return res.status(404).json({ message: "Team not found" });
        }

        const canManage = await canManageTeam(storage, userId, teamId);
        const isAdmin = await isTeamAdmin(storage, userId, teamId);
        const isCreator = team.createdBy === userId;

        res.json({
          canManageTeam: canManage,
          isTeamAdmin: isAdmin,
          isTeamCreator: isCreator,
        });
      } catch (error) {
        console.error("Error fetching team permissions:", error);
        res.status(500).json({ message: "Failed to fetch team permissions" });
      }
    }
  );

  // Get all tasks assigned to a team
  app.get("/api/teams/:id/tasks", isAuthenticated, async (req: any, res) => {
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

      // Check access: team members, team admins, team creator, managers
      const team = await storage.getTeam(teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }

      // System admins can always access
      if (user.role === "admin") {
        const tasks = await storage.getTeamTasks(teamId);
        return res.json(tasks);
      }

      // Team creator can access
      if (team.createdBy === userId) {
        const tasks = await storage.getTeamTasks(teamId);
        return res.json(tasks);
      }

      // Team admins can access
      const isAdmin = await isTeamAdmin(storage, userId, teamId);
      if (isAdmin) {
        const tasks = await storage.getTeamTasks(teamId);
        return res.json(tasks);
      }

      // Managers can access if team is in their department
      if (user.role === "manager" && team.departmentId) {
        const [department] = await db
          .select()
          .from(departments)
          .where(
            and(
              eq(departments.id, team.departmentId),
              eq(departments.managerId as any, userId)
            )
          )
          .limit(1);
        if (department) {
          const tasks = await storage.getTeamTasks(teamId);
          return res.json(tasks);
        }
      }

      // Team members can access
      const userTeams = await storage.getUserTeams(userId);
      const isMember = userTeams.some((t) => t.id === teamId);
      if (isMember) {
        const tasks = await storage.getTeamTasks(teamId);
        return res.json(tasks);
      }

      return res.status(403).json({
        message: "You don't have permission to view team tasks",
      });
    } catch (error) {
      console.error("Error fetching team tasks:", error);
      res.status(500).json({ message: "Failed to fetch team tasks" });
    }
  });

  // Get all assignments for a team task
  app.get(
    "/api/teams/:id/tasks/:taskId/assignments",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);

        if (isNaN(teamId) || isNaN(taskId)) {
          return res
            .status(400)
            .json({ message: "Invalid team ID or task ID" });
        }

        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Check access: team members, team admins, team creator, managers
        const team = await storage.getTeam(teamId);
        if (!team) {
          return res.status(404).json({ message: "Team not found" });
        }

        // Verify task is assigned to this team
        const task = await storage.getTask(taskId);
        if (!task) {
          return res.status(404).json({ message: "Task not found" });
        }

        if (task.assigneeType !== "team" || task.assigneeTeamId !== teamId) {
          return res.status(400).json({
            message: "Task is not assigned to this team",
          });
        }

        // System admins can always access
        if (user.role === "admin") {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(assignments);
        }

        // Team creator can access
        if (team.createdBy === userId) {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(assignments);
        }

        // Team admins can access
        const isAdmin = await isTeamAdmin(storage, userId, teamId);
        if (isAdmin) {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(assignments);
        }

        // Managers can access if team is in their department
        if (user.role === "manager" && team.departmentId) {
          const [department] = await db
            .select()
            .from(departments)
            .where(
              and(
                eq(departments.id, team.departmentId),
                eq(departments.managerId as any, userId)
              )
            )
            .limit(1);
          if (department) {
            const assignments = await storage.getTaskAssignments(
              taskId,
              teamId
            );
            return res.json(assignments);
          }
        }

        // Team members can access
        const userTeams = await storage.getUserTeams(userId);
        const isMember = userTeams.some((t) => t.id === teamId);
        if (isMember) {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(assignments);
        }

        return res.status(403).json({
          message: "You don't have permission to view task assignments",
        });
      } catch (error) {
        console.error("Error fetching task assignments:", error);
        res.status(500).json({ message: "Failed to fetch task assignments" });
      }
    }
  );

  // Assign team task to a team member
  app.post(
    "/api/teams/:id/tasks/:taskId/assignments",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);

        if (isNaN(teamId) || isNaN(taskId)) {
          return res
            .status(400)
            .json({ message: "Invalid team ID or task ID" });
        }

        const userId = getUserId(req);
        const { userId: assignedUserId, notes, priority } = req.body;

        if (!assignedUserId) {
          return res.status(400).json({ message: "userId is required" });
        }

        // Check if user can manage the team (team admin, team creator, manager, system admin)
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return res.status(403).json({
            message: "You don't have permission to assign team tasks",
          });
        }

        // Verify task is assigned to this team
        const task = await storage.getTask(taskId);
        if (!task) {
          return res.status(404).json({ message: "Task not found" });
        }

        if (task.assigneeType !== "team" || task.assigneeTeamId !== teamId) {
          return res.status(400).json({
            message: "Task is not assigned to this team",
          });
        }

        // Validate that assigned user is a team member
        const members = await storage.getTeamMembers(teamId);
        const isMember = members.some((m) => m.userId === assignedUserId);
        if (!isMember) {
          return res.status(400).json({
            message: "User must be a team member before being assigned a task",
          });
        }

        const assignment = await storage.createTaskAssignment({
          taskId,
          teamId,
          assignedUserId,
          assignedBy: userId,
          notes: notes || null,
          priority: priority || null,
          status: "active",
        });

        res.status(201).json(assignment);
      } catch (error) {
        console.error("Error creating task assignment:", error);
        res.status(500).json({ message: "Failed to create task assignment" });
      }
    }
  );

  // Update task assignment
  app.patch(
    "/api/teams/:id/tasks/:taskId/assignments/:assignmentId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);
        const assignmentId = parseInt(req.params.assignmentId);

        if (isNaN(teamId) || isNaN(taskId) || isNaN(assignmentId)) {
          return res.status(400).json({
            message: "Invalid team ID, task ID, or assignment ID",
          });
        }

        const userId = getUserId(req);
        const { status, notes, priority } = req.body;

        // Check if user can manage the team
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return res.status(403).json({
            message: "You don't have permission to update task assignments",
          });
        }

        const updates: any = {};
        if (status !== undefined) updates.status = status;
        if (notes !== undefined) updates.notes = notes;
        if (priority !== undefined) updates.priority = priority;

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ message: "No updates provided" });
        }

        const updatedAssignment = await storage.updateTaskAssignment(
          assignmentId,
          updates
        );

        res.json(updatedAssignment);
      } catch (error) {
        console.error("Error updating task assignment:", error);
        res.status(500).json({ message: "Failed to update task assignment" });
      }
    }
  );

  // Delete/cancel task assignment
  app.delete(
    "/api/teams/:id/tasks/:taskId/assignments/:assignmentId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);
        const assignmentId = parseInt(req.params.assignmentId);

        if (isNaN(teamId) || isNaN(taskId) || isNaN(assignmentId)) {
          return res.status(400).json({
            message: "Invalid team ID, task ID, or assignment ID",
          });
        }

        const userId = getUserId(req);

        // Check if user can manage the team
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return res.status(403).json({
            message: "You don't have permission to delete task assignments",
          });
        }

        await storage.deleteTaskAssignment(assignmentId);
        res.json({ message: "Task assignment deleted successfully" });
      } catch (error) {
        console.error("Error deleting task assignment:", error);
        res.status(500).json({ message: "Failed to delete task assignment" });
      }
    }
  );

  // Update team member (role functionality removed - use team admins instead)
  app.patch(
    "/api/teams/:teamId/members/:userId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const teamId = parseInt(req.params.teamId);
        if (isNaN(teamId)) {
          return res.status(400).json({ message: "Invalid team ID" });
        }

        const userId = getUserId(req);

        // Check if user can manage the team
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return res.status(403).json({
            message: "You don't have permission to update team members",
          });
        }

        // Role update functionality removed - this endpoint is kept for backward compatibility
        // but no longer updates role. Use team admins endpoints instead.
        const members = await storage.getTeamMembers(teamId);
        const member = members.find((m) => m.userId === req.params.userId);
        if (!member) {
          return res.status(404).json({ message: "Team member not found" });
        }

        res.json(member);
      } catch (error) {
        console.error("Error updating team member:", error);
        res.status(500).json({ message: "Failed to update team member" });
      }
    }
  );

  // Get user's team admin status for all teams
  app.get(
    "/api/user/team-admin-status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const status = await storage.getUserTeamAdminStatus(userId);
        res.json(status);
      } catch (error) {
        console.error("Error fetching user team admin status:", error);
        res.status(500).json({ message: "Failed to fetch team admin status" });
      }
    }
  );
}
