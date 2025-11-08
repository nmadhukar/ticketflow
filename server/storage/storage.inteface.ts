import {
  type AiChatMessage,
  type ApiKey,
  type BedrockSettings,
  type BedrockUsage,
  type CompanyPolicy,
  type CompanySettings,
  type Department,
  type EmailProvider,
  type EmailTemplate,
  type FaqCache,
  type HelpDocument,
  type InsertAiChatMessage,
  type InsertApiKey,
  type InsertBedrockSettings,
  type InsertBedrockUsage,
  type InsertCompanyPolicy,
  type InsertCompanySettings,
  type InsertDepartment,
  type InsertEmailProvider,
  type InsertEmailTemplate,
  type InsertFaqCache,
  type InsertHelpDocument,
  type InsertKnowledgeArticle,
  type InsertLearningQueue,
  type InsertNotification,
  type InsertSsoConfiguration,
  type InsertTask,
  type InsertTaskAttachment,
  type InsertTaskComment,
  type InsertTeam,
  type InsertTeamMember,
  type InsertTeamsIntegrationSettings,
  type InsertUser,
  type InsertUserGuide,
  type InsertUserGuideCategory,
  type InsertUserInvitation,
  type KnowledgeArticle,
  type LearningQueue,
  type Notification,
  type SsoConfiguration,
  type Task,
  type TaskAttachment,
  type TaskComment,
  type TaskHistory,
  type Team,
  type TeamMember,
  type TeamsIntegrationSettings,
  type UpsertUser,
  type User,
  type UserGuide,
  type UserGuideCategory,
  type UserInvitation,
} from "@shared/schema";

