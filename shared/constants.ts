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
