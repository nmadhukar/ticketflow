import {
  users,
  tasks,
  teams,
  teamMembers,
  teamAdmins,
  teamTaskAssignments,
  taskComments,
  taskHistory,
  taskAttachments,
  companySettings,
  apiKeys,
  emailProviders,
  emailTemplates,
  helpDocuments,
  aiChatMessages,
  userGuides,
  userGuideCategories,
  departments,
  userInvitations,
  userPreferences,
  teamsIntegrationSettings,
  sessions,
  type User,
  type UpsertUser,
  type InsertUser,
  type Task,
  type InsertTask,
  type Team,
  type InsertTeam,
  type TaskComment,
  type InsertTaskComment,
  type TeamMember,
  type InsertTeamMember,
  type TeamAdmin,
  type InsertTeamAdmin,
  type TaskHistory,
  type TaskAttachment,
  type InsertTaskAttachment,
  type CompanySettings,
  type InsertCompanySettings,
  type ApiKey,
  type InsertApiKey,
  type EmailProvider,
  type InsertEmailProvider,
  type EmailTemplate,
  type InsertEmailTemplate,
  type HelpDocument,
  type InsertHelpDocument,
  type AiChatMessage,
  type InsertAiChatMessage,
  type UserGuide,
  type InsertUserGuide,
  type UserGuideCategory,
  type InsertUserGuideCategory,
  type Department,
  type InsertDepartment,
  type UserInvitation,
  type InsertUserInvitation,
  type UserPreferences,
  type TeamsIntegrationSettings,
  type InsertTeamsIntegrationSettings,
  ssoConfiguration,
  type SsoConfiguration,
  type InsertSsoConfiguration,
  bedrockUsage,
  type BedrockUsage,
  type InsertBedrockUsage,
  faqCache,
  type FaqCache,
  type InsertFaqCache,
  companyPolicies,
  type CompanyPolicy,
  type InsertCompanyPolicy,
  knowledgeArticles,
  type KnowledgeArticle,
  type InsertKnowledgeArticle,
  learningQueue,
  type LearningQueue,
  type InsertLearningQueue,
  notifications,
  type Notification,
  type InsertNotification,
  bedrockSettings,
  type BedrockSettings,
  type InsertBedrockSettings,
  TeamTaskAssignment,
  InsertTeamTaskAssignment,
} from "@shared/schema";
import { db } from "./db";
import {
  eq,
  desc,
  and,
  or,
  like,
  count,
  sql,
  isNotNull,
  inArray,
  ilike,
  gt,
} from "drizzle-orm";
import { IStorage } from "./storage.inteface";

/**
 * Database Storage Layer for TicketFlow
 *
 * This module provides a comprehensive data access layer using Drizzle ORM.
 * Key features:
 * - Type-safe database operations with TypeScript
 * - Transactional support for complex operations
 * - Comprehensive error handling and logging
 * - Support for all major entities: users, tasks, teams, comments, attachments
 * - AI integration data management (auto-responses, knowledge articles)
 * - Admin features (company settings, API keys, email templates)
 * - Security features (audit trails, access control)
 *
 */

export class DatabaseStorage implements IStorage {
  // Company settings cache (in-memory with TTL)
  private companySettingsCache: {
    data: CompanySettings | undefined;
    expiresAt: number;
  } | null = null;

  private readonly COMPANY_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

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

