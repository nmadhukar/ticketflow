import {
  users,
  tasks,
  teams,
  teamMembers,
  taskComments,
  taskHistory,
  taskAttachments,
  companySettings,
  apiKeys,
  smtpSettings,
  emailTemplates,
  helpDocuments,
  aiChatMessages,
  userGuides,
  userGuideCategories,
  departments,
  userInvitations,
  teamsIntegrationSettings,
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
  type TaskAttachment,
  type InsertTaskAttachment,
  type CompanySettings,
  type InsertCompanySettings,
  type ApiKey,
  type InsertApiKey,
  type SmtpSettings,
  type InsertSmtpSettings,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, like, count, sql, isNotNull } from "drizzle-orm";

/**
 * Storage Interface for TicketFlow
 * 
 * This interface defines all database operations for the application.
 * Implementations should handle database transactions, error handling,
 * and maintain data integrity across all operations.
 * 
 * @interface IStorage
 */
export interface IStorage {
  // User operations (mandatory for Replit Auth)
  
  /**
   * Retrieves a user by their unique identifier
   * @param id - User ID (from authentication provider)
   * @returns User object or undefined if not found
   */
  getUser(id: string): Promise<User | undefined>;
  
  /**
   * Creates or updates a user record
   * @param user - User data to insert or update
   * @returns Updated user object
   */
  upsertUser(user: UpsertUser): Promise<User>;
  
  /**
   * Retrieves all users in the system
   * @returns Array of all users
   */
  getAllUsers(): Promise<User[]>;
  
  /**
   * Creates a new user
   * @param user - User data to insert
   * @returns Created user object
   */
  createUser(user: InsertUser): Promise<User>;
  
  /**
   * Retrieves a user by email
   * @param email - User email address
   * @returns User object or undefined if not found
   */
  getUserByEmail(email: string): Promise<User | undefined>;
  
  /**
   * Sets password reset token for a user
   * @param userId - User ID
   * @param token - Reset token
   * @param expires - Token expiration date
   */
  setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void>;
  
  /**
   * Retrieves a user by password reset token
   * @param token - Reset token
   * @returns User object or undefined if not found or token expired
   */
  getUserByResetToken(token: string): Promise<User | undefined>;
  
  /**
   * Updates user password
   * @param userId - User ID
   * @param hashedPassword - New hashed password
   */
  updateUserPassword(userId: string, hashedPassword: string): Promise<void>;
  
  /**
   * Clears password reset token for a user
   * @param userId - User ID
   */
  clearPasswordResetToken(userId: string): Promise<void>;
  
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
  approveUser(userId: string): Promise<User>;
  assignUserToTeam(userId: string, teamId: number, role?: string): Promise<TeamMember>;
  removeUserFromTeam(userId: string, teamId: number): Promise<void>;
  updateTeamMemberRole(userId: string, teamId: number, role: string): Promise<TeamMember>;
  getDepartments(): Promise<string[]>;
  resetUserPassword(userId: string): Promise<{ tempPassword: string }>;
  
  // Attachment operations
  addTaskAttachment(attachment: InsertTaskAttachment): Promise<TaskAttachment>;
  getTaskAttachments(taskId: number): Promise<TaskAttachment[]>;
  deleteTaskAttachment(id: number): Promise<void>;
  
