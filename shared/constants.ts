/**
 * Shared Constants for TicketFlow
 *
 * This file contains constants used across the application for consistency
 * and type safety.
 */

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "closed",
  "on_hold",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CATEGORIES = [
  "bug",
  "feature",
  "support",
  "enhancement",
  "incident",
  "request",
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_SEVERITIES = [
  "minor",
  "normal",
  "major",
  "critical",
] as const;

export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

export const USER_ROLES = {
  CUSTOMER: "customer",
  USER: "user",
  MANAGER: "manager",
  ADMIN: "admin",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const DEFAULT_COMPANY = {
  NAME: "TicketFlow",
  BRANDING: {
    PRIMARY_COLOR: "#3b82f6",
    MAX_UPLOAD_MB: 10,
  },
  TICKETS: {
    AUTO_CLOSE_DAYS: 7,
    DEFAULT_PRIORITY: "medium" as const,
  },
  PREFERENCES: {
    TIMEZONE: "UTC",
    DATE_FORMAT: "YYYY-MM-DD",
    TIME_FORMAT: "24h" as const,
  },
  EMAIL: {
    FROM_EMAIL: "noreply@dsigsoftware.com",
    FROM_NAME: "Helpdesk Support",
  },
};

export const EMAIL_PROVIDERS = {
  MAILTRAP: "mailtrap",
  AWS: "aws-ses",
  SMTP: "smtp",
  MAILGUN: "mailgun",
  SENDGRID: "sendgrid",
  CUSTOM: "custom",
} as const;

export type EmailProviderId =
  (typeof EMAIL_PROVIDERS)[keyof typeof EMAIL_PROVIDERS];