  async createUser(user: InsertUser): Promise<User> {
    const [createdUser] = await db.insert(users).values(user).returning();
    return createdUser;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async setPasswordResetToken(
    userId: string,
    token: string,
    expires: Date
  ): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: token,
        passwordResetExpires: expires,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.passwordResetToken, token),
          sql`${users.passwordResetExpires} > NOW()`
        )
      );
    return user;
  }

  async updateUserPassword(
    userId: string,
    hashedPassword: string
  ): Promise<void> {
    await db
      .update(users)
      .set({
        password: hashedPassword,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async clearPasswordResetToken(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: null,
        passwordResetExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  // User preferences operations
  async getUserPreferences(userId: string): Promise<UserPreferences | null> {
    const preferences = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    return preferences[0] || null;
  }

  async upsertUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    // Get current preferences or defaults
    const existing = await this.getUserPreferences(userId);

    // Default values
    const defaults: UserPreferences = {
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

    const updatedPreferences = {
      ...defaults,
      ...(existing || {}),
      ...preferences,
      userId,
      updatedAt: new Date(),
    };

    const result = await db
      .insert(userPreferences)
      .values(updatedPreferences)
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          theme: updatedPreferences.theme,
          language: updatedPreferences.language,
          timezone: updatedPreferences.timezone,
          dateFormat: updatedPreferences.dateFormat,
          emailNotifications: updatedPreferences.emailNotifications,
          pushNotifications: updatedPreferences.pushNotifications,
          taskUpdates: updatedPreferences.taskUpdates,
          teamUpdates: updatedPreferences.teamUpdates,
          mentions: updatedPreferences.mentions,
          updatedAt: updatedPreferences.updatedAt,
        },
      })
      .returning();

    return result[0];
  }

  // Helper function to generate the next ticket number
  async getNextTicketNumber(): Promise<string> {
    // Get company settings for the prefix
    const settings = await this.getCompanySettings();
    const prefix = settings?.ticketPrefix || "TKT";

    // Get the current year
    const year = new Date().getFullYear();

    // Find the highest ticket number for this year
    const pattern = `${prefix}-${year}-%`;
    const [highestTicket] = await db
      .select({ ticketNumber: tasks.ticketNumber })
      .from(tasks)
      .where(sql`${tasks.ticketNumber} LIKE ${pattern}`)
      .orderBy(desc(tasks.ticketNumber))
      .limit(1);

    let nextNumber = 1;
    if (highestTicket) {
      // Extract the number part from the ticket number
      const parts = highestTicket.ticketNumber.split("-");
      if (parts.length === 3) {
        nextNumber = parseInt(parts[2]) + 1;
      }
    }

    // Format the ticket number with zero padding
    return `${prefix}-${year}-${nextNumber.toString().padStart(4, "0")}`;
  }

  // Task operations
  async createTask(task: InsertTask): Promise<Task> {
    // Generate ticket number
    const ticketNumber = await this.getNextTicketNumber();

    // Convert string date to Date object if needed
    const taskData = {
      ...task,
      ticketNumber,
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

  async getTask(id: number): Promise<any | undefined> {
    const [task] = await db
      .select({
        id: tasks.id,
        ticketNumber: tasks.ticketNumber,
        title: tasks.title,
        description: tasks.description,
        category: tasks.category,
        status: tasks.status,
        priority: tasks.priority,
        severity: tasks.severity,
        assigneeId: tasks.assigneeId,
        assigneeType: tasks.assigneeType,
        assigneeTeamId: tasks.assigneeTeamId,
        createdBy: tasks.createdBy,
        notes: tasks.notes,
        dueDate: tasks.dueDate,
        resolvedAt: tasks.resolvedAt,
        closedAt: tasks.closedAt,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
        tags: tasks.tags,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        creatorName: sql<string>`COALESCE(creator.first_name || ' ' || creator.last_name, creator.email, 'Unknown')`,
        assigneeName: sql<string>`CASE 
          WHEN ${tasks.assigneeType} = 'team' THEN ${teams.name}
          ELSE COALESCE(assignee.first_name || ' ' || assignee.last_name, assignee.email)
        END`,
        // Fields used by frontend detail/list components
        createdByName: sql<string>`COALESCE(creator.first_name || ' ' || creator.last_name, creator.email, 'Unknown')`,
        assignedToName: sql<string>`CASE 
          WHEN ${tasks.assigneeType} = 'team' THEN NULL
          ELSE COALESCE(assignee.first_name || ' ' || assignee.last_name, assignee.email)
        END`,
        teamName: sql<
          string | null
        >`CASE WHEN ${tasks.assigneeType} = 'team' THEN ${teams.name} ELSE NULL END`,
        lastUpdatedBy: sql<string>`(
          SELECT COALESCE(u.first_name || ' ' || u.last_name, u.email)
          FROM ${taskHistory} th
          LEFT JOIN ${users} u ON u.id = th.user_id
          WHERE th.task_id = ${tasks.id}
          ORDER BY th.created_at DESC
          LIMIT 1
        )`,
      })
      .from(tasks)
      .leftJoin(sql`${users} as creator`, sql`creator.id = ${tasks.createdBy}`)
      .leftJoin(
        sql`${users} as assignee`,
        sql`assignee.id = ${tasks.assigneeId} AND ${tasks.assigneeType} = 'user'`
      )
      .leftJoin(teams, eq(teams.id, tasks.assigneeTeamId))
      .where(eq(tasks.id, id));
    return task;
  }

  async getVisibleTasksForUser(options: {
    userId: string;
    role: string;
    status?: string;
    category?: string;
    search?: string;
    teamId?: number;
    departmentId?: number;
    includeOwn?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const {
      userId,
      role,
      status,
      category,
      search,
      teamId,
      departmentId,
      includeOwn = true,
      limit,
      offset,
    } = options;

    const filters: any[] = [];
    if (status) filters.push(eq(tasks.status, status));
    if (category) filters.push(eq(tasks.category, category));
    if (search)
      filters.push(
        or(
          like(tasks.title, `%${search}%`),
          like(tasks.description, `%${search}%`)
        )
      );

    let visibility: any;
    if (role === "admin") {
      visibility = sql`TRUE`;
    } else if (role === "customer") {
      visibility = eq(tasks.createdBy, userId);
    } else if (role === "manager") {
      const own = includeOwn
        ? sql`${tasks.assigneeId} = ${userId}`
        : sql`FALSE`;
      const teamScope = sql`EXISTS (
        SELECT 1 FROM ${teams} t
        JOIN ${departments} d ON d.id = t.department_id
        WHERE t.id = ${tasks.assigneeTeamId}
          AND d.manager_id = ${userId}
          ${teamId ? sql` AND t.id = ${teamId}` : sql``}
          ${departmentId ? sql` AND d.id = ${departmentId}` : sql``}
      )`;
      const teammateScope = sql`EXISTS (
        SELECT 1 FROM ${teamMembers} tm
        JOIN ${teams} t ON t.id = tm.team_id
        JOIN ${departments} d ON d.id = t.department_id
        WHERE tm.user_id = ${tasks.assigneeId}
          AND d.manager_id = ${userId}
          ${teamId ? sql` AND t.id = ${teamId}` : sql``}
          ${departmentId ? sql` AND d.id = ${departmentId}` : sql``}
      )`;
      visibility = or(own, teamScope, teammateScope);
    } else {
      const own = includeOwn
        ? sql`${tasks.assigneeId} = ${userId}`
        : sql`FALSE`;
      const teamScope = sql`EXISTS (
        SELECT 1 FROM ${teamMembers} tm
        WHERE tm.team_id = ${tasks.assigneeTeamId}
          AND tm.user_id = ${userId}
      )`;
      const teammateScope = sql`EXISTS (
        SELECT 1 FROM ${teamMembers} tm1
        WHERE tm1.user_id = ${tasks.assigneeId}
          AND tm1.team_id IN (
            SELECT tm2.team_id FROM ${teamMembers} tm2 WHERE tm2.user_id = ${userId}
          )
      )`;
      visibility = or(own, teamScope, teammateScope);
      if (teamId) {
        visibility = and(
          visibility,
          sql`(
            ${tasks.assigneeTeamId} = ${teamId}
            OR EXISTS (
              SELECT 1 FROM ${teamMembers} tm3 WHERE tm3.user_id = ${tasks.assigneeId} AND tm3.team_id = ${teamId}
            )
          )`
        );
      }
      if (departmentId) {
        visibility = and(
          visibility,
          sql`(
            EXISTS (SELECT 1 FROM ${teams} tt WHERE tt.id = ${tasks.assigneeTeamId} AND tt.department_id = ${departmentId})
            OR EXISTS (
              SELECT 1 FROM ${teamMembers} tm4 JOIN ${teams} t4 ON t4.id = tm4.team_id
              WHERE tm4.user_id = ${tasks.assigneeId} AND t4.department_id = ${departmentId}
            )
          )`
        );
      }
    }

    const whereAll =
      filters.length > 0 ? and(...filters, visibility) : visibility;

    let idQuery: any = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(whereAll)
      .orderBy(desc(tasks.createdAt));
    if (limit) idQuery = (idQuery as any).limit(limit);
    if (offset) idQuery = (idQuery as any).offset(offset);
    const ids = (await idQuery).map((r: { id: number }) => r.id);
    if (ids.length === 0) return [];

    const taskResults = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .orderBy(desc(tasks.createdAt));

    const enhancedTasks: any[] = [];
    for (const task of taskResults) {
      let creatorName = "Unknown";
      let assigneeName = "";
      if ((task as any).createdBy) {
        const [creator] = await db
          .select()
          .from(users)
          .where(eq(users.id, (task as any).createdBy));
        if (creator) {
          creatorName =
            (creator as any).firstName && (creator as any).lastName
              ? `${(creator as any).firstName} ${(creator as any).lastName}`
              : (creator as any).email || "Unknown";
        }
      }
      if (
        (task as any).assigneeType === "team" &&
        (task as any).assigneeTeamId
      ) {
        const [team] = await db
          .select()
          .from(teams)
          .where(eq(teams.id, (task as any).assigneeTeamId));
        if (team) assigneeName = (team as any).name;
      } else if ((task as any).assigneeId) {
        const [assignee] = await db
          .select()
          .from(users)
          .where(eq(users.id, (task as any).assigneeId));
        if (assignee) {
          assigneeName =
            (assignee as any).firstName && (assignee as any).lastName
              ? `${(assignee as any).firstName} ${(assignee as any).lastName}`
              : (assignee as any).email || "";
        }
      }
      const [lastHistory] = await db
        .select({ userId: taskHistory.userId })
        .from(taskHistory)
        .where(eq(taskHistory.taskId, (task as any).id))
        .orderBy(desc(taskHistory.createdAt))
        .limit(1);
      let lastUpdatedBy = "";
      if (lastHistory?.userId) {
        const [u] = await db
          .select()
          .from(users)
          .where(eq(users.id, lastHistory.userId));
        if (u) {
          lastUpdatedBy =
            (u as any).firstName && (u as any).lastName
              ? `${(u as any).firstName} ${(u as any).lastName}`
              : (u as any).email || "";
        }
      }
      enhancedTasks.push({ ...task, creatorName, assigneeName, lastUpdatedBy });
    }
    return enhancedTasks;
  }

  async getTasks(
    filters: {
      status?: string;
      category?: string;
      assigneeId?: string;
      createdBy?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<any[]> {
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
    // Note: team-scoped visibility is handled by a dedicated join-based method
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

    // First get the tasks
    let taskQuery: any = db.select().from(tasks);

    if (conditions.length > 0) {
      taskQuery = (taskQuery as any).where(and(...conditions));
    }

    taskQuery = (taskQuery as any).orderBy(desc(tasks.createdAt));

    if (filters.limit) {
      taskQuery = (taskQuery as any).limit(filters.limit);
    }

    if (filters.offset) {
      taskQuery = (taskQuery as any).offset(filters.offset);
    }

    const taskResults = await taskQuery;

    // Now enhance with creator and assignee names
    const enhancedTasks = [];
    for (const task of taskResults) {
      let creatorName = "Unknown";
      let assigneeName = "";

      // Get creator name
      if (task.createdBy) {
        const [creator] = await db
          .select()
          .from(users)
          .where(eq(users.id, task.createdBy));
        if (creator) {
          creatorName =
            creator.firstName && creator.lastName
              ? `${creator.firstName} ${creator.lastName}`
              : creator.email || "Unknown";
        }
      }

      // Get assignee name (team via assigneeTeamId, user via assigneeId)
      if (task.assigneeType === "team" && (task as any).assigneeTeamId) {
        const [team] = await db
          .select()
          .from(teams)
          .where(eq(teams.id, (task as any).assigneeTeamId));
        if (team) {
          assigneeName = team.name;
        }
      } else if (task.assigneeId) {
        const [assignee] = await db
          .select()
          .from(users)
          .where(eq(users.id, task.assigneeId));
        if (assignee) {
          assigneeName =
            assignee.firstName && assignee.lastName
              ? `${assignee.firstName} ${assignee.lastName}`
              : assignee.email || "";
        }
      }

      // Get last updated by info
      let lastUpdatedBy = null;
      const [lastUpdate] = await db
        .select({
          userName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
        })
        .from(taskHistory)
        .leftJoin(users, eq(taskHistory.userId, users.id))
        .where(eq(taskHistory.taskId, task.id))
        .orderBy(desc(taskHistory.createdAt))
        .limit(1);

      if (lastUpdate) {
        lastUpdatedBy = lastUpdate.userName;
      }

      enhancedTasks.push({
        ...task,
        creatorName,
        assigneeName,
        lastUpdatedBy,
      });
    }

    return enhancedTasks;
  }

  async updateTask(
    id: number,
    updates: Partial<InsertTask>,
    userId: string
  ): Promise<Task> {
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
        departmentId: teams.departmentId,
        createdAt: teams.createdAt,
        createdBy: teams.createdBy,
        memberCount: count(teamMembers.id),
      })
      .from(teams)
      .leftJoin(teamMembers, eq(teams.id, teamMembers.teamId))
      .groupBy(
        teams.id,
        teams.name,
        teams.description,
        teams.departmentId,
        teams.createdAt,
        teams.createdBy
      )
      .orderBy(desc(teams.createdAt));

    return teamsWithMembers;
  }

  async getUserTeams(userId: string): Promise<Team[]> {
    const userTeams = await db
      .select({ team: teams })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, userId));

    return userTeams.map((row) => row.team);
  }

  async addTeamMember(teamMember: InsertTeamMember): Promise<TeamMember> {
    const [member] = await db
      .insert(teamMembers)
      .values(teamMember)
      .returning();
    return member;
  }

  async removeTeamMember(teamId: number, userId: string): Promise<void> {
    await db
      .delete(teamMembers)
      .where(
        and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))
      );
  }

  async getTeamMembers(
    teamId: number
  ): Promise<(TeamMember & { user: User })[]> {
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

  // Team admin operations
  async isTeamAdmin(userId: string, teamId: number): Promise<boolean> {
    const [admin] = await db
      .select()
      .from(teamAdmins)
      .where(and(eq(teamAdmins.userId, userId), eq(teamAdmins.teamId, teamId)))
      .limit(1);

    return !!admin;
  }

  async getTeamAdmins(
    teamId: number
  ): Promise<Array<TeamAdmin & { user: User; grantedByUser: User }>> {
    const adminsWithGrantedBy = await db
      .select({
        id: teamAdmins.id,
        teamId: teamAdmins.teamId,
        userId: teamAdmins.userId,
        grantedBy: teamAdmins.grantedBy,
        grantedAt: teamAdmins.grantedAt,
        permissions: teamAdmins.permissions,
        user: users,
      })
      .from(teamAdmins)
      .innerJoin(users, eq(teamAdmins.userId, users.id))
      .where(eq(teamAdmins.teamId, teamId));

    // Fetch grantedBy users separately
    const result = [];
    for (const admin of adminsWithGrantedBy) {
      const [grantedByUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, admin.grantedBy))
        .limit(1);

      result.push({
        ...admin,
        grantedByUser: grantedByUser || ({} as User),
      });
    }

    return result;
  }

  async addTeamAdmin(
    userId: string,
    teamId: number,
    grantedBy: string
  ): Promise<TeamAdmin> {
    // Check if user is already a team admin
    const existing = await this.isTeamAdmin(userId, teamId);
    if (existing) {
      const [admin] = await db
        .select()
        .from(teamAdmins)
        .where(
          and(eq(teamAdmins.userId, userId), eq(teamAdmins.teamId, teamId))
        )
        .limit(1);
      if (admin) return admin;
    }

    const [newAdmin] = await db
      .insert(teamAdmins)
      .values({
        userId,
        teamId,
        grantedBy,
        grantedAt: new Date(),
      })
      .returning();

    return newAdmin;
  }

  async removeTeamAdmin(userId: string, teamId: number): Promise<void> {
    await db
      .delete(teamAdmins)
      .where(and(eq(teamAdmins.userId, userId), eq(teamAdmins.teamId, teamId)));
  }

  async getUserTeamAdminStatus(
    userId: string
  ): Promise<Record<number, boolean>> {
    const userAdmins = await db
      .select({ teamId: teamAdmins.teamId })
      .from(teamAdmins)
      .where(eq(teamAdmins.userId, userId));

    const status: Record<number, boolean> = {};
    for (const admin of userAdmins) {
      status[admin.teamId] = true;
    }

    return status;
  }

  // Team task assignment operations
  async getTeamTasks(teamId: number): Promise<Task[]> {
    const teamTasks = await db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.assigneeType, "team"), eq(tasks.assigneeTeamId, teamId))
      );

    return teamTasks;
  }

  async getTaskAssignments(
    taskId: number,
    teamId: number
  ): Promise<
    Array<
      TeamTaskAssignment & { assignedUser: User | null; assignedByUser: User }
    >
  > {
    const assignments = await db
      .select({
        id: teamTaskAssignments.id,
        taskId: teamTaskAssignments.taskId,
        teamId: teamTaskAssignments.teamId,
        assignedUserId: teamTaskAssignments.assignedUserId,
        assignedBy: teamTaskAssignments.assignedBy,
        assignedAt: teamTaskAssignments.assignedAt,
        status: teamTaskAssignments.status,
        completedAt: teamTaskAssignments.completedAt,
        notes: teamTaskAssignments.notes,
        priority: teamTaskAssignments.priority,
      })
      .from(teamTaskAssignments)
      .where(
        and(
          eq(teamTaskAssignments.taskId, taskId),
          eq(teamTaskAssignments.teamId, teamId)
        )
      );

    // Fetch assigned users and assigned by users separately
    const result = [];
    for (const assignment of assignments) {
      let assignedUser: User | null = null;
      let assignedByUser: User | null = null;

      if (assignment.assignedUserId) {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, assignment.assignedUserId))
          .limit(1);
        assignedUser = user || null;
      }

      const [byUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, assignment.assignedBy))
        .limit(1);
      assignedByUser = byUser || ({} as User);

      result.push({
        ...assignment,
        assignedUser,
        assignedByUser,
      });
    }

    return result;
  }

  async createTaskAssignment(
    assignment: InsertTeamTaskAssignment
  ): Promise<TeamTaskAssignment> {
    const [newAssignment] = await db
      .insert(teamTaskAssignments)
      .values({
        ...assignment,
        assignedAt: new Date(),
        status: assignment.status || "active",
      })
      .returning();

    return newAssignment;
  }

  async updateTaskAssignment(
    assignmentId: number,
    updates: Partial<InsertTeamTaskAssignment>
  ): Promise<TeamTaskAssignment> {
    const updateData: any = { ...updates };

    // Handle completedAt based on status
    if (updates.status === "completed" && !updates.completedAt) {
      updateData.completedAt = new Date();
    } else if (updates.status !== "completed" && updates.completedAt === null) {
      updateData.completedAt = null;
    }

    const [updatedAssignment] = await db
      .update(teamTaskAssignments)
      .set(updateData)
      .where(eq(teamTaskAssignments.id, assignmentId))
      .returning();

    return updatedAssignment;
  }

  async deleteTaskAssignment(assignmentId: number): Promise<void> {
    await db
      .delete(teamTaskAssignments)
      .where(eq(teamTaskAssignments.id, assignmentId));
  }

  // Comment operations
  async addTaskComment(comment: InsertTaskComment): Promise<TaskComment> {
    const [createdComment] = await db
      .insert(taskComments)
      .values(comment)
      .returning();

    // Add history entry
    await db.insert(taskHistory).values({
      taskId: comment.taskId,
      userId: comment.userId,
      action: "commented",
      newValue: "Added a comment",
    });

    return createdComment;
  }

  async getTaskComments(
    taskId: number
  ): Promise<(TaskComment & { user?: User })[]> {
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
      .leftJoin(users, eq(taskComments.userId, users.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(desc(taskComments.createdAt));

    return comments.map((comment) => ({
      id: comment.id,
      taskId: comment.taskId,
      userId: comment.userId,
      content: comment.content,
      createdAt: comment.createdAt,
      user: comment.user || undefined,
    }));
  }

  // Admin operations
  async getAdminStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalDepartments: number;
    totalTeams: number;
    totalTickets: number;
    openTickets: number;
    urgentTickets: number;
    avgResolutionTime: number | null;
    pendingArticles: number;
  }> {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [activeUserCount] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.isActive, true));

    const [departmentCount] = await db
      .select({ count: count() })
      .from(departments);

    const [teamCount] = await db.select({ count: count() }).from(teams);

    const [totalTicketCount] = await db.select({ count: count() }).from(tasks);

    const [openTicketCount] = await db
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.status, "open"));

    const [urgentTicketCount] = await db
      .select({ count: count() })
      .from(tasks)
      .where(and(eq(tasks.status, "open"), eq(tasks.priority, "urgent")));

    // Calculate average resolution time (in hours)
    const resolvedTasks = await db
      .select({
        resolutionTime: sql<number>`EXTRACT(EPOCH FROM (${tasks.resolvedAt} - ${tasks.createdAt})) / 3600`,
      })
      .from(tasks)
      .where(
        and(isNotNull(tasks.resolvedAt), sql`${tasks.resolvedAt} IS NOT NULL`)
      );

    const avgResolutionTime =
      resolvedTasks.length > 0
        ? resolvedTasks.reduce((acc, task) => acc + task.resolutionTime, 0) /
          resolvedTasks.length
        : null;

    // Count pending articles (draft status or not published)
    const [pendingArticlesCount] = await db
      .select({ count: count() })
      .from(knowledgeArticles)
      .where(
        or(
          eq(knowledgeArticles.status, "draft"),
          eq(knowledgeArticles.isPublished, false)
        )
      );

    return {
      totalUsers: userCount.count,
      activeUsers: activeUserCount.count,
      totalDepartments: departmentCount.count,
      totalTeams: teamCount.count,
      totalTickets: totalTicketCount.count,
      openTickets: openTicketCount.count,
      urgentTickets: urgentTicketCount.count,
      avgResolutionTime: avgResolutionTime
        ? Math.round(avgResolutionTime)
        : null,
      pendingArticles: pendingArticlesCount.count,
    };
  }

  async updateUserProfile(
    userId: string,
    updates: {
      firstName?: string;
      lastName?: string;
      email?: string;
      role?: string;
      phone?: string;
      isActive?: boolean;
    }
  ): Promise<User> {
    // Filter out undefined values and convert boolean properly
    const cleanUpdates: any = {};

    if (updates.firstName !== undefined)
      cleanUpdates.firstName = updates.firstName;
    if (updates.lastName !== undefined)
      cleanUpdates.lastName = updates.lastName;
    if (updates.email !== undefined) cleanUpdates.email = updates.email;
    if (updates.role !== undefined) cleanUpdates.role = updates.role;
    if (updates.phone !== undefined) cleanUpdates.phone = updates.phone;
    if (updates.isActive !== undefined)
      cleanUpdates.isActive = updates.isActive;

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

  async approveUser(userId: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({
        isApproved: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return updatedUser;
  }

  async assignUserToTeam(
    userId: string,
    teamId: number,
    role: string = "member"
  ): Promise<TeamMember> {
    // Check if the user is already a team member
    const existingMember = await db
      .select()
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId))
      );

    if (existingMember.length > 0) {
      // Update existing member
      const [updatedMember] = await db
        .update(teamMembers)
        .set({ role })
        .where(
          and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId))
        )
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
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId))
      );
  }

  async updateTeamMemberRole(
    userId: string,
    teamId: number,
    role: string
  ): Promise<TeamMember> {
    const [updatedMember] = await db
      .update(teamMembers)
      .set({ role })
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId))
      )
      .returning();

    if (!updatedMember) {
      throw new Error("Team member not found");
    }

    return updatedMember;
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

    let highPriorityBase = and(eq(tasks.priority, "high"));
    if (userId) {
      highPriorityBase = and(
        highPriorityBase,
        or(eq(tasks.assigneeId, userId), eq(tasks.createdBy, userId))
      );
    }
    const [highPriorityResult] = await db
      .select({ count: count() })
      .from(tasks)
      .where(highPriorityBase);

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
  async getRecentActivity(limit = 10): Promise<any[]> {
    const history = await db
      .select({
        id: taskHistory.id,
        taskId: taskHistory.taskId,
        userId: taskHistory.userId,
        action: taskHistory.action,
        field: taskHistory.field,
        oldValue: taskHistory.oldValue,
        newValue: taskHistory.newValue,
        createdAt: taskHistory.createdAt,
        taskTitle: tasks.title,
        userName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email}, 'Unknown')`,
      })
      .from(taskHistory)
      .leftJoin(tasks, eq(taskHistory.taskId, tasks.id))
      .leftJoin(users, eq(taskHistory.userId, users.id))
      .orderBy(desc(taskHistory.createdAt))
      .limit(limit);

    return history;
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

  // Session operations
  async getUserSessions(userId: string): Promise<
    Array<{
      sessionId: string;
      createdAt: Date;
      lastActive: Date;
      expiresAt: Date;
      isCurrent: boolean;
      userAgent?: string;
      ipAddress?: string;
    }>
  > {
    // Get all sessions that haven't expired
    const allSessions = await db
      .select({
        sid: sessions.sid,
        sess: sessions.sess,
        expire: sessions.expire,
      })
      .from(sessions)
      .where(gt(sessions.expire, new Date()));

    const userSessions: Array<{
      sessionId: string;
      createdAt: Date;
      lastActive: Date;
      expiresAt: Date;
      isCurrent: boolean;
      userAgent?: string;
      ipAddress?: string;
    }> = [];

    // Parse session data from JSONB
    for (const session of allSessions) {
      try {
        const sessData = session.sess as any;
        let sessionUserId: string | undefined;

        // Check different session structures
        // Local auth: passport.user is the user ID (string) after serialization
        // Microsoft auth: passport.user.claims.sub is the user ID
        // Or passport.user.id for deserialized user object
        if (typeof sessData.passport?.user === "string") {
          // Serialized user ID (local auth)
          sessionUserId = sessData.passport.user;
        } else if (sessData.passport?.user?.id) {
          // Deserialized user object with id property
          sessionUserId = sessData.passport.user.id;
        } else if (sessData.passport?.user?.claims?.sub) {
          // Microsoft auth structure
          sessionUserId = sessData.passport.user.claims.sub;
        }

        // Check if this session belongs to the user
        if (sessionUserId === userId) {
          const cookie = sessData.cookie || {};
          const createdAt = cookie.originalMaxAge
            ? new Date(session.expire.getTime() - cookie.originalMaxAge)
            : session.expire;

          userSessions.push({
            sessionId: session.sid,
            createdAt: createdAt,
            lastActive: sessData.lastActive
              ? new Date(sessData.lastActive)
              : createdAt,
            expiresAt: session.expire,
            isCurrent: false, // Will be set by the API endpoint using current session ID
            userAgent: sessData.userAgent,
            ipAddress: sessData.ipAddress,
          });
        }
      } catch (error) {
        // Skip sessions with invalid data
        console.error("Error parsing session data:", error);
      }
    }

    return userSessions.sort(
      (a, b) => b.lastActive.getTime() - a.lastActive.getTime()
    );
  }

  async revokeSession(sessionId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.sid, sessionId));
  }

  // Attachment operations
  async addTaskAttachment(
    attachment: InsertTaskAttachment
  ): Promise<TaskAttachment> {
    const [newAttachment] = await db
      .insert(taskAttachments)
      .values(attachment)
      .returning();
    return newAttachment;
  }

  async getTaskAttachments(taskId: number): Promise<TaskAttachment[]> {
    return await db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, taskId))
      .orderBy(desc(taskAttachments.createdAt));
  }

  async deleteTaskAttachment(id: number): Promise<void> {
    await db.delete(taskAttachments).where(eq(taskAttachments.id, id));
  }

  // Company settings operations
  async getCompanySettings(): Promise<CompanySettings | undefined> {
    // Check cache first
    const now = Date.now();
    if (
      this.companySettingsCache &&
      this.companySettingsCache.expiresAt > now
    ) {
      return this.companySettingsCache.data;
    }

    // Cache miss or expired - fetch from database
    const [settings] = await db.select().from(companySettings).limit(1);

    // Update cache
    this.companySettingsCache = {
      data: settings,
      expiresAt: now + this.COMPANY_SETTINGS_CACHE_TTL,
    };

    return settings;
  }

  async updateCompanySettings(
    settings: Partial<InsertCompanySettings>,
    userId: string
  ): Promise<CompanySettings> {
    const existingSettings = await this.getCompanySettings();

    let result: CompanySettings;

    if (existingSettings) {
      const [updated] = await db
        .update(companySettings)
        .set({
          ...settings,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(companySettings.id, existingSettings.id))
        .returning();
      result = updated;
    } else {
      const [created] = await db
        .insert(companySettings)
        .values({
          ...settings,
          updatedBy: userId,
        })
        .returning();
      result = created;
    }

    // Invalidate and update cache with new data
    const now = Date.now();
    this.companySettingsCache = {
      data: result,
      expiresAt: now + this.COMPANY_SETTINGS_CACHE_TTL,
    };

    return result;
  }

  // API key operations
  async createApiKey(
    apiKey: InsertApiKey
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    // Generate a secure API key
    const plainKey = `tfk_${Math.random()
      .toString(36)
      .substring(2)}${Date.now().toString(36)}`;
    const keyPrefix = plainKey.substring(0, 8);

    // In production, you'd hash the key before storing
    const keyHash = plainKey; // TODO: Use bcrypt or similar

    const { expiresAt, ...restApiKey } = apiKey as any;
    const [newApiKey] = await db
      .insert(apiKeys)
      .values({
        ...(restApiKey as any),
        expiresAt: expiresAt ? new Date(expiresAt as any) : null,
        keyHash: keyHash,
        keyPrefix: keyPrefix,
      })
      .returning();

    return { apiKey: newApiKey, plainKey };
  }

  async getApiKeys(userId: string): Promise<ApiKey[]> {
    return await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.isActive, true)))
      .orderBy(desc(apiKeys.createdAt));
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    const [apiKey] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));
    return apiKey;
  }

  async updateApiKeyLastUsed(id: number): Promise<void> {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }

  async revokeApiKey(id: number): Promise<void> {
    await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, id));
  }

  async updateApiKey(
    id: number,
    updates: { keyHash?: string; isActive?: boolean }
  ): Promise<void> {
    await db.update(apiKeys).set(updates).where(eq(apiKeys.id, id));
  }

  // Bedrock settings operations
  async getBedrockSettings(): Promise<BedrockSettings | undefined> {
    const [settings] = await db
      .select()
      .from(bedrockSettings)
      .where(eq(bedrockSettings.isActive, true));
    return settings;
  }

  async updateBedrockSettings(
    settings: InsertBedrockSettings,
    userId: string
  ): Promise<BedrockSettings> {
    const existingSettings = await this.getBedrockSettings();

    if (existingSettings) {
      const [updated] = await db
        .update(bedrockSettings)
        .set({
          ...settings,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(bedrockSettings.id, existingSettings.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(bedrockSettings)
        .values({
          ...settings,
          updatedBy: userId,
        })
        .returning();
      return created;
    }
  }

  // Email provider operations
  async getActiveEmailProvider(): Promise<EmailProvider | undefined> {
    const [row] = await db
      .select()
      .from(emailProviders)
      .where(eq(emailProviders.isActive, true))
      .orderBy(desc(emailProviders.updatedAt))
      .limit(1);
    return row as EmailProvider | undefined;
  }

  async upsertEmailProvider(
    provider: InsertEmailProvider,
    userId: string
  ): Promise<EmailProvider> {
    // single active provider policy: deactivate others if this is active
    if (provider.isActive) {
      await db.update(emailProviders).set({ isActive: false });
    }

    const [result] = await db
      .insert(emailProviders)
      .values({ ...provider, updatedBy: userId })
      .returning();
    return result as EmailProvider;
  }

  async setActiveEmailProvider(id: number): Promise<void> {
    await db.update(emailProviders).set({ isActive: false });
    await db
      .update(emailProviders)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(emailProviders.id, id));
  }

  async updateActiveEmailProvider(
    updates: Partial<{ fromEmail: string; fromName: string; metadata: any }>
  ): Promise<EmailProvider> {
    const [active] = await db
      .select()
      .from(emailProviders)
      .where(eq(emailProviders.isActive, true))
      .limit(1);
    if (!active) {
      throw new Error("No active email provider to update");
    }
    const [result] = await db
      .update(emailProviders)
      .set({
        ...(updates.fromEmail !== undefined
          ? { fromEmail: updates.fromEmail }
          : {}),
        ...(updates.fromName !== undefined
          ? { fromName: updates.fromName }
          : {}),
        ...(updates.metadata !== undefined
          ? { metadata: updates.metadata }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(emailProviders.id, (active as any).id))
      .returning();
    return result as EmailProvider;
  }

  // Email template operations
  async getEmailTemplates(): Promise<EmailTemplate[]> {
    return await db.select().from(emailTemplates).orderBy(emailTemplates.name);
  }

  async getEmailTemplate(name: string): Promise<EmailTemplate | undefined> {
    const [template] = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.name, name));
    return template;
  }

  async updateEmailTemplate(
    name: string,
    template: Partial<InsertEmailTemplate>,
    userId: string
  ): Promise<EmailTemplate> {
    const existingTemplate = await this.getEmailTemplate(name);

    if (existingTemplate) {
      const [updated] = await db
        .update(emailTemplates)
        .set({
          ...template,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(emailTemplates.name, name))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(emailTemplates)
        .values({
          name,
          subject: template.subject || "Default Subject",
          body: template.body || "Default Body",
          variables: template.variables || [],
          isActive: template.isActive ?? true,
          updatedBy: userId,
        })
        .returning();
      return created;
    }
  }

  // Help Document operations
  async createHelpDocument(doc: InsertHelpDocument): Promise<HelpDocument> {
    const [created] = await db.insert(helpDocuments).values(doc).returning();
    return created;
  }

  async getHelpDocuments(): Promise<HelpDocument[]> {
    return await db
      .select()
      .from(helpDocuments)
      .orderBy(desc(helpDocuments.createdAt));
  }

  async getHelpDocument(id: number): Promise<HelpDocument | undefined> {
    const [doc] = await db
      .select()
      .from(helpDocuments)
      .where(eq(helpDocuments.id, id));
    return doc;
  }

  async updateHelpDocument(
    id: number,
    doc: Partial<InsertHelpDocument>
  ): Promise<HelpDocument> {
    const [updated] = await db
      .update(helpDocuments)
      .set({
        ...doc,
        updatedAt: new Date(),
      })
      .where(eq(helpDocuments.id, id))
      .returning();
    return updated;
  }

  async deleteHelpDocument(id: number): Promise<void> {
    await db.delete(helpDocuments).where(eq(helpDocuments.id, id));
  }

  async incrementViewCount(id: number): Promise<void> {
    await db
      .update(helpDocuments)
      .set({
        viewCount: sql`${helpDocuments.viewCount} + 1`,
      })
      .where(eq(helpDocuments.id, id));
  }

  async searchHelpDocuments(query: string): Promise<HelpDocument[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    return await db
      .select()
      .from(helpDocuments)
      .where(
        or(
          like(sql`LOWER(${helpDocuments.title})`, searchTerm),
          like(sql`LOWER(${helpDocuments.content})`, searchTerm),
          like(sql`LOWER(${helpDocuments.category})`, searchTerm)
        )
      )
      .orderBy(desc(helpDocuments.viewCount));
  }

  // AI Chat operations
  async createChatMessage(
    message: InsertAiChatMessage
  ): Promise<AiChatMessage> {
    const [created] = await db
      .insert(aiChatMessages)
      .values(message)
      .returning();
    return created;
  }

  async getChatMessages(
    userId: string,
    sessionId: string
  ): Promise<AiChatMessage[]> {
    return await db
      .select()
      .from(aiChatMessages)
      .where(
        and(
          eq(aiChatMessages.userId, userId),
          eq(aiChatMessages.sessionId, sessionId)
        )
      )
      .orderBy(aiChatMessages.createdAt);
  }

  async getChatSessions(
    userId: string
  ): Promise<{ sessionId: string; lastMessage: string; createdAt: Date }[]> {
    const sessions = await db
      .selectDistinct({
        sessionId: aiChatMessages.sessionId,
        content: aiChatMessages.content,
        createdAt: aiChatMessages.createdAt,
      })
      .from(aiChatMessages)
      .where(eq(aiChatMessages.userId, userId))
      .orderBy(desc(aiChatMessages.createdAt));

    // Group by session and get the last message
    const sessionMap = new Map<
      string,
      { sessionId: string; lastMessage: string; createdAt: Date }
    >();

    for (const session of sessions) {
      if (session.createdAt) {
        const existing = sessionMap.get(session.sessionId);
        if (!existing || session.createdAt > existing.createdAt) {
          sessionMap.set(session.sessionId, {
            sessionId: session.sessionId,
            lastMessage:
              session.content.substring(0, 100) +
              (session.content.length > 100 ? "..." : ""),
            createdAt: session.createdAt,
          });
        }
      }
    }

    return Array.from(sessionMap.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  // User Guide operations
  async createUserGuide(guide: InsertUserGuide): Promise<UserGuide> {
    const [created] = await db.insert(userGuides).values(guide).returning();
    return created;
  }

  async updateUserGuide(
    id: number,
    guide: Partial<InsertUserGuide>
  ): Promise<UserGuide> {
    const [updated] = await db
      .update(userGuides)
      .set({
        ...guide,
        updatedAt: new Date(),
      })
      .where(eq(userGuides.id, id))
      .returning();
    return updated;
  }

  async deleteUserGuide(id: number): Promise<void> {
    await db.delete(userGuides).where(eq(userGuides.id, id));
  }

  async getUserGuides(filters?: {
    category?: string;
    type?: string;
    isPublished?: boolean;
  }): Promise<UserGuide[]> {
    let query = db.select().from(userGuides);

    const conditions = [];
    if (filters?.category) {
      conditions.push(eq(userGuides.category, filters.category));
    }
    if (filters?.type) {
      conditions.push(eq(userGuides.type, filters.type));
    }
    if (filters?.isPublished !== undefined) {
      conditions.push(eq(userGuides.isPublished, filters.isPublished));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(desc(userGuides.createdAt));
  }

  async getUserGuideById(id: number): Promise<UserGuide | undefined> {
    const [guide] = await db
      .select()
      .from(userGuides)
      .where(eq(userGuides.id, id));
    return guide;
  }

  async incrementGuideViewCount(id: number): Promise<void> {
    await db
      .update(userGuides)
      .set({
        viewCount: sql`${userGuides.viewCount} + 1`,
      })
      .where(eq(userGuides.id, id));
  }

  // User Guide Category operations
  async createUserGuideCategory(
    category: InsertUserGuideCategory
  ): Promise<UserGuideCategory> {
    const [created] = await db
      .insert(userGuideCategories)
      .values(category)
      .returning();
    return created;
  }

  async updateUserGuideCategory(
    id: number,
    category: Partial<InsertUserGuideCategory>
  ): Promise<UserGuideCategory> {
    const [updated] = await db
      .update(userGuideCategories)
      .set(category)
      .where(eq(userGuideCategories.id, id))
      .returning();
    return updated;
  }

  async deleteUserGuideCategory(id: number): Promise<void> {
    await db.delete(userGuideCategories).where(eq(userGuideCategories.id, id));
  }

  async getUserGuideCategories(): Promise<UserGuideCategory[]> {
    return await db
      .select()
      .from(userGuideCategories)
      .orderBy(userGuideCategories.displayOrder, userGuideCategories.name);
  }

  // Department operations
  async createDepartment(department: InsertDepartment): Promise<Department> {
    const [created] = await db
      .insert(departments)
      .values(department)
      .returning();
    return created;
  }

  async updateDepartment(
    id: number,
    department: Partial<InsertDepartment>
  ): Promise<Department> {
    const [updated] = await db
      .update(departments)
      .set({
        ...department,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, id))
      .returning();
    return updated;
  }

  async deleteDepartment(id: number): Promise<void> {
    await db.delete(departments).where(eq(departments.id, id));
  }

  async getAllDepartments(): Promise<Department[]> {
    return await db
      .select()
      .from(departments)
      .where(eq(departments.isActive, true))
      .orderBy(departments.name);
  }

  async getAllDepartmentsIncludingInactive(): Promise<Department[]> {
    return await db.select().from(departments).orderBy(departments.name);
  }

  async getDepartmentById(id: number): Promise<Department | undefined> {
    const [dept] = await db
      .select()
      .from(departments)
      .where(eq(departments.id, id));
    return dept;
  }

  // User Invitation operations
  async createUserInvitation(
    invitation: InsertUserInvitation
  ): Promise<UserInvitation> {
    const token =
      Math.random().toString(36).substring(2) + Date.now().toString(36);
    const { expiresAt, ...rest } = invitation as any;
    const [created] = await db
      .insert(userInvitations)
      .values({
        ...(rest as any),
        expiresAt: expiresAt
          ? new Date(expiresAt as any)
          : new Date(Date.now() + 7 * 24 * 3600 * 1000),
        invitationToken: token,
      })
      .returning();
    return created;
  }

  async getUserInvitations(filters?: {
    status?: string;
  }): Promise<UserInvitation[]> {
    let query = db.select().from(userInvitations);

    if (filters?.status) {
      query = query.where(eq(userInvitations.status, filters.status)) as any;
    }

    return await query.orderBy(desc(userInvitations.createdAt));
  }

  async getUserInvitationByToken(
    token: string
  ): Promise<UserInvitation | undefined> {
    const [invitation] = await db
      .select()
      .from(userInvitations)
      .where(eq(userInvitations.invitationToken, token));
    return invitation;
  }

  async markInvitationAccepted(id: number): Promise<UserInvitation> {
    const [updated] = await db
      .update(userInvitations)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
      })
      .where(eq(userInvitations.id, id))
      .returning();
    return updated;
  }

  async deleteExpiredInvitations(): Promise<void> {
    await db
      .delete(userInvitations)
      .where(
        and(
          eq(userInvitations.status, "pending"),
          sql`${userInvitations.expiresAt} < NOW()`
        )
      );
  }

  async getUserInvitationById(id: number): Promise<UserInvitation | undefined> {
    const [invitation] = await db
      .select()
      .from(userInvitations)
      .where(eq(userInvitations.id, id));
    return invitation;
  }

  async cancelUserInvitation(id: number): Promise<void> {
    await db
      .update(userInvitations)
      .set({ status: "cancelled" })
      .where(eq(userInvitations.id, id));
  }

  // Teams Integration operations
  async getTeamsIntegrationSettings(
    userId: string
  ): Promise<TeamsIntegrationSettings | undefined> {
    const [settings] = await db
      .select()
      .from(teamsIntegrationSettings)
      .where(eq(teamsIntegrationSettings.userId, userId));
    return settings;
  }

  async upsertTeamsIntegrationSettings(
    settings: InsertTeamsIntegrationSettings
  ): Promise<TeamsIntegrationSettings> {
    const [result] = await db
      .insert(teamsIntegrationSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: teamsIntegrationSettings.userId,
        set: {
          ...settings,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async deleteTeamsIntegrationSettings(userId: string): Promise<void> {
    await db
      .delete(teamsIntegrationSettings)
      .where(eq(teamsIntegrationSettings.userId, userId));
  }

  // SSO Configuration operations
  async getSsoConfiguration(): Promise<SsoConfiguration | undefined> {
    const [config] = await db
      .select()
      .from(ssoConfiguration)
      .orderBy(desc(ssoConfiguration.updatedAt))
      .limit(1);
    return config;
  }

  async upsertSsoConfiguration(
    config: InsertSsoConfiguration
  ): Promise<SsoConfiguration> {
    // Delete any existing configuration
    await db.delete(ssoConfiguration);

    // Insert new configuration
    const [result] = await db
      .insert(ssoConfiguration)
      .values({
        ...config,
        updatedAt: new Date(),
      })
      .returning();
    return result;
  }

  // Bedrock usage tracking implementations
  async trackBedrockUsage(usage: InsertBedrockUsage): Promise<BedrockUsage> {
    const [result] = await db.insert(bedrockUsage).values(usage).returning();
    return result;
  }

  async getBedrockUsageByUser(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<BedrockUsage[]> {
    let query: any = db
      .select()
      .from(bedrockUsage)
      .where(eq(bedrockUsage.userId, userId));

    if (startDate) {
      query = (query as any).where(
        sql`${bedrockUsage.createdAt} >= ${startDate}`
      );
    }
    if (endDate) {
      query = (query as any).where(
        sql`${bedrockUsage.createdAt} <= ${endDate}`
      );
    }

    return await query.orderBy(desc(bedrockUsage.createdAt));
  }

  async getBedrockUsageSummary(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalCost: number;
    totalTokens: number;
    userCount: number;
    requestCount: number;
  }> {
    let whereConditions = [];

    if (startDate) {
      whereConditions.push(sql`${bedrockUsage.createdAt} >= ${startDate}`);
    }
    if (endDate) {
      whereConditions.push(sql`${bedrockUsage.createdAt} <= ${endDate}`);
    }

    const [result] = await db
      .select({
        totalCost: sql<number>`COALESCE(SUM(${bedrockUsage.cost}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${bedrockUsage.totalTokens}), 0)`,
        userCount: sql<number>`COUNT(DISTINCT ${bedrockUsage.userId})`,
        requestCount: sql<number>`COUNT(*)`,
      })
      .from(bedrockUsage)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    return {
      totalCost: parseFloat(result.totalCost?.toString() || "0"),
      totalTokens: parseInt(result.totalTokens?.toString() || "0"),
      userCount: parseInt(result.userCount?.toString() || "0"),
      requestCount: parseInt(result.requestCount?.toString() || "0"),
    };
  }

  // FAQ cache implementations
  async getFaqCacheEntry(questionHash: string): Promise<FaqCache | undefined> {
    const [entry] = await db
      .select()
      .from(faqCache)
      .where(eq(faqCache.questionHash, questionHash));
    return entry;
  }

  async createFaqCacheEntry(entry: InsertFaqCache): Promise<FaqCache> {
    const [result] = await db.insert(faqCache).values(entry).returning();
    return result;
  }

  async updateFaqCacheHit(id: number): Promise<void> {
    await db
      .update(faqCache)
      .set({
        hitCount: sql`${faqCache.hitCount} + 1`,
        lastUsed: new Date(),
      })
      .where(eq(faqCache.id, id));
  }

  async getPopularFaqs(limit: number = 10): Promise<FaqCache[]> {
    return await db
      .select()
      .from(faqCache)
      .orderBy(desc(faqCache.hitCount))
      .limit(limit);
  }

  async clearFaqCache(): Promise<void> {
    await db.delete(faqCache);
  }

  // Company Policy operations
  async createCompanyPolicy(
    policy: InsertCompanyPolicy
  ): Promise<CompanyPolicy> {
    const [result] = await db
      .insert(companyPolicies)
      .values(policy)
      .returning();
    return result;
  }

  async updateCompanyPolicy(
    id: number,
    policy: Partial<InsertCompanyPolicy>
  ): Promise<CompanyPolicy> {
    const [result] = await db
      .update(companyPolicies)
      .set({
        ...policy,
        updatedAt: new Date(),
      })
      .where(eq(companyPolicies.id, id))
      .returning();
    return result;
  }

  async deleteCompanyPolicy(id: number): Promise<void> {
    await db.delete(companyPolicies).where(eq(companyPolicies.id, id));
  }

  async getCompanyPolicyById(id: number): Promise<CompanyPolicy | undefined> {
    const [policy] = await db
      .select()
      .from(companyPolicies)
      .where(eq(companyPolicies.id, id));
    return policy;
  }

  async getAllCompanyPolicies(
    includeInactive: boolean = false
  ): Promise<CompanyPolicy[]> {
    if (includeInactive) {
      return await db
        .select()
        .from(companyPolicies)
        .orderBy(desc(companyPolicies.createdAt));
    }

    return await db
      .select()
      .from(companyPolicies)
      .where(eq(companyPolicies.isActive, true))
      .orderBy(desc(companyPolicies.createdAt));
  }

  async toggleCompanyPolicyStatus(id: number): Promise<CompanyPolicy> {
    const policy = await this.getCompanyPolicyById(id);
    if (!policy) {
      throw new Error("Company policy not found");
    }

    const [result] = await db
      .update(companyPolicies)
      .set({
        isActive: !policy.isActive,
        updatedAt: new Date(),
      })
      .where(eq(companyPolicies.id, id))
      .returning();
    return result;
  }

  // AI Analysis and Learning Methods
  async saveTicketAnalysis(userId: string, analysis: any): Promise<void> {
    // In production, implement proper database storage
    console.log("Saving ticket analysis for user:", userId, analysis);
  }

  async saveAutoResponse(data: any): Promise<void> {
    // In production, implement proper database storage
    console.log("Saving auto-response:", data);
  }

  async saveComplexityScore(data: any): Promise<void> {
    // In production, implement proper database storage
    console.log("Saving complexity score:", data);
  }

  // Knowledge Base operations
  async createKnowledgeArticle(
    article: InsertKnowledgeArticle
  ): Promise<KnowledgeArticle> {
    const [result] = await db
      .insert(knowledgeArticles)
      .values({
        ...article,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: (article as any).isPublished
          ? "published"
          : (article as any).status || "draft",
        source: (article as any).source || "manual",
        viewCount: 0,
      })
      .returning();
    return result;
  }

  async updateKnowledgeArticle(
    id: number,
    article: Partial<InsertKnowledgeArticle>
  ): Promise<KnowledgeArticle> {
    const [result] = await db
      .update(knowledgeArticles)
      .set({
        ...article,
        status:
          (article as any).isPublished !== undefined
            ? (article as any).isPublished
              ? "published"
              : "draft"
            : (article as any).status,
        source: (article as any).source,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeArticles.id, id))
      .returning();
    return result;
  }

  async deleteKnowledgeArticle(id: number): Promise<void> {
    await db.delete(knowledgeArticles).where(eq(knowledgeArticles.id, id));
  }

  async getKnowledgeArticle(id: number): Promise<KnowledgeArticle | undefined> {
    const [article] = await db
      .select()
      .from(knowledgeArticles)
      .where(eq(knowledgeArticles.id, id));
    return article;
  }

  async getAllKnowledgeArticles(filters?: {
    category?: string;
    isPublished?: boolean;
    createdBy?: string;
    status?: string;
    source?: string;
  }): Promise<KnowledgeArticle[]> {
    let query = db.select().from(knowledgeArticles);

    const conditions = [] as any[];
    if (filters?.category) {
      conditions.push(eq(knowledgeArticles.category, filters.category));
    }
    if (filters?.isPublished !== undefined) {
      conditions.push(eq(knowledgeArticles.isPublished, filters.isPublished));
    }
    if (filters?.createdBy) {
      conditions.push(eq(knowledgeArticles.createdBy, filters.createdBy));
    }
    if (filters?.status) {
      conditions.push(eq(knowledgeArticles.status as any, filters.status));
    }
    if (filters?.source) {
      conditions.push(eq(knowledgeArticles.source as any, filters.source));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(desc(knowledgeArticles.createdAt));
  }

  async getPublishedKnowledgeArticles(
    category?: string
  ): Promise<KnowledgeArticle[]> {
    const conditions = [eq(knowledgeArticles.status as any, "published")];
    if (category) conditions.push(eq(knowledgeArticles.category, category));
    return await db
      .select()
      .from(knowledgeArticles)
      .where(and(...conditions))
      .orderBy(desc(knowledgeArticles.usageCount));
  }

  async searchKnowledgeBase(
    query: string,
    category?: string
  ): Promise<KnowledgeArticle[]> {
    const searchTerms = query
      .toLowerCase()
      .split(" ")
      .filter((t) => t.length > 2);
    const conditions = [
      eq(knowledgeArticles.status as any, "published"),
    ] as any[];
    if (searchTerms.length > 0) {
      const searchConditions = searchTerms.map((term) =>
        or(
          ilike(knowledgeArticles.title, `%${term}%`),
          ilike(knowledgeArticles.content, `%${term}%`),
          ilike(knowledgeArticles.summary, `%${term}%`)
        )
      );
      conditions.push(or(...searchConditions));
    }
    if (category) conditions.push(eq(knowledgeArticles.category, category));

    return await db
      .select()
      .from(knowledgeArticles)
      .where(and(...conditions))
      .orderBy(
        desc(knowledgeArticles.effectivenessScore),
        desc(knowledgeArticles.usageCount)
      )
      .limit(50);
  }

  async findSimilarKnowledgeArticle(
    title: string
  ): Promise<KnowledgeArticle | undefined> {
    // Simple similarity search - in production could use vector similarity
    const normalizedTitle = title.toLowerCase();
    const words = normalizedTitle.split(" ").filter((word) => word.length > 3);

    if (words.length === 0) return undefined;

    const conditions = words.map((word) =>
      ilike(knowledgeArticles.title, `%${word}%`)
    );

    const [article] = await db
      .select()
      .from(knowledgeArticles)
      .where(or(...conditions))
      .limit(1);

    return article;
  }

  async toggleKnowledgeArticleStatus(id: number): Promise<KnowledgeArticle> {
    const article = await this.getKnowledgeArticle(id);
    if (!article) {
      throw new Error("Knowledge article not found");
    }

    const [result] = await db
      .update(knowledgeArticles)
      .set({
        isPublished: !article.isPublished,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeArticles.id, id))
      .returning();
    return result;
  }

  async incrementKnowledgeArticleUsage(id: number): Promise<void> {
    await db
      .update(knowledgeArticles)
      .set({
        usageCount: sql`${knowledgeArticles.usageCount} + 1`,
      })
      .where(eq(knowledgeArticles.id, id));
  }

  async updateArticleEffectiveness(id: number, rating: number): Promise<void> {
    // Simple effectiveness calculation - in production could be more sophisticated
    const article = await this.getKnowledgeArticle(id);
    if (!article) return;

    const currentScore = Number(article.effectivenessScore || 0);
    const newScore = (currentScore + Number(rating)) / 2; // Simple average

    await db
      .update(knowledgeArticles)
      .set({
        effectivenessScore: newScore.toString(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeArticles.id, id));
  }

  async setKnowledgeArticleStatus(
    id: number,
    status: "draft" | "published" | "archived"
  ): Promise<KnowledgeArticle> {
    const [updated] = await db
      .update(knowledgeArticles)
      .set({
        status,
        isPublished: status === "published",
        archivedAt: status === "archived" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeArticles.id, id))
      .returning();
    return updated;
  }

  async incrementKnowledgeArticleView(id: number): Promise<void> {
    await db
      .update(knowledgeArticles)
      .set({ viewCount: sql`${knowledgeArticles.viewCount} + 1` })
      .where(eq(knowledgeArticles.id, id));
  }

  // Learning Queue operations
  async addToLearningQueue(ticketId: number): Promise<LearningQueue> {
    const [result] = await db
      .insert(learningQueue)
      .values({
        ticketId,
        processStatus: "pending",
      })
      .returning();
    return result;
  }

  async getLearningQueueItems(status?: string): Promise<LearningQueue[]> {
    let query = db.select().from(learningQueue);

    if (status) {
      query = query.where(eq(learningQueue.processStatus, status)) as any;
    }

    return await query.orderBy(learningQueue.createdAt);
  }

  async updateLearningQueueItem(
    id: number,
    updates: Partial<InsertLearningQueue>
  ): Promise<LearningQueue> {
    const [result] = await db
      .update(learningQueue)
      .set({
        ...updates,
        processedAt:
          updates.processStatus === "completed" ? new Date() : undefined,
      })
      .where(eq(learningQueue.id, id))
      .returning();
    return result;
  }

  async getRecentResolvedTickets(days: number): Promise<Task[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "resolved"),
          sql`${tasks.updatedAt} >= ${cutoffDate}`
        )
      )
      .orderBy(desc(tasks.updatedAt));
  }

  async updateKnowledgeLearningStats(stats: any): Promise<void> {
    // Store learning analytics - could be expanded to dedicated table
    console.log("Knowledge learning stats updated:", stats);
  }

  async saveAIAnalytics(analytics: any): Promise<void> {
    console.log("Saving AI analytics:", analytics);
  }

  // (Duplicate Knowledge Base methods removed; primary implementations defined earlier in file)

  // Learning Queue operations implementation
  // Notifications operations
  async getUnreadNotifications(
    userId: string,
    limit: number = 5
  ): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async markNotificationRead(id: number): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      );
  }

  async createNotification(
    notification: InsertNotification
  ): Promise<Notification> {
    const [result] = await db
      .insert(notifications)
      .values({ ...notification, createdAt: new Date() })
      .returning();
    return result;
  }

  // Stats operations
  async getAgentStats(userId: string): Promise<{
    personal: {
      assignedToMe: number;
      createdByMe: number;
      resolutionRate: number;
      avgResolutionTime: number;
    };
    team?: Array<{
      teamId: number;
      teamName: string;
      totalTickets: number;
      openTickets: number;
      inProgress: number;
      resolved: number;
      closed: number;
      highPriority: number;
    }>;
  }> {
    // Personal stats: tickets assigned to me
    const assignedTickets = await db
      .select({ count: count() })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, userId), eq(tasks.assigneeType, "user")));

    const assignedCount = Number(assignedTickets[0]?.count || 0);

    // Personal stats: tickets created by me
    const createdTickets = await db
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.createdBy, userId));

    const createdCount = Number(createdTickets[0]?.count || 0);

    // Personal stats: resolution rate and avg resolution time
    const resolvedTickets = await db
      .select({
        count: count(),
        avgTime: sql<number>`AVG(
          EXTRACT(EPOCH FROM (COALESCE(${tasks.resolvedAt}, ${tasks.closedAt}) - ${tasks.createdAt})) / 3600
        )`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeId, userId),
          eq(tasks.assigneeType, "user"),
          or(eq(tasks.status, "resolved"), eq(tasks.status, "closed"))
        )
      );

    const resolvedCount = Number(resolvedTickets[0]?.count || 0);
    const resolutionRate =
      assignedCount > 0 ? resolvedCount / assignedCount : 0;
    const avgResolutionTime = Number(resolvedTickets[0]?.avgTime || 0);

    // Team stats: get user's teams (only teams the user is enrolled in via teamMembers table)
    const userTeams = await this.getUserTeams(userId);
    const teamStats: Array<{
      teamId: number;
      teamName: string;
      totalTickets: number;
      openTickets: number;
      inProgress: number;
      resolved: number;
      closed: number;
      highPriority: number;
    }> = [];

    for (const team of userTeams) {
      // Total tickets assigned to team
      const totalResult = await db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(eq(tasks.assigneeTeamId, team.id), eq(tasks.assigneeType, "team"))
        );

      const total = Number(totalResult[0]?.count || 0);

      // Open tickets
      const openResult = await db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeTeamId, team.id),
            eq(tasks.assigneeType, "team"),
            eq(tasks.status, "open")
          )
        );

      const open = Number(openResult[0]?.count || 0);

      // In progress tickets
      const inProgressResult = await db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeTeamId, team.id),
            eq(tasks.assigneeType, "team"),
            eq(tasks.status, "in_progress")
          )
        );

      const inProgress = Number(inProgressResult[0]?.count || 0);

      // Resolved tickets
      const resolvedResult = await db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeTeamId, team.id),
            eq(tasks.assigneeType, "team"),
            eq(tasks.status, "resolved")
          )
        );

      const resolved = Number(resolvedResult[0]?.count || 0);

      // Closed tickets
      const closedResult = await db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeTeamId, team.id),
            eq(tasks.assigneeType, "team"),
            eq(tasks.status, "closed")
          )
        );

      const closed = Number(closedResult[0]?.count || 0);

      // High priority tickets (high or urgent)
      const highPriorityResult = await db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeTeamId, team.id),
            eq(tasks.assigneeType, "team"),
            or(eq(tasks.priority, "high"), eq(tasks.priority, "urgent"))
          )
        );

      const highPriority = Number(highPriorityResult[0]?.count || 0);

      teamStats.push({
        teamId: team.id,
        teamName: team.name,
        totalTickets: total,
        openTickets: open,
        inProgress,
        resolved,
        closed,
        highPriority,
      });
    }

    return {
      personal: {
        assignedToMe: assignedCount,
        createdByMe: createdCount,
        resolutionRate,
        avgResolutionTime,
      },
      team: teamStats.length > 0 ? teamStats : undefined,
    };
  }

  async getManagerStats(userId: string): Promise<{
    department: Array<{
      departmentId: number;
      departmentName: string;
      totalTickets: number;
      openTickets: number;
      inProgress: number;
      resolved: number;
      closed: number;
      highPriority: number;
      avgResolutionTime: number;
    }>;
    priorityDistribution: {
      urgent: number;
      high: number;
      medium: number;
      low: number;
    };
    categoryBreakdown: Array<{
      category: string;
      count: number;
      percentage: number;
    }>;
    teamPerformance: Array<{
      teamId: number;
      teamName: string;
      totalTickets: number;
      resolutionRate: number;
      avgResolutionTime: number;
      members: Array<{
        userId: string;
        name: string;
        assigned: number;
        resolved: number;
        resolutionRate: number;
        avgResolutionTime: number;
      }>;
    }>;
  }> {
    // Get departments managed by this manager
    const managerDepartments = await db
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.managerId as any, userId),
          eq(departments.isActive, true)
        )
      );

    const departmentStats: Array<{
      departmentId: number;
      departmentName: string;
      totalTickets: number;
      openTickets: number;
      inProgress: number;
      resolved: number;
      closed: number;
      highPriority: number;
      avgResolutionTime: number;
    }> = [];

    let allDepartmentTaskIds: number[] = [];

    for (const dept of managerDepartments) {
      // Get teams in this department
      const deptTeams = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.departmentId, dept.id));

      const teamIds = deptTeams.map((t) => t.id);

      if (teamIds.length === 0) {
        departmentStats.push({
          departmentId: dept.id,
          departmentName: dept.name,
          totalTickets: 0,
          openTickets: 0,
          inProgress: 0,
          resolved: 0,
          closed: 0,
          highPriority: 0,
          avgResolutionTime: 0,
        });
        continue;
      }

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

      allDepartmentTaskIds.push(...deptTasks.map((t) => t.id));

      // Calculate department stats
      const total = deptTasks.length;
      const open = deptTasks.filter((t) => t.status === "open").length;
      const inProgress = deptTasks.filter(
        (t) => t.status === "in_progress"
      ).length;
      const resolved = deptTasks.filter((t) => t.status === "resolved").length;
      const closed = deptTasks.filter((t) => t.status === "closed").length;
      const highPriority = deptTasks.filter(
        (t) => t.priority === "high" || t.priority === "urgent"
      ).length;

      // Calculate avg resolution time for resolved/closed tickets
      const resolvedTasks = await db
        .select({
          avgTime: sql<number>`AVG(
            EXTRACT(EPOCH FROM (COALESCE(${tasks.resolvedAt}, ${tasks.closedAt}) - ${tasks.createdAt})) / 3600
          )`,
        })
        .from(tasks)
        .where(
          and(
            inArray(tasks.assigneeTeamId, teamIds),
            eq(tasks.assigneeType, "team"),
            or(eq(tasks.status, "resolved"), eq(tasks.status, "closed"))
          )
        );

      const avgResolutionTime = Number(resolvedTasks[0]?.avgTime || 0);

      departmentStats.push({
        departmentId: dept.id,
        departmentName: dept.name,
        totalTickets: total,
        openTickets: open,
        inProgress,
        resolved,
        closed,
        highPriority,
        avgResolutionTime,
      });
    }

    // Priority distribution across all department tickets
    const priorityResult = await db
      .select({
        priority: tasks.priority,
        count: count(),
      })
      .from(tasks)
      .where(
        allDepartmentTaskIds.length > 0
          ? inArray(tasks.id, allDepartmentTaskIds)
          : sql`FALSE`
      )
      .groupBy(tasks.priority);

    const priorityDistribution = {
      urgent: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const row of priorityResult) {
      const priority = row.priority?.toLowerCase() || "";
      const count = Number(row.count || 0);
      if (priority === "urgent") priorityDistribution.urgent = count;
      else if (priority === "high") priorityDistribution.high = count;
      else if (priority === "medium") priorityDistribution.medium = count;
      else if (priority === "low") priorityDistribution.low = count;
    }

    // Category breakdown
    const categoryResult = await db
      .select({
        category: tasks.category,
        count: count(),
      })
      .from(tasks)
      .where(
        allDepartmentTaskIds.length > 0
          ? inArray(tasks.id, allDepartmentTaskIds)
          : sql`FALSE`
      )
      .groupBy(tasks.category);

    const totalCategoryTickets = categoryResult.reduce(
      (sum, row) => sum + Number(row.count || 0),
      0
    );

    const categoryBreakdown = categoryResult.map((row) => ({
      category: row.category || "unknown",
      count: Number(row.count || 0),
      percentage:
        totalCategoryTickets > 0
          ? (Number(row.count || 0) / totalCategoryTickets) * 100
          : 0,
    }));

    // Team performance
    const teamPerformance: Array<{
      teamId: number;
      teamName: string;
      totalTickets: number;
      resolutionRate: number;
      avgResolutionTime: number;
      members: Array<{
        userId: string;
        name: string;
        assigned: number;
        resolved: number;
        resolutionRate: number;
        avgResolutionTime: number;
      }>;
    }> = [];

    for (const dept of managerDepartments) {
      const deptTeams = await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(eq(teams.departmentId, dept.id));

      for (const team of deptTeams) {
        // Team ticket stats
        const teamTasks = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.assigneeTeamId, team.id),
              eq(tasks.assigneeType, "team")
            )
          );

        const totalTickets = teamTasks.length;
        const resolvedTickets = teamTasks.filter(
          (t) => t.status === "resolved" || t.status === "closed"
        ).length;
        const resolutionRate =
          totalTickets > 0 ? resolvedTickets / totalTickets : 0;

        // Team avg resolution time
        const teamResolvedResult = await db
          .select({
            avgTime: sql<number>`AVG(
              EXTRACT(EPOCH FROM (COALESCE(${tasks.resolvedAt}, ${tasks.closedAt}) - ${tasks.createdAt})) / 3600
            )`,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.assigneeTeamId, team.id),
              eq(tasks.assigneeType, "team"),
              or(eq(tasks.status, "resolved"), eq(tasks.status, "closed"))
            )
          );

        const teamAvgResolutionTime = Number(
          teamResolvedResult[0]?.avgTime || 0
        );

        // Team member stats
        const teamMemberList = await this.getTeamMembers(team.id);
        const memberStats = await Promise.all(
          teamMemberList.map(async (member) => {
            const assignedResult = await db
              .select({ count: count() })
              .from(tasks)
              .where(
                and(
                  eq(tasks.assigneeId, member.user.id),
                  eq(tasks.assigneeType, "user")
                )
              );

            const assigned = Number(assignedResult[0]?.count || 0);

            const resolvedResult = await db
              .select({
                count: count(),
                avgTime: sql<number>`AVG(
                  EXTRACT(EPOCH FROM (COALESCE(${tasks.resolvedAt}, ${tasks.closedAt}) - ${tasks.createdAt})) / 3600
                )`,
              })
              .from(tasks)
              .where(
                and(
                  eq(tasks.assigneeId, member.user.id),
                  eq(tasks.assigneeType, "user"),
                  or(eq(tasks.status, "resolved"), eq(tasks.status, "closed"))
                )
              );

            const resolved = Number(resolvedResult[0]?.count || 0);
            const memberResolutionRate = assigned > 0 ? resolved / assigned : 0;
            const memberAvgResolutionTime = Number(
              resolvedResult[0]?.avgTime || 0
            );

            return {
              userId: member.user.id,
              name:
                `${member.user.firstName || ""} ${
                  member.user.lastName || ""
                }`.trim() ||
                member.user.email ||
                "Unknown",
              assigned,
              resolved,
              resolutionRate: memberResolutionRate,
              avgResolutionTime: memberAvgResolutionTime,
            };
          })
        );

        teamPerformance.push({
          teamId: team.id,
          teamName: team.name,
          totalTickets,
          resolutionRate,
          avgResolutionTime: teamAvgResolutionTime,
          members: memberStats,
        });
      }
    }

    return {
      department: departmentStats,
      priorityDistribution,
      categoryBreakdown,
      teamPerformance,
    };
  }

  async getS3UsageStats(): Promise<{
    totalStorage: number;
    totalFiles: number;
    dailyUsage: Array<{ date: string; storage: number; files: number }>;
    monthlyUsage: Array<{ month: string; storage: number; files: number }>;
    recentUploads: Array<{
      fileName: string;
      fileSize: number;
      uploadedAt: string;
      taskId: number;
    }>;
  }> {
    // Total storage and file count
    const [totalStats] = await db
      .select({
        totalStorage: sql<number>`COALESCE(SUM(${taskAttachments.fileSize}), 0)`,
        totalFiles: count(),
      })
      .from(taskAttachments);

    const totalStorage = Number(totalStats?.totalStorage || 0);
    const totalFiles = Number(totalStats?.totalFiles || 0);

    // Daily usage trends (last 30 days)
    const dailyUsageResult = await db
      .select({
        date: sql<string>`DATE(${taskAttachments.createdAt})::text`,
        storage: sql<number>`COALESCE(SUM(${taskAttachments.fileSize}), 0)`,
        files: count(),
      })
      .from(taskAttachments)
      .where(sql`${taskAttachments.createdAt} >= NOW() - INTERVAL '30 days'`)
      .groupBy(sql`DATE(${taskAttachments.createdAt})`)
      .orderBy(sql`DATE(${taskAttachments.createdAt}) ASC`);

    const dailyUsage = dailyUsageResult.map((row) => ({
      date: row.date,
      storage: Number(row.storage || 0),
      files: Number(row.files || 0),
    }));

    // Monthly usage trends (last 12 months)
    const monthlyUsageResult = await db
      .select({
        month: sql<string>`TO_CHAR(${taskAttachments.createdAt}, 'YYYY-MM')`,
        storage: sql<number>`COALESCE(SUM(${taskAttachments.fileSize}), 0)`,
        files: count(),
      })
      .from(taskAttachments)
      .where(sql`${taskAttachments.createdAt} >= NOW() - INTERVAL '12 months'`)
      .groupBy(sql`TO_CHAR(${taskAttachments.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${taskAttachments.createdAt}, 'YYYY-MM') ASC`);

    const monthlyUsage = monthlyUsageResult.map((row) => ({
      month: row.month,
      storage: Number(row.storage || 0),
      files: Number(row.files || 0),
    }));

    // Recent uploads (last 20)
    const recentUploadsResult = await db
      .select({
        fileName: taskAttachments.fileName,
        fileSize: taskAttachments.fileSize,
        uploadedAt: taskAttachments.createdAt,
        taskId: taskAttachments.taskId,
      })
      .from(taskAttachments)
      .orderBy(desc(taskAttachments.createdAt))
      .limit(20);

    const recentUploads = recentUploadsResult.map((row) => ({
      fileName: row.fileName,
      fileSize: row.fileSize,
      uploadedAt: row.uploadedAt?.toISOString() || new Date().toISOString(),
      taskId: row.taskId,
    }));

    return {
      totalStorage,
      totalFiles,
      dailyUsage,
      monthlyUsage,
      recentUploads,
    };
  }
}

export const storage = new DatabaseStorage();