  // Company settings operations
  getCompanySettings(): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: Partial<InsertCompanySettings>, userId: string): Promise<CompanySettings>;
  
  // API key operations
  createApiKey(apiKey: InsertApiKey): Promise<{ apiKey: ApiKey; plainKey: string }>;
  getApiKeys(userId: string): Promise<ApiKey[]>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined>;
  updateApiKeyLastUsed(id: number): Promise<void>;
  revokeApiKey(id: number): Promise<void>;
  
  // SMTP settings operations
  getSmtpSettings(): Promise<SmtpSettings | undefined>;
  updateSmtpSettings(settings: InsertSmtpSettings, userId: string): Promise<SmtpSettings>;
  
  // Email template operations
  getEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplate(name: string): Promise<EmailTemplate | undefined>;
  updateEmailTemplate(name: string, template: Partial<InsertEmailTemplate>, userId: string): Promise<EmailTemplate>;
  
  // Help Document operations
  createHelpDocument(doc: InsertHelpDocument): Promise<HelpDocument>;
  getHelpDocuments(): Promise<HelpDocument[]>;
  getHelpDocument(id: number): Promise<HelpDocument | undefined>;
  updateHelpDocument(id: number, doc: Partial<InsertHelpDocument>): Promise<HelpDocument>;
  deleteHelpDocument(id: number): Promise<void>;
  incrementViewCount(id: number): Promise<void>;
  searchHelpDocuments(query: string): Promise<HelpDocument[]>;
  
  // AI Chat operations
  createChatMessage(message: InsertAiChatMessage): Promise<AiChatMessage>;
  getChatMessages(userId: string, sessionId: string): Promise<AiChatMessage[]>;
  getChatSessions(userId: string): Promise<{ sessionId: string; lastMessage: string; createdAt: Date }[]>;
  
  // User Guide operations
  createUserGuide(guide: InsertUserGuide): Promise<UserGuide>;
  updateUserGuide(id: number, guide: Partial<InsertUserGuide>): Promise<UserGuide>;
  deleteUserGuide(id: number): Promise<void>;
  getUserGuides(filters?: { category?: string; type?: string; isPublished?: boolean }): Promise<UserGuide[]>;
  getUserGuideById(id: number): Promise<UserGuide | undefined>;
  incrementGuideViewCount(id: number): Promise<void>;
  
  // User Guide Category operations
  createUserGuideCategory(category: InsertUserGuideCategory): Promise<UserGuideCategory>;
  updateUserGuideCategory(id: number, category: Partial<InsertUserGuideCategory>): Promise<UserGuideCategory>;
  deleteUserGuideCategory(id: number): Promise<void>;
  getUserGuideCategories(): Promise<UserGuideCategory[]>;
  
  // Department operations
  createDepartment(department: InsertDepartment): Promise<Department>;
  updateDepartment(id: number, department: Partial<InsertDepartment>): Promise<Department>;
  deleteDepartment(id: number): Promise<void>;
  getAllDepartments(): Promise<Department[]>;
  getDepartmentById(id: number): Promise<Department | undefined>;
  
  // User Invitation operations
  createUserInvitation(invitation: InsertUserInvitation): Promise<UserInvitation>;
  getUserInvitations(filters?: { status?: string }): Promise<UserInvitation[]>;
  getUserInvitationByToken(token: string): Promise<UserInvitation | undefined>;
  markInvitationAccepted(id: number): Promise<UserInvitation>;
  deleteExpiredInvitations(): Promise<void>;
  
  // Teams Integration operations
  getTeamsIntegrationSettings(userId: string): Promise<TeamsIntegrationSettings | undefined>;
  upsertTeamsIntegrationSettings(settings: InsertTeamsIntegrationSettings): Promise<TeamsIntegrationSettings>;
  deleteTeamsIntegrationSettings(userId: string): Promise<void>;
  
  // SSO Configuration operations
  getSsoConfiguration(): Promise<SsoConfiguration | undefined>;
  upsertSsoConfiguration(config: InsertSsoConfiguration): Promise<SsoConfiguration>;
  
  // Bedrock usage tracking
  trackBedrockUsage(usage: InsertBedrockUsage): Promise<BedrockUsage>;
  getBedrockUsageByUser(userId: string, startDate?: Date, endDate?: Date): Promise<BedrockUsage[]>;
  getBedrockUsageSummary(startDate?: Date, endDate?: Date): Promise<{
    totalCost: number;
    totalTokens: number;
    userCount: number;
    requestCount: number;
  }>;
  
  // FAQ cache operations
  getFaqCacheEntry(questionHash: string): Promise<FaqCache | undefined>;
  createFaqCacheEntry(entry: InsertFaqCache): Promise<FaqCache>;
  updateFaqCacheHit(id: number): Promise<void>;
  getPopularFaqs(limit?: number): Promise<FaqCache[]>;
  clearFaqCache(): Promise<void>;
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

  async createUser(user: InsertUser): Promise<User> {
    const [createdUser] = await db.insert(users).values(user).returning();
    return createdUser;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void> {
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

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
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
      const parts = highestTicket.ticketNumber.split('-');
      if (parts.length === 3) {
        nextNumber = parseInt(parts[2]) + 1;
      }
    }
    
    // Format the ticket number with zero padding
    return `${prefix}-${year}-${nextNumber.toString().padStart(4, '0')}`;
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
          WHEN ${tasks.assigneeType} = 'team' THEN team.name
          ELSE COALESCE(assignee.first_name || ' ' || assignee.last_name, assignee.email)
        END`,
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
      .leftJoin(sql`${users} as assignee`, sql`assignee.id = ${tasks.assigneeId} AND ${tasks.assigneeType} = 'user'`)
      .leftJoin(teams, sql`${teams.id}::varchar = ${tasks.assigneeId} AND ${tasks.assigneeType} = 'team'`)
      .where(eq(tasks.id, id));
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
  } = {}): Promise<any[]> {
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
    
    // First get the tasks
    let taskQuery = db.select().from(tasks);
    
    if (conditions.length > 0) {
      taskQuery = taskQuery.where(and(...conditions));
    }
    
    taskQuery = taskQuery.orderBy(desc(tasks.createdAt));
    
    if (filters.limit) {
      taskQuery = taskQuery.limit(filters.limit);
    }
    
    if (filters.offset) {
      taskQuery = taskQuery.offset(filters.offset);
    }
    
    const taskResults = await taskQuery;
    
    // Now enhance with creator and assignee names
    const enhancedTasks = [];
    for (const task of taskResults) {
      let creatorName = 'Unknown';
      let assigneeName = '';
      
      // Get creator name
      if (task.createdBy) {
        const [creator] = await db.select().from(users).where(eq(users.id, task.createdBy));
        if (creator) {
          creatorName = creator.firstName && creator.lastName 
            ? `${creator.firstName} ${creator.lastName}` 
            : creator.email || 'Unknown';
        }
      }
      
      // Get assignee name
      if (task.assigneeId) {
        if (task.assigneeType === 'team') {
          const [team] = await db.select().from(teams).where(eq(teams.id, parseInt(task.assigneeId)));
          if (team) {
            assigneeName = team.name;
          }
        } else {
          const [assignee] = await db.select().from(users).where(eq(users.id, task.assigneeId));
          if (assignee) {
            assigneeName = assignee.firstName && assignee.lastName 
              ? `${assignee.firstName} ${assignee.lastName}` 
              : assignee.email || '';
          }
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
        lastUpdatedBy
      });
    }
    
    return enhancedTasks;
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
  
  // Attachment operations
  async addTaskAttachment(attachment: InsertTaskAttachment): Promise<TaskAttachment> {
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
    const [settings] = await db.select().from(companySettings).limit(1);
    return settings;
  }
  
  async updateCompanySettings(settings: Partial<InsertCompanySettings>, userId: string): Promise<CompanySettings> {
    const existingSettings = await this.getCompanySettings();
    
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
      return updated;
    } else {
      const [created] = await db
        .insert(companySettings)
        .values({
          ...settings,
          updatedBy: userId,
        })
        .returning();
      return created;
    }
  }
  
  // API key operations
  async createApiKey(apiKey: InsertApiKey): Promise<{ apiKey: ApiKey; plainKey: string }> {
    // Generate a secure API key
    const plainKey = `tfk_${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
    const keyPrefix = plainKey.substring(0, 8);
    
    // In production, you'd hash the key before storing
    const keyHash = plainKey; // TODO: Use bcrypt or similar
    
    const [newApiKey] = await db
      .insert(apiKeys)
      .values({
        ...apiKey,
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
      .where(eq(apiKeys.userId, userId))
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
    await db
      .update(apiKeys)
      .set({ isActive: false })
      .where(eq(apiKeys.id, id));
  }
  
  async updateApiKey(id: number, updates: { keyHash?: string; isActive?: boolean }): Promise<void> {
    await db
      .update(apiKeys)
      .set(updates)
      .where(eq(apiKeys.id, id));
  }

  // SMTP settings operations
  async getSmtpSettings(): Promise<SmtpSettings | undefined> {
    const [settings] = await db.select().from(smtpSettings).where(eq(smtpSettings.isActive, true));
    return settings;
  }

  async updateSmtpSettings(settings: InsertSmtpSettings, userId: string): Promise<SmtpSettings> {
    const existingSettings = await this.getSmtpSettings();
    
    if (existingSettings) {
      const [updated] = await db.update(smtpSettings)
        .set({
          ...settings,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(smtpSettings.id, existingSettings.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(smtpSettings)
        .values({
          ...settings,
          updatedBy: userId,
        })
        .returning();
      return created;
    }
  }

  // Email template operations
  async getEmailTemplates(): Promise<EmailTemplate[]> {
    return await db.select().from(emailTemplates).orderBy(emailTemplates.name);
  }

  async getEmailTemplate(name: string): Promise<EmailTemplate | undefined> {
    const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.name, name));
    return template;
  }

  async updateEmailTemplate(name: string, template: Partial<InsertEmailTemplate>, userId: string): Promise<EmailTemplate> {
    const existingTemplate = await this.getEmailTemplate(name);
    
    if (existingTemplate) {
      const [updated] = await db.update(emailTemplates)
        .set({
          ...template,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(emailTemplates.name, name))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(emailTemplates)
        .values({
          name,
          subject: template.subject || 'Default Subject',
          body: template.body || 'Default Body',
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
    return await db.select().from(helpDocuments).orderBy(desc(helpDocuments.createdAt));
  }

  async getHelpDocument(id: number): Promise<HelpDocument | undefined> {
    const [doc] = await db.select().from(helpDocuments).where(eq(helpDocuments.id, id));
    return doc;
  }

  async updateHelpDocument(id: number, doc: Partial<InsertHelpDocument>): Promise<HelpDocument> {
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
  async createChatMessage(message: InsertAiChatMessage): Promise<AiChatMessage> {
    const [created] = await db.insert(aiChatMessages).values(message).returning();
    return created;
  }

  async getChatMessages(userId: string, sessionId: string): Promise<AiChatMessage[]> {
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

  async getChatSessions(userId: string): Promise<{ sessionId: string; lastMessage: string; createdAt: Date }[]> {
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
    const sessionMap = new Map<string, { sessionId: string; lastMessage: string; createdAt: Date }>();
    
    for (const session of sessions) {
      if (session.createdAt) {
        const existing = sessionMap.get(session.sessionId);
        if (!existing || session.createdAt > existing.createdAt) {
          sessionMap.set(session.sessionId, {
            sessionId: session.sessionId,
            lastMessage: session.content.substring(0, 100) + (session.content.length > 100 ? '...' : ''),
            createdAt: session.createdAt,
          });
        }
      }
    }

    return Array.from(sessionMap.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // User Guide operations
  async createUserGuide(guide: InsertUserGuide): Promise<UserGuide> {
    const [created] = await db.insert(userGuides).values(guide).returning();
    return created;
  }

  async updateUserGuide(id: number, guide: Partial<InsertUserGuide>): Promise<UserGuide> {
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

  async getUserGuides(filters?: { category?: string; type?: string; isPublished?: boolean }): Promise<UserGuide[]> {
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
    const [guide] = await db.select().from(userGuides).where(eq(userGuides.id, id));
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
  async createUserGuideCategory(category: InsertUserGuideCategory): Promise<UserGuideCategory> {
    const [created] = await db.insert(userGuideCategories).values(category).returning();
    return created;
  }

  async updateUserGuideCategory(id: number, category: Partial<InsertUserGuideCategory>): Promise<UserGuideCategory> {
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
    const [created] = await db.insert(departments).values(department).returning();
    return created;
  }
  
  async getDepartmentById(id: number): Promise<Department | undefined> {
    const [dept] = await db.select().from(departments).where(eq(departments.id, id));
    return dept;
  }

  async updateDepartment(id: number, department: Partial<InsertDepartment>): Promise<Department> {
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
    return await db.select().from(departments).where(eq(departments.isActive, true)).orderBy(departments.name);
  }

  async getDepartmentById(id: number): Promise<Department | undefined> {
    const [dept] = await db.select().from(departments).where(eq(departments.id, id));
    return dept;
  }

  // User Invitation operations
  async createUserInvitation(invitation: InsertUserInvitation): Promise<UserInvitation> {
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const [created] = await db
      .insert(userInvitations)
      .values({
        ...invitation,
        invitationToken: token,
      })
      .returning();
    return created;
  }

  async getUserInvitations(filters?: { status?: string }): Promise<UserInvitation[]> {
    let query = db.select().from(userInvitations);
    
    if (filters?.status) {
      query = query.where(eq(userInvitations.status, filters.status)) as any;
    }
    
    return await query.orderBy(desc(userInvitations.createdAt));
  }

  async getUserInvitationByToken(token: string): Promise<UserInvitation | undefined> {
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
        status: 'accepted',
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
          eq(userInvitations.status, 'pending'),
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
      .set({ status: 'cancelled' })
      .where(eq(userInvitations.id, id));
  }
  
  // Teams Integration operations
  async getTeamsIntegrationSettings(userId: string): Promise<TeamsIntegrationSettings | undefined> {
    const [settings] = await db
      .select()
      .from(teamsIntegrationSettings)
      .where(eq(teamsIntegrationSettings.userId, userId));
    return settings;
  }

  async upsertTeamsIntegrationSettings(settings: InsertTeamsIntegrationSettings): Promise<TeamsIntegrationSettings> {
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

  async upsertSsoConfiguration(config: InsertSsoConfiguration): Promise<SsoConfiguration> {
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
    const [result] = await db
      .insert(bedrockUsage)
      .values(usage)
      .returning();
    return result;
  }
  
  async getBedrockUsageByUser(userId: string, startDate?: Date, endDate?: Date): Promise<BedrockUsage[]> {
    let query = db.select().from(bedrockUsage).where(eq(bedrockUsage.userId, userId));
    
    if (startDate) {
      query = query.where(sql`${bedrockUsage.createdAt} >= ${startDate}`);
    }
    if (endDate) {
      query = query.where(sql`${bedrockUsage.createdAt} <= ${endDate}`);
    }
    
    return await query.orderBy(desc(bedrockUsage.createdAt));
  }
  
  async getBedrockUsageSummary(startDate?: Date, endDate?: Date): Promise<{
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
    const [result] = await db
      .insert(faqCache)
      .values(entry)
      .returning();
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
}

export const storage = new DatabaseStorage();
