import {
  departments,
  insertTeamSchema,
  teams,
  teamMembers,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { Express, Request } from "express";
import { isAuthenticated } from "server/services/auth";
import { db } from "server/storage/db";
import { getUserId } from "server/middleware/admin.middleware";
import {
  canAdministerDepartment,
  canGrantTeamAdmin,
  canManageTeam,
  isTeamAdmin,
} from "server/permissions/teams";
import { storage } from "server/storage";
import { assertTaskAccess, type AccessUser } from "server/permissions/ticketAccess";
import { HttpError, fail, logRouteError, sendHttpError } from "server/http/errors";
import {
  assertMayViewTeamMembers,
  getTeamFor,
  listMyTeamsFor,
  listTeamsFor,
  presentTeamMembers,
} from "server/services/workspaceReads";
import type { TaskAssignmentBinding } from "server/storage/storage.inteface";
import { projectUserForViewer } from "server/utils/publicUser";
import { z } from "zod";

/** R41: the assignment rows carry two users; project both for the viewer. */
function projectAssignments<
  T extends { assignedUser: Record<string, any> | null; assignedByUser: Record<string, any> }
>(viewer: unknown, rows: T[]) {
  const v = viewer as { id?: string; role?: unknown };
  return rows.map((a) => ({
    ...a,
    assignedUser: a.assignedUser ? projectUserForViewer(v, a.assignedUser) : null,
    assignedByUser: projectUserForViewer(v, a.assignedByUser),
  }));
}

/**
 * Before an assignment is changed through /api/teams/:id/tasks/:taskId/assignments/:assignmentId:
 * 404 unless the assignment belongs to that ticket and that team; then the ticket must be inside
 * the user's scope (404 / 403); then the user must be able to manage the team (403).
 */
async function authorizeAssignmentWrite(
  req: Request,
  binding: TaskAssignmentBinding,
  verb: "update" | "delete"
): Promise<void> {
  const assignment = await storage.getTaskAssignmentById(binding.assignmentId);
  if (
    !assignment ||
    assignment.taskId !== binding.taskId ||
    assignment.teamId !== binding.teamId
  ) {
    throw new HttpError(404, "not_found", "Assignment not found for this ticket and team");
  }
  await assertTaskAccess(req.user as AccessUser, binding.taskId);
  if (!(await canManageTeam(storage, getUserId(req), binding.teamId))) {
    throw new HttpError(403, "forbidden", `You don't have permission to ${verb} task assignments`);
  }
}

export function registerTeamsRoutes(app: Express): void {
  // Team routes
  app.get("/api/teams", isAuthenticated, async (req: any, res) => {
    try {
      // workspaceReads.listTeamsFor, the rule the MCP list_teams tool uses: customers 403, admin
      // every team, manager its managed teams, agents 403 (they use /api/teams/my).
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      return res.json(await listTeamsFor({ id: userId, role: user?.role ?? null }));
    } catch (error) {
      if (error instanceof HttpError) return sendHttpError(res, error);
      logRouteError("Error fetching teams", error);
      fail(res, 500, "Failed to fetch teams");
    }
  });

  // Get user's teams (teams the user is a member of)
  app.get("/api/teams/my", isAuthenticated, async (req: any, res) => {
    try {
      // workspaceReads.listMyTeamsFor (shared with MCP): customers 403, a manager the teams it
      // created, anyone else the teams it is a member of.
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      res.json(await listMyTeamsFor({ id: userId, role: user?.role ?? null }));
    } catch (error) {
      if (error instanceof HttpError) return sendHttpError(res, error);
      logRouteError("Error fetching user teams", error);
      fail(res, 500, "Failed to fetch user teams");
    }
  });

  app.post("/api/teams", isAuthenticated, async (req: any, res, next) => {
    try {
      const userId = getUserId(req);

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
        return fail(res, 400, "Department not found");
      }

      if (!department.isActive) {
        return fail(res, 400, "Department is not active");
      }

      // R12: only an admin, or the manager of this department, may create a team in it.
      if (!(await canAdministerDepartment(storage, userId, department.id))) {
        throw new HttpError(
          403,
          "forbidden",
          "You don't have permission to create teams in this department"
        );
      }

      // R61: the team and the creator's member row (role "admin") land together or not at all.
      const team = await db.transaction(async (tx) => {
        const [created] = await tx.insert(teams).values(teamData).returning();
        await tx.insert(teamMembers).values({
          teamId: created.id,
          userId,
          role: "admin",
        });
        return created;
      });
      res.status(201).json(team);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return fail(res, 400, "Invalid team data", { details: error.flatten() });
      }
      if (error instanceof HttpError) return next(error);
      logRouteError("Error creating team", error);
      fail(res, 500, "Failed to create team");
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
      logRouteError("Error fetching departments for team creation", error);
      fail(res, 500, "Failed to fetch departments");
    }
  });

  app.get("/api/teams/:id", isAuthenticated, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
      }
      // Customers have no use for team records (the members route refuses them too).
      const viewer = await storage.getUser(getUserId(req));
      if (!viewer) {
        return fail(res, 404, "User not found", { code: "user_not_found" });
      }
      // workspaceReads.getTeamFor (shared with MCP get_team): customers 403, unknown 404.
      res.json(await getTeamFor(viewer, teamId));
    } catch (error) {
      if (error instanceof HttpError) return sendHttpError(res, error);
      logRouteError("Error fetching team", error);
      fail(res, 500, "Failed to fetch team");
    }
  });

  // Get team members
  app.get("/api/teams/:id/members", isAuthenticated, async (req: any, res, next) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 404, "User not found", { code: "user_not_found" });
      }

      // workspaceReads.assertMayViewTeamMembers (shared with MCP get_team): customers 403, an
      // agent only for its own teams, a manager only for teams in its departments.
      await assertMayViewTeamMembers(user, teamId);
      const members = await storage.getTeamMembers(teamId);

      // If taskId is provided, filter out members already assigned to this task
      let filteredMembers = members;
      const taskId = req.query.taskId
        ? parseInt(req.query.taskId as string)
        : null;
      if (taskId && !isNaN(taskId)) {
        // Who is assigned to a ticket is ticket data: same rule as GET /api/tasks/:id.
        await assertTaskAccess(req.user, taskId);
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

      // isAdmin flag, no member role, the user projected for the viewer (shared with MCP get_team).
      res.json(await presentTeamMembers(user, teamId, filteredMembers));
    } catch (error) {
      if (error instanceof HttpError) return next(error);
      logRouteError("Error fetching team members", error);
      fail(res, 500, "Failed to fetch team members");
    }
  });

  // Get team admins
  app.get("/api/teams/:id/admins", isAuthenticated, async (req: any, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
      }

      const userId = getUserId(req);

      // Check if user can manage the team
      const canManage = await canManageTeam(storage, userId, teamId);
      if (!canManage) {
        return fail(res, 403, "You don't have permission to view team admins");
      }

      const admins = await storage.getTeamAdmins(teamId);
      const viewer = req.user;
      res.json(
        admins.map((a) => ({
          ...a,
          user: projectUserForViewer(viewer, a.user),
          // grantedByUser is `{}` when the granting account is gone.
          grantedByUser: projectUserForViewer(viewer, a.grantedByUser),
        }))
      );
    } catch (error) {
      logRouteError("Error fetching team admins", error);
      fail(res, 500, "Failed to fetch team admins");
    }
  });

  // Grant team admin status
  app.post("/api/teams/:id/admins", isAuthenticated, async (req: any, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
      }

      const userId = getUserId(req);
      const { memberId } = req.body;

      if (!memberId) {
        return fail(res, 400, "memberId is required");
      }

      // Check if user can grant team admin status
      const canGrant = await canGrantTeamAdmin(storage, userId, teamId);
      if (!canGrant) {
        return fail(res, 403, "You don't have permission to grant team admin status");
      }

      // Validate that the member is actually a team member
      const members = await storage.getTeamMembers(teamId);
      const isMember = members.some((m) => m.userId === memberId);
      if (!isMember) {
        return fail(res, 400, "User must be a team member before being granted admin status");
      }

      // Check if user is already a team admin
      const alreadyAdmin = await storage.isTeamAdmin(memberId, teamId);
      if (alreadyAdmin) {
        return fail(res, 400, "User is already a team admin");
      }

      const admin = await storage.addTeamAdmin(memberId, teamId, userId);
      res.status(201).json(admin);
    } catch (error) {
      logRouteError("Error granting team admin status", error);
      fail(res, 500, "Failed to grant team admin status");
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
          return fail(res, 400, "Invalid team ID or admin ID", { code: "invalid_id" });
        }

        const userId = getUserId(req);

        // Check if user can manage the team
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return fail(res, 403, "You don't have permission to remove team admin status");
        }

        // Optional: Prevent removing yourself (safety check)
        if (adminId === userId) {
          return fail(res, 400, "You cannot remove your own admin status");
        }

        await storage.removeTeamAdmin(adminId, teamId);
        res.json({ message: "Team admin status removed successfully" });
      } catch (error) {
        logRouteError("Error removing team admin status", error);
        fail(res, 500, "Failed to remove team admin status");
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
          return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
        }

        const userId = getUserId(req);
        const team = await storage.getTeam(teamId);

        if (!team) {
          return fail(res, 404, "Team not found");
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
        logRouteError("Error fetching team permissions", error);
        fail(res, 500, "Failed to fetch team permissions");
      }
    }
  );

  // Get all tasks assigned to a team
  app.get("/api/teams/:id/tasks", isAuthenticated, async (req: any, res) => {
    try {
      const teamId = parseInt(req.params.id);
      if (isNaN(teamId)) {
        return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return fail(res, 404, "User not found", { code: "user_not_found" });
      }

      // Check access: team members, team admins, team creator, managers.
      // Whoever passes still sees only the queue's tickets the ticket rule
      // lets them see (getTeamTasks intersects with ticketVisibilityWhere).
      const viewer = { id: userId, role: req.user?.role };
      const team = await storage.getTeam(teamId);
      if (!team) {
        return fail(res, 404, "Team not found");
      }

      // System admins can always access
      if (user.role === "admin") {
        const tasks = await storage.getTeamTasks(teamId, viewer);
        return res.json(tasks);
      }

      // Team creator can access
      if (team.createdBy === userId) {
        const tasks = await storage.getTeamTasks(teamId, viewer);
        return res.json(tasks);
      }

      // Team admins can access
      const isAdmin = await isTeamAdmin(storage, userId, teamId);
      if (isAdmin) {
        const tasks = await storage.getTeamTasks(teamId, viewer);
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
          const tasks = await storage.getTeamTasks(teamId, viewer);
          return res.json(tasks);
        }
      }

      // Team members can access
      const userTeams = await storage.getUserTeams(userId);
      const isMember = userTeams.some((t) => t.id === teamId);
      if (isMember) {
        const tasks = await storage.getTeamTasks(teamId, viewer);
        return res.json(tasks);
      }

      return fail(res, 403, "You don't have permission to view team tasks");
    } catch (error) {
      logRouteError("Error fetching team tasks", error);
      fail(res, 500, "Failed to fetch team tasks");
    }
  });

  // Get all assignments for a team task
  app.get(
    "/api/teams/:id/tasks/:taskId/assignments",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);

        if (isNaN(teamId) || isNaN(taskId)) {
          return fail(res, 400, "Invalid team ID or task ID", { code: "invalid_id" });
        }

        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user) {
          return fail(res, 404, "User not found", { code: "user_not_found" });
        }

        // Check access: team members, team admins, team creator, managers
        const team = await storage.getTeam(teamId);
        if (!team) {
          return fail(res, 404, "Team not found");
        }

        // The ticket itself must be inside the user's scope (404 / 403),
        // whatever team-level rights they hold.
        await assertTaskAccess(req.user, taskId);

        // Verify task is assigned to this team
        const task = await storage.getTask(taskId);
        if (!task) {
          return res.status(404).json({ error: "not_found", message: "Ticket not found" });
        }

        if (task.assigneeType !== "team" || task.assigneeTeamId !== teamId) {
          return fail(res, 400, "Task is not assigned to this team");
        }

        // System admins can always access
        if (user.role === "admin") {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(projectAssignments(req.user, assignments));
        }

        // Team creator can access
        if (team.createdBy === userId) {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(projectAssignments(req.user, assignments));
        }

        // Team admins can access
        const isAdmin = await isTeamAdmin(storage, userId, teamId);
        if (isAdmin) {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(projectAssignments(req.user, assignments));
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
            return res.json(projectAssignments(req.user, assignments));
          }
        }

        // Team members can access
        const userTeams = await storage.getUserTeams(userId);
        const isMember = userTeams.some((t) => t.id === teamId);
        if (isMember) {
          const assignments = await storage.getTaskAssignments(taskId, teamId);
          return res.json(projectAssignments(req.user, assignments));
        }

        return fail(res, 403, "You don't have permission to view task assignments");
      } catch (error) {
        if (error instanceof HttpError) return next(error);
        logRouteError("Error fetching task assignments", error);
        fail(res, 500, "Failed to fetch task assignments");
      }
    }
  );

  // Assign team task to a team member
  app.post(
    "/api/teams/:id/tasks/:taskId/assignments",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);

        if (isNaN(teamId) || isNaN(taskId)) {
          return fail(res, 400, "Invalid team ID or task ID", { code: "invalid_id" });
        }

        const userId = getUserId(req);
        const { userId: assignedUserId, notes, priority } = req.body;

        if (!assignedUserId) {
          return fail(res, 400, "userId is required");
        }

        // The ticket must be inside the user's scope (404 / 403) ...
        await assertTaskAccess(req.user, taskId);

        // ... and the user must be able to manage the team (team admin, team creator, manager, system admin)
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return res.status(403).json({
            error: "forbidden",
            message: "You don't have permission to assign team tasks",
          });
        }

        // Verify task is assigned to this team
        const task = await storage.getTask(taskId);
        if (!task) {
          return res.status(404).json({ error: "not_found", message: "Ticket not found" });
        }

        if (task.assigneeType !== "team" || task.assigneeTeamId !== teamId) {
          return fail(res, 400, "Task is not assigned to this team");
        }

        // Validate that assigned user is a team member
        const members = await storage.getTeamMembers(teamId);
        const isMember = members.some((m) => m.userId === assignedUserId);
        if (!isMember) {
          return fail(res, 400, "User must be a team member before being assigned a task");
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
        if (error instanceof HttpError) return next(error);
        logRouteError("Error creating task assignment", error);
        fail(res, 500, "Failed to create task assignment");
      }
    }
  );

  // Update task assignment
  app.patch(
    "/api/teams/:id/tasks/:taskId/assignments/:assignmentId",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);
        const assignmentId = parseInt(req.params.assignmentId);

        if (isNaN(teamId) || isNaN(taskId) || isNaN(assignmentId)) {
          return fail(res, 400, "Invalid team ID, task ID, or assignment ID", {
            code: "invalid_id",
          });
        }

        const { status, notes, priority } = req.body;
        const binding = { assignmentId, taskId, teamId };
        await authorizeAssignmentWrite(req, binding, "update");

        const updates: any = {};
        if (status !== undefined) updates.status = status;
        if (notes !== undefined) updates.notes = notes;
        if (priority !== undefined) updates.priority = priority;

        if (Object.keys(updates).length === 0) {
          return fail(res, 400, "No updates provided");
        }

        // The WHERE also binds task and team, so the write cannot reach another row.
        const updatedAssignment = await storage.updateTaskAssignment(binding, updates);
        if (!updatedAssignment) {
          return res.status(404).json({ error: "not_found", message: "Assignment not found" });
        }

        res.json(updatedAssignment);
      } catch (error) {
        if (error instanceof HttpError) return next(error);
        logRouteError("Error updating task assignment", error);
        fail(res, 500, "Failed to update task assignment");
      }
    }
  );

  // Delete/cancel task assignment
  app.delete(
    "/api/teams/:id/tasks/:taskId/assignments/:assignmentId",
    isAuthenticated,
    async (req: any, res, next) => {
      try {
        const teamId = parseInt(req.params.id);
        const taskId = parseInt(req.params.taskId);
        const assignmentId = parseInt(req.params.assignmentId);

        if (isNaN(teamId) || isNaN(taskId) || isNaN(assignmentId)) {
          return fail(res, 400, "Invalid team ID, task ID, or assignment ID", {
            code: "invalid_id",
          });
        }

        const binding = { assignmentId, taskId, teamId };
        await authorizeAssignmentWrite(req, binding, "delete");

        // The WHERE also binds task and team, so the delete cannot reach another row.
        if (!(await storage.deleteTaskAssignment(binding))) {
          return res.status(404).json({ error: "not_found", message: "Assignment not found" });
        }
        res.json({ message: "Task assignment deleted successfully" });
      } catch (error) {
        if (error instanceof HttpError) return next(error);
        logRouteError("Error deleting task assignment", error);
        fail(res, 500, "Failed to delete task assignment");
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
          return fail(res, 400, "Invalid team ID", { code: "invalid_id" });
        }

        const userId = getUserId(req);

        // Check if user can manage the team
        const canManage = await canManageTeam(storage, userId, teamId);
        if (!canManage) {
          return fail(res, 403, "You don't have permission to update team members");
        }

        // Role update functionality removed - this endpoint is kept for backward compatibility
        // but no longer updates role. Use team admins endpoints instead.
        const members = await storage.getTeamMembers(teamId);
        const member = members.find((m) => m.userId === req.params.userId);
        if (!member) {
          return fail(res, 404, "Team member not found");
        }

        res.json({ ...member, user: projectUserForViewer(req.user, member.user) });
      } catch (error) {
        logRouteError("Error updating team member", error);
        fail(res, 500, "Failed to update team member");
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
        logRouteError("Error fetching user team admin status", error);
        fail(res, 500, "Failed to fetch team admin status");
      }
    }
  );
}
