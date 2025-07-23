import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  serial,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  password: varchar("password"), // hashed password
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { length: 50 }).notNull().default("user"), // user, admin, manager, customer
  department: varchar("department", { length: 100 }),
  phone: varchar("phone", { length: 50 }),
  isActive: boolean("is_active").default(true),
  isApproved: boolean("is_approved").default(false), // Admin must approve before login
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Departments table
export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Teams table
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

// Team members junction table
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").references(() => teams.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  role: varchar("role", { length: 50 }).default("member"), // admin, member
  joinedAt: timestamp("joined_at").defaultNow(),
});

// Tasks table
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  ticketNumber: varchar("ticket_number", { length: 20 }).unique().notNull(), // e.g., TKT-2024-0001
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull(), // bug, feature, support, enhancement, incident, request
  status: varchar("status", { length: 50 }).notNull().default("open"), // open, in_progress, resolved, closed, on_hold
  priority: varchar("priority", { length: 20 }).notNull().default("medium"), // low, medium, high, urgent
  severity: varchar("severity", { length: 20 }).default("normal"), // minor, normal, major, critical
  notes: text("notes"), // Progress notes and updates
  assigneeId: varchar("assignee_id").references(() => users.id),
  assigneeType: varchar("assignee_type", { length: 20 }).default("user"), // user, team
  assigneeTeamId: integer("assignee_team_id").references(() => teams.id),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  dueDate: timestamp("due_date"),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  estimatedHours: integer("estimated_hours"),
  actualHours: integer("actual_hours"),
  tags: text("tags").array(), // Array of tags for better categorization
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Task comments/notes
export const taskComments = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => tasks.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Task history for audit trail
export const taskHistory = pgTable("task_history", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => tasks.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  action: varchar("action", { length: 50 }).notNull(), // created, updated, assigned, status_changed, etc.
  oldValue: text("old_value"),
  newValue: text("new_value"),
  field: varchar("field", { length: 50 }), // status, assignee, priority, etc.
  createdAt: timestamp("created_at").defaultNow(),
});

// File attachments for tasks
export const taskAttachments = pgTable("task_attachments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => tasks.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileSize: integer("file_size").notNull(), // in bytes
  fileType: varchar("file_type", { length: 100 }).notNull(),
  fileUrl: text("file_url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Company settings (for branding)
export const companySettings = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyName: varchar("company_name", { length: 255 }).notNull().default("TicketFlow"),
  logoUrl: text("logo_url"),
  primaryColor: varchar("primary_color", { length: 7 }).default("#3b82f6"), // hex color
  ticketPrefix: varchar("ticket_prefix", { length: 10 }).notNull().default("TKT"), // Configurable ticket prefix
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// API keys for third-party integrations
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull(), // hashed API key
  keyPrefix: varchar("key_prefix", { length: 10 }).notNull(), // first few chars for identification
  permissions: text("permissions").array().default([]), // array of permission strings
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// SMTP settings for email notifications (also used for AWS SES)
export const smtpSettings = pgTable("smtp_settings", {
  id: serial("id").primaryKey(),
  // AWS SES settings
  awsAccessKeyId: varchar("aws_access_key_id", { length: 255 }),
  awsSecretAccessKey: varchar("aws_secret_access_key", { length: 255 }), // encrypted
  awsRegion: varchar("aws_region", { length: 50 }).default("us-east-1"),
  // SMTP settings (can be used as fallback) - nullable for AWS SES usage
  host: varchar("host", { length: 255 }),
  port: integer("port").default(587),
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }), // encrypted
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }).notNull().default("TicketFlow"),
  encryption: varchar("encryption", { length: 10 }).default("tls"), // tls, ssl, none
  useAwsSes: boolean("use_aws_ses").default(true), // Toggle between AWS SES and SMTP
  isActive: boolean("is_active").default(true),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Email templates
export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(), // ticket_created, ticket_updated, etc.
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(), // HTML template with variables
  variables: text("variables").array().default([]), // available template variables
  isActive: boolean("is_active").default(true),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  createdTasks: many(tasks, { relationName: "taskCreator" }),
  assignedTasks: many(tasks, { relationName: "taskAssignee" }),
  teamMemberships: many(teamMembers),
  comments: many(taskComments),
  history: many(taskHistory),
  attachments: many(taskAttachments),
  apiKeys: many(apiKeys),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  creator: one(users, {
    fields: [teams.createdBy],
    references: [users.id],
  }),
  members: many(teamMembers),
  assignedTasks: many(tasks, { relationName: "teamAssignedTasks" }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  creator: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
    relationName: "taskCreator",
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
    relationName: "taskAssignee",
  }),
  assigneeTeam: one(teams, {
    fields: [tasks.assigneeTeamId],
    references: [teams.id],
    relationName: "teamAssignedTasks",
  }),
  comments: many(taskComments),
  history: many(taskHistory),
  attachments: many(taskAttachments),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskComments.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [taskComments.userId],
    references: [users.id],
  }),
}));

