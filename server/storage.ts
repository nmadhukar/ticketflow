import {
  users,
  tasks,
  teams,
  teamMembers,
  taskComments,
  taskHistory,
  type User,
  type UpsertUser,
  type Task,
  type InsertTask,
  type Team,
  type InsertTeam,
  type TaskComment,
  type InsertTaskComment,
  type TeamMember,
  type InsertTeamMember,
  type TaskHistory,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, like, count, sql, isNotNull } from "drizzle-orm";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getTask(id: number): Promise<Task | undefined>;
  getTasks(filters?: {
    status?: string;
    category?: string;
    assigneeId?: string;
    createdBy?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<Task[]>;
  updateTask(id: number, updates: Partial<InsertTask>, userId: string): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  
  // Team operations
  createTeam(team: InsertTeam): Promise<Team>;
  getTeam(id: number): Promise<Team | undefined>;
  getTeams(): Promise<Team[]>;
  getUserTeams(userId: string): Promise<Team[]>;
  addTeamMember(teamMember: InsertTeamMember): Promise<TeamMember>;
  removeTeamMember(teamId: number, userId: string): Promise<void>;
  getTeamMembers(teamId: number): Promise<(TeamMember & { user: User })[]>;
  
  // Comment operations
  addTaskComment(comment: InsertTaskComment): Promise<TaskComment>;
  getTaskComments(taskId: number): Promise<(TaskComment & { userName?: string })[]>;
  
  // Statistics
  getTaskStats(userId?: string): Promise<{
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
    highPriority: number;
  }>;
  
  // Activity
  getRecentActivity(limit?: number): Promise<TaskHistory[]>;
  
  // Admin operations
  getAdminStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalTeams: number;
    openTickets: number;
    urgentTickets: number;
    avgResolutionTime: number | null;
  }>;
  updateUserProfile(userId: string, updates: {
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: string;
    department?: string;
    phone?: string;
    isActive?: boolean;
  }): Promise<User>;
  toggleUserStatus(userId: string): Promise<User>;
  assignUserToTeam(userId: string, teamId: number, role?: string): Promise<TeamMember>;
  removeUserFromTeam(userId: string, teamId: number): Promise<void>;
  updateTeamMemberRole(userId: string, teamId: number, role: string): Promise<TeamMember>;
  getDepartments(): Promise<string[]>;
  resetUserPassword(userId: string): Promise<{ tempPassword: string }>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  // Task operations
  async createTask(task: InsertTask): Promise<Task> {
    // Convert string date to Date object if needed
    const taskData = {
      ...task,
      dueDate: task.dueDate ? new Date(task.dueDate) : null,
    };
    const [createdTask] = await db.insert(tasks).values(taskData).returning();
    
    // Add history entry
    await db.insert(taskHistory).values({
      taskId: createdTask.id,
      userId: task.createdBy,
      action: "created",
      newValue: createdTask.title,
    });
    
    return createdTask;
  }

  async getTask(id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  }

  async getTasks(filters: {
    status?: string;
    category?: string;
    assigneeId?: string;
    createdBy?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Task[]> {
    const conditions = [];
    
    if (filters.status) {
      conditions.push(eq(tasks.status, filters.status));
    }
    
    if (filters.category) {
      conditions.push(eq(tasks.category, filters.category));
    }
    
    if (filters.assigneeId) {
      conditions.push(eq(tasks.assigneeId, filters.assigneeId));
    }
    
    if (filters.createdBy) {
      conditions.push(eq(tasks.createdBy, filters.createdBy));
    }
    
    if (filters.search) {
      conditions.push(
        or(
          like(tasks.title, `%${filters.search}%`),
          like(tasks.description, `%${filters.search}%`)
        )
      );
    }
    
    let query = db.select().from(tasks);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    query = query.orderBy(desc(tasks.createdAt));
    
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    
    if (filters.offset) {
      query = query.offset(filters.offset);
    }
    
    return await query;
  }

  async updateTask(id: number, updates: Partial<InsertTask>, userId: string): Promise<Task> {
    const currentTask = await this.getTask(id);
    if (!currentTask) {
      throw new Error("Task not found");
    }
    
    // Convert date if needed
    const updateData = {
      ...updates,
      dueDate: updates.dueDate ? new Date(updates.dueDate) : undefined,
      updatedAt: new Date(),
    };
    
    const [updatedTask] = await db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, id))
      .returning();
    
    // Add history entries for changes
    for (const [field, newValue] of Object.entries(updates)) {
      if (newValue !== undefined && newValue !== (currentTask as any)[field]) {
        await db.insert(taskHistory).values({
          taskId: id,
          userId,
          action: "updated",
          field,
          oldValue: String((currentTask as any)[field] || ""),
          newValue: String(newValue),
        });
      }
    }
    
    return updatedTask;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  // Team operations
  async createTeam(team: InsertTeam): Promise<Team> {
    const [createdTeam] = await db.insert(teams).values(team).returning();
    
    // Add creator as admin
    if (team.createdBy) {
      await db.insert(teamMembers).values({
        teamId: createdTeam.id,
        userId: team.createdBy,
        role: "admin",
      });
    }
    
    return createdTeam;
  }

  async getTeam(id: number): Promise<Team | undefined> {
    const [team] = await db.select().from(teams).where(eq(teams.id, id));
    return team;
  }

  async getTeams(): Promise<(Team & { memberCount: number })[]> {
    const teamsWithMembers = await db
      .select({
        id: teams.id,
        name: teams.name,
        description: teams.description,
        createdAt: teams.createdAt,
        createdBy: teams.createdBy,
        memberCount: count(teamMembers.id),
      })
      .from(teams)
      .leftJoin(teamMembers, eq(teams.id, teamMembers.teamId))
      .groupBy(teams.id, teams.name, teams.description, teams.createdAt, teams.createdBy)
      .orderBy(desc(teams.createdAt));
    
    return teamsWithMembers;
  }

  async getUserTeams(userId: string): Promise<Team[]> {
    const userTeams = await db
      .select({ team: teams })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, userId));
    
    return userTeams.map(row => row.team);
  }

  async addTeamMember(teamMember: InsertTeamMember): Promise<TeamMember> {
    const [member] = await db.insert(teamMembers).values(teamMember).returning();
    return member;
  }

  async removeTeamMember(teamId: number, userId: string): Promise<void> {
    await db.delete(teamMembers).where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))
    );
  }

  async getTeamMembers(teamId: number): Promise<(TeamMember & { user: User })[]> {
    const members = await db
      .select({
        id: teamMembers.id,
        teamId: teamMembers.teamId,
        userId: teamMembers.userId,
        role: teamMembers.role,
        joinedAt: teamMembers.joinedAt,
        user: users,
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId));
    
    return members;
  }

  // Comment operations
  async addTaskComment(comment: InsertTaskComment): Promise<TaskComment> {
    const [createdComment] = await db.insert(taskComments).values(comment).returning();
    
    // Add history entry
    await db.insert(taskHistory).values({
      taskId: comment.taskId,
      userId: comment.userId,
      action: "commented",
      newValue: "Added a comment",
    });
    
    return createdComment;
  }

  async getTaskComments(taskId: number): Promise<(TaskComment & { userName?: string })[]> {
    const comments = await db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        userId: taskComments.userId,
        content: taskComments.content,
        createdAt: taskComments.createdAt,
        userName: users.firstName,
        userEmail: users.email,
      })
      .from(taskComments)
      .leftJoin(users, eq(taskComments.userId, users.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(desc(taskComments.createdAt));

    return comments.map(comment => ({
      id: comment.id,
      taskId: comment.taskId,
      userId: comment.userId,
      content: comment.content,
      createdAt: comment.createdAt,
      userName: comment.userName || comment.userEmail || comment.userId,
    }));
  }

  // Admin operations
  async getAdminStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalTeams: number;
    openTickets: number;
    urgentTickets: number;
    avgResolutionTime: number | null;
  }> {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [activeUserCount] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.isActive, true));
    
    const [teamCount] = await db.select({ count: count() }).from(teams);
    
    const [openTicketCount] = await db
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.status, "open"));
    
    const [urgentTicketCount] = await db
      .select({ count: count() })
      .from(tasks)
      .where(and(
        eq(tasks.status, "open"),
        eq(tasks.priority, "high")
      ));

    // Calculate average resolution time (in hours)
    const resolvedTasks = await db
      .select({
        resolutionTime: sql<number>`EXTRACT(EPOCH FROM (${tasks.resolvedAt} - ${tasks.createdAt})) / 3600`
      })
      .from(tasks)
      .where(and(
        isNotNull(tasks.resolvedAt),
        sql`${tasks.resolvedAt} IS NOT NULL`
      ));

    const avgResolutionTime = resolvedTasks.length > 0
      ? resolvedTasks.reduce((acc, task) => acc + task.resolutionTime, 0) / resolvedTasks.length
      : null;

    return {
      totalUsers: userCount.count,
      activeUsers: activeUserCount.count,
      totalTeams: teamCount.count,
      openTickets: openTicketCount.count,
      urgentTickets: urgentTicketCount.count,
      avgResolutionTime: avgResolutionTime ? Math.round(avgResolutionTime) : null,
    };
  }

  async updateUserProfile(userId: string, updates: {
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: string;
    department?: string;
    phone?: string;
    isActive?: boolean;
  }): Promise<User> {
    // Filter out undefined values and convert boolean properly
    const cleanUpdates: any = {};
    
    if (updates.firstName !== undefined) cleanUpdates.firstName = updates.firstName;
    if (updates.lastName !== undefined) cleanUpdates.lastName = updates.lastName;
    if (updates.email !== undefined) cleanUpdates.email = updates.email;
    if (updates.role !== undefined) cleanUpdates.role = updates.role;
    if (updates.department !== undefined) cleanUpdates.department = updates.department;
    if (updates.phone !== undefined) cleanUpdates.phone = updates.phone;
    if (updates.isActive !== undefined) cleanUpdates.isActive = updates.isActive;
    
    // Always update the timestamp
    cleanUpdates.updatedAt = new Date();
    
    const [updatedUser] = await db
      .update(users)
      .set(cleanUpdates)
      .where(eq(users.id, userId))
      .returning();
    
    return updatedUser;
  }

  async toggleUserStatus(userId: string): Promise<User> {
    const [currentUser] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId));
    
    const [updatedUser] = await db
      .update(users)
      .set({
        isActive: !currentUser.isActive,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    
    return updatedUser;
  }

  async assignUserToTeam(userId: string, teamId: number, role: string = "member"): Promise<TeamMember> {
    // Check if the user is already a team member
    const existingMember = await db
      .select()
      .from(teamMembers)
      .where(and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, teamId)
      ));
    
    if (existingMember.length > 0) {
      // Update existing member
      const [updatedMember] = await db
        .update(teamMembers)
        .set({ role })
        .where(and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.teamId, teamId)
        ))
        .returning();
      return updatedMember;
    } else {
      // Insert new member
      const [newMember] = await db
        .insert(teamMembers)
        .values({
          teamId,
          userId,
          role,
        })
        .returning();
      return newMember;
    }
  }

  async removeUserFromTeam(userId: string, teamId: number): Promise<void> {
    await db
      .delete(teamMembers)
      .where(and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, teamId)
      ));
  }

  async updateTeamMemberRole(userId: string, teamId: number, role: string): Promise<TeamMember> {
    const [updatedMember] = await db
      .update(teamMembers)
      .set({ role })
      .where(and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, teamId)
      ))
      .returning();
    
    if (!updatedMember) {
      throw new Error("Team member not found");
    }
    
    return updatedMember;
  }

  async getDepartments(): Promise<string[]> {
    const departments = await db
      .selectDistinct({ department: users.department })
      .from(users)
      .where(isNotNull(users.department));
    
    const validDepartments = departments
      .map(d => d.department)
      .filter((dept): dept is string => dept !== null && dept !== undefined)
      .sort();
    
    // If no departments exist, return some common ones
    if (validDepartments.length === 0) {
      return [
        "Engineering", 
        "Product", 
        "Sales", 
        "Marketing", 
        "Support", 
        "HR", 
        "Finance"
      ];
    }
    
    return validDepartments;
  }

  // Statistics
  async getTaskStats(userId?: string): Promise<{
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
    highPriority: number;
  }> {
    let baseQuery = db.select({ count: count() }).from(tasks);
    
    if (userId) {
      baseQuery = baseQuery.where(
        or(eq(tasks.assigneeId, userId), eq(tasks.createdBy, userId))
      ) as any;
    }
    
    const [totalResult] = await baseQuery;
    const total = totalResult.count;
    
    let statusQuery = db
      .select({
        status: tasks.status,
        count: count(),
      })
      .from(tasks)
      .groupBy(tasks.status);
    
    if (userId) {
      statusQuery = statusQuery.where(
        or(eq(tasks.assigneeId, userId), eq(tasks.createdBy, userId))
      ) as any;
    }
    
    const statuses = await statusQuery;
    
    let highPriorityQuery = db
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.priority, "high"));
    
    if (userId) {
      highPriorityQuery = highPriorityQuery.where(
        or(eq(tasks.assigneeId, userId), eq(tasks.createdBy, userId))
      ) as any;
    }
    
    const [highPriorityResult] = await highPriorityQuery;
    
    const statusCounts = statuses.reduce((acc, { status, count }) => {
      acc[status] = count;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      total,
      open: statusCounts.open || 0,
      inProgress: statusCounts.in_progress || 0,
      resolved: statusCounts.resolved || 0,
      closed: statusCounts.closed || 0,
      highPriority: highPriorityResult.count,
    };
  }

  // Activity
  async getRecentActivity(limit = 10): Promise<TaskHistory[]> {
    return await db
      .select()
      .from(taskHistory)
      .orderBy(desc(taskHistory.createdAt))
      .limit(limit);
  }

  async resetUserPassword(userId: string): Promise<{ tempPassword: string }> {
    // Generate a temporary password (8 characters)
    const tempPassword = Math.random().toString(36).slice(-8);
    
    // In a real app, you would hash the password and store it
    // For this demo, we'll just return the temp password
    // Note: In production, you'd want to:
    // 1. Hash the password with bcrypt
    // 2. Store it in the database
    // 3. Send it via secure email
    // 4. Force password change on next login
    
    return { tempPassword };
  }
}

export const storage = new DatabaseStorage();