/**
 * Database Storage Layer for TicketFlow
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
  setPasswordResetToken(
    userId: string,
    token: string,
    expires: Date
  ): Promise<void>;

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
  updateTask(
    id: number,
    updates: Partial<InsertTask>,
    userId: string
  ): Promise<Task>;
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
  getTaskComments(
    taskId: number
  ): Promise<(TaskComment & { userName?: string })[]>;

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
  updateUserProfile(
    userId: string,
    updates: {
      firstName?: string;
      lastName?: string;
      email?: string;
      role?: string;
      department?: string;
      phone?: string;
      isActive?: boolean;
    }
  ): Promise<User>;
  toggleUserStatus(userId: string): Promise<User>;
  approveUser(userId: string): Promise<User>;
  assignUserToTeam(
    userId: string,
    teamId: number,
    role?: string
  ): Promise<TeamMember>;
  removeUserFromTeam(userId: string, teamId: number): Promise<void>;
  updateTeamMemberRole(
    userId: string,
    teamId: number,
    role: string
  ): Promise<TeamMember>;
  getDepartments(): Promise<string[]>;
  resetUserPassword(userId: string): Promise<{ tempPassword: string }>;

  // Attachment operations
  addTaskAttachment(attachment: InsertTaskAttachment): Promise<TaskAttachment>;
  getTaskAttachments(taskId: number): Promise<TaskAttachment[]>;
  deleteTaskAttachment(id: number): Promise<void>;

  // Company settings operations
  getCompanySettings(): Promise<CompanySettings | undefined>;
  updateCompanySettings(
    settings: Partial<InsertCompanySettings>,
    userId: string
  ): Promise<CompanySettings>;

  // API key operations
  createApiKey(
    apiKey: InsertApiKey
  ): Promise<{ apiKey: ApiKey; plainKey: string }>;
  getApiKeys(userId: string): Promise<ApiKey[]>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined>;
  updateApiKeyLastUsed(id: number): Promise<void>;
  revokeApiKey(id: number): Promise<void>;

  // Bedrock settings operations
  getBedrockSettings(): Promise<BedrockSettings | undefined>;
  updateBedrockSettings(
    settings: InsertBedrockSettings,
    userId: string
  ): Promise<BedrockSettings>;

  // Email provider operations
  getActiveEmailProvider(): Promise<EmailProvider | undefined>;
  upsertEmailProvider(
    provider: InsertEmailProvider,
    userId: string
  ): Promise<EmailProvider>;
  setActiveEmailProvider(id: number): Promise<void>;
  updateActiveEmailProvider(
    updates: Partial<{ fromEmail: string; fromName: string; metadata: any }>
  ): Promise<EmailProvider>;

  // Email template operations
  getEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplate(name: string): Promise<EmailTemplate | undefined>;
  updateEmailTemplate(
    name: string,
    template: Partial<InsertEmailTemplate>,
    userId: string
  ): Promise<EmailTemplate>;

  // Help Document operations
  createHelpDocument(doc: InsertHelpDocument): Promise<HelpDocument>;
  getHelpDocuments(): Promise<HelpDocument[]>;
  getHelpDocument(id: number): Promise<HelpDocument | undefined>;
  updateHelpDocument(
    id: number,
    doc: Partial<InsertHelpDocument>
  ): Promise<HelpDocument>;
  deleteHelpDocument(id: number): Promise<void>;
  incrementViewCount(id: number): Promise<void>;
  searchHelpDocuments(query: string): Promise<HelpDocument[]>;

  // AI Chat operations
  createChatMessage(message: InsertAiChatMessage): Promise<AiChatMessage>;
  getChatMessages(userId: string, sessionId: string): Promise<AiChatMessage[]>;
  getChatSessions(
    userId: string
  ): Promise<{ sessionId: string; lastMessage: string; createdAt: Date }[]>;

  // User Guide operations
  createUserGuide(guide: InsertUserGuide): Promise<UserGuide>;
  updateUserGuide(
    id: number,
    guide: Partial<InsertUserGuide>
  ): Promise<UserGuide>;
  deleteUserGuide(id: number): Promise<void>;
  getUserGuides(filters?: {
    category?: string;
    type?: string;
    isPublished?: boolean;
  }): Promise<UserGuide[]>;
  getUserGuideById(id: number): Promise<UserGuide | undefined>;
  incrementGuideViewCount(id: number): Promise<void>;

  // User Guide Category operations
  createUserGuideCategory(
    category: InsertUserGuideCategory
  ): Promise<UserGuideCategory>;
  updateUserGuideCategory(
    id: number,
    category: Partial<InsertUserGuideCategory>
  ): Promise<UserGuideCategory>;
  deleteUserGuideCategory(id: number): Promise<void>;
  getUserGuideCategories(): Promise<UserGuideCategory[]>;

  // Department operations
  createDepartment(department: InsertDepartment): Promise<Department>;
  updateDepartment(
    id: number,
    department: Partial<InsertDepartment>
  ): Promise<Department>;
  deleteDepartment(id: number): Promise<void>;
  getAllDepartments(): Promise<Department[]>;
  getDepartmentById(id: number): Promise<Department | undefined>;

  // User Invitation operations
  createUserInvitation(
    invitation: InsertUserInvitation
  ): Promise<UserInvitation>;
  getUserInvitations(filters?: { status?: string }): Promise<UserInvitation[]>;
  getUserInvitationByToken(token: string): Promise<UserInvitation | undefined>;
  markInvitationAccepted(id: number): Promise<UserInvitation>;
  deleteExpiredInvitations(): Promise<void>;

  // Teams Integration operations
  getTeamsIntegrationSettings(
    userId: string
  ): Promise<TeamsIntegrationSettings | undefined>;
  upsertTeamsIntegrationSettings(
    settings: InsertTeamsIntegrationSettings
  ): Promise<TeamsIntegrationSettings>;
  deleteTeamsIntegrationSettings(userId: string): Promise<void>;

  // SSO Configuration operations
  getSsoConfiguration(): Promise<SsoConfiguration | undefined>;
  upsertSsoConfiguration(
    config: InsertSsoConfiguration
  ): Promise<SsoConfiguration>;

  // Bedrock usage tracking
  trackBedrockUsage(usage: InsertBedrockUsage): Promise<BedrockUsage>;
  getBedrockUsageByUser(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<BedrockUsage[]>;
  getBedrockUsageSummary(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
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

  // Company Policy operations
  createCompanyPolicy(policy: InsertCompanyPolicy): Promise<CompanyPolicy>;
  updateCompanyPolicy(
    id: number,
    policy: Partial<InsertCompanyPolicy>
  ): Promise<CompanyPolicy>;
  deleteCompanyPolicy(id: number): Promise<void>;
  getCompanyPolicyById(id: number): Promise<CompanyPolicy | undefined>;
  getAllCompanyPolicies(includeInactive?: boolean): Promise<CompanyPolicy[]>;
  toggleCompanyPolicyStatus(id: number): Promise<CompanyPolicy>;

  // Notifications operations
  getUnreadNotifications(
    userId: string,
    limit?: number
  ): Promise<Notification[]>;
  markNotificationRead(id: number): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;
  createNotification(notification: InsertNotification): Promise<Notification>;

  // Knowledge Base operations
  createKnowledgeArticle(
    article: InsertKnowledgeArticle
  ): Promise<KnowledgeArticle>;
  updateKnowledgeArticle(
    id: number,
    article: Partial<InsertKnowledgeArticle>
  ): Promise<KnowledgeArticle>;
  deleteKnowledgeArticle(id: number): Promise<void>;
  getKnowledgeArticle(id: number): Promise<KnowledgeArticle | undefined>;
  getAllKnowledgeArticles(filters?: {
    category?: string;
    isPublished?: boolean;
    createdBy?: string;
    status?: string;
    source?: string;
  }): Promise<KnowledgeArticle[]>;
  getPublishedKnowledgeArticles(category?: string): Promise<KnowledgeArticle[]>;
  searchKnowledgeBase(
    query: string,
    category?: string
  ): Promise<KnowledgeArticle[]>;
  findSimilarKnowledgeArticle(
    title: string
  ): Promise<KnowledgeArticle | undefined>;
  toggleKnowledgeArticleStatus(id: number): Promise<KnowledgeArticle>;
  incrementKnowledgeArticleUsage(id: number): Promise<void>;
  updateArticleEffectiveness(id: number, rating: number): Promise<void>;
  setKnowledgeArticleStatus(
    id: number,
    status: "draft" | "published" | "archived"
  ): Promise<KnowledgeArticle>;
  incrementKnowledgeArticleView(id: number): Promise<void>;

  // Learning Queue operations
  addToLearningQueue(ticketId: number): Promise<LearningQueue>;
  getLearningQueueItems(status?: string): Promise<LearningQueue[]>;
  updateLearningQueueItem(
    id: number,
    updates: Partial<InsertLearningQueue>
  ): Promise<LearningQueue>;

  // AI Analysis and Learning Methods (legacy compatibility)
  saveTicketAnalysis(userId: string, analysis: any): Promise<void>;
  saveAutoResponse(data: any): Promise<void>;
  saveComplexityScore(data: any): Promise<void>;
  saveAIAnalytics(analytics: any): Promise<void>;
  getRecentResolvedTickets(days: number): Promise<Task[]>;
  updateKnowledgeLearningStats(stats: any): Promise<void>;

  // Stats operations
  getAgentStats(userId: string): Promise<{
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
  }>;
  getManagerStats(userId: string): Promise<{
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
  }>;
  getS3UsageStats(): Promise<{
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
  }>;
}