export const taskHistoryRelations = relations(taskHistory, ({ one }) => ({
  task: one(tasks, {
    fields: [taskHistory.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [taskHistory.userId],
    references: [users.id],
  }),
}));

export const taskAttachmentsRelations = relations(taskAttachments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskAttachments.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [taskAttachments.userId],
    references: [users.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// Zod schemas
export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  assigneeId: z.string().nullable().optional(),
  assigneeTeamId: z.number().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional().or(z.string().nullable().optional()),
});

export const insertTeamSchema = createInsertSchema(teams).omit({
  id: true,
  createdAt: true,
});

export const insertTaskCommentSchema = createInsertSchema(taskComments).omit({
  id: true,
  createdAt: true,
});

export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({
  id: true,
  joinedAt: true,
});

// Insert schemas for new tables
export const insertTaskAttachmentSchema = createInsertSchema(taskAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({
  id: true,
  updatedAt: true,
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
  keyHash: true,
  keyPrefix: true,
}).extend({
  expiresAt: z.string().datetime().nullable().optional(),
});

export const insertSmtpSettingsSchema = createInsertSchema(smtpSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({
  id: true,
  updatedAt: true,
});

// User insert schema
export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
  passwordResetToken: true,
  passwordResetExpires: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Help documentation table
export const helpDocuments = pgTable("help_documents", {
  id: serial("id").primaryKey(),
  title: varchar("title").notNull(),
  filename: varchar("filename").notNull(),
  content: text("content").notNull(), // Extracted text content for search
  fileData: text("file_data").notNull(), // Base64 encoded file data
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  category: varchar("category"),
  tags: text("tags").array(),
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Chat messages table
export const aiChatMessages = pgTable("ai_chat_messages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  sessionId: varchar("session_id").notNull(), // Group messages by chat session
  role: varchar("role", { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  relatedDocumentIds: integer("related_document_ids").array(), // IDs of help documents referenced
  createdAt: timestamp("created_at").defaultNow(),
});

// User invitations table
export const userInvitations = pgTable("user_invitations", {
  id: serial("id").primaryKey(),
  email: varchar("email").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  department: varchar("department", { length: 100 }),
  departmentId: integer("department_id").references(() => departments.id),
  invitedBy: varchar("invited_by").references(() => users.id).notNull(),
  invitationToken: varchar("invitation_token").unique().notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, accepted, expired
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Microsoft Teams integration settings
export const teamsIntegrationSettings = pgTable("teams_integration_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull().unique(),
  enabled: boolean("enabled").default(false),
  teamId: varchar("team_id"),
  teamName: varchar("team_name"),
  channelId: varchar("channel_id"),
  channelName: varchar("channel_name"),
  webhookUrl: text("webhook_url"),
  notificationTypes: text("notification_types").array().default([]), // ticket_created, ticket_updated, ticket_assigned, etc.
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type HelpDocument = typeof helpDocuments.$inferSelect;
export type InsertHelpDocument = typeof helpDocuments.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type InsertAiChatMessage = typeof aiChatMessages.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type TaskComment = typeof taskComments.$inferSelect;
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;
export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TaskHistory = typeof taskHistory.$inferSelect;
export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = z.infer<typeof insertTaskAttachmentSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type SmtpSettings = typeof smtpSettings.$inferSelect;
export type InsertSmtpSettings = z.infer<typeof insertSmtpSettingsSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;

// User Guides table
export const userGuides = pgTable("user_guides", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // 'scribehow', 'html', 'video'
  content: text("content").notNull(), // For HTML content or embed codes
  scribehowUrl: varchar("scribehow_url", { length: 500 }), // For Scribehow links
  videoUrl: varchar("video_url", { length: 500 }), // For video embeds
  tags: text("tags").array(), // For searchability
  isPublished: boolean("is_published").default(true),
  viewCount: integer("view_count").default(0),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Guide Categories table
export const userGuideCategories = pgTable("user_guide_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }), // Icon name for UI
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Create schemas
export const insertUserGuideSchema = createInsertSchema(userGuides).omit({
  id: true,
  viewCount: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserGuideCategorySchema = createInsertSchema(userGuideCategories).omit({
  id: true,
  createdAt: true,
});

export type UserGuide = typeof userGuides.$inferSelect;
export type InsertUserGuide = z.infer<typeof insertUserGuideSchema>;
export type UserGuideCategory = typeof userGuideCategories.$inferSelect;
export type InsertUserGuideCategory = z.infer<typeof insertUserGuideCategorySchema>;

// Department schemas and types
export const insertDepartmentSchema = createInsertSchema(departments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Department = typeof departments.$inferSelect;
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;

// User invitation schemas and types
export const insertUserInvitationSchema = createInsertSchema(userInvitations).omit({
  id: true,
  invitationToken: true,
  acceptedAt: true,
  createdAt: true,
}).extend({
  expiresAt: z.string().datetime(),
});

export type UserInvitation = typeof userInvitations.$inferSelect;
export type InsertUserInvitation = z.infer<typeof insertUserInvitationSchema>;

// Teams integration schemas and types
export const insertTeamsIntegrationSettingsSchema = createInsertSchema(teamsIntegrationSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TeamsIntegrationSettings = typeof teamsIntegrationSettings.$inferSelect;
export type InsertTeamsIntegrationSettings = z.infer<typeof insertTeamsIntegrationSettingsSchema>;

// SSO Configuration table for storing Microsoft 365 SSO settings
export const ssoConfiguration = pgTable('sso_configuration', {
  id: serial('id').primaryKey(),
  clientId: varchar('client_id'),
  clientSecret: varchar('client_secret'),
  tenantId: varchar('tenant_id'),
  updatedBy: varchar('updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// SSO configuration schemas and types
export const insertSsoConfigurationSchema = createInsertSchema(ssoConfiguration).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SsoConfiguration = typeof ssoConfiguration.$inferSelect;
export type InsertSsoConfiguration = z.infer<typeof insertSsoConfigurationSchema>;
