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
import { eq, desc, and, or, like, count, sql } from "drizzle-orm";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
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
  getTaskComments(taskId: number): Promise<(TaskComment & { user: User })[]>;
  
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

  // Task operations
  async createTask(task: InsertTask): Promise<Task> {
    const [createdTask] = await db.insert(tasks).values(task).returning();
    
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
    let query = db.select().from(tasks);
    
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
    
    let finalQuery = query;
    if (conditions.length > 0) {
      finalQuery = query.where(and(...conditions));
    }
    
    finalQuery = finalQuery.orderBy(desc(tasks.createdAt));
    
    if (filters.limit) {
      finalQuery = finalQuery.limit(filters.limit);
    }
    
    if (filters.offset) {
      finalQuery = finalQuery.offset(filters.offset);
    }
    
    return await finalQuery;
  }

  async updateTask(id: number, updates: Partial<InsertTask>, userId: string): Promise<Task> {
    const currentTask = await this.getTask(id);
    if (!currentTask) {
      throw new Error("Task not found");
    }
    
    const [updatedTask] = await db
      .update(tasks)
      .set({ ...updates, updatedAt: new Date() })
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

  async getTeams(): Promise<Team[]> {
    return await db.select().from(teams).orderBy(desc(teams.createdAt));
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

  async getTaskComments(taskId: number): Promise<(TaskComment & { user: User })[]> {
    const comments = await db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        userId: taskComments.userId,
        content: taskComments.content,
        createdAt: taskComments.createdAt,
        user: users,
      })
      .from(taskComments)
      .innerJoin(users, eq(taskComments.userId, users.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(desc(taskComments.createdAt));
    
    return comments;
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
}

export const storage = new DatabaseStorage();
