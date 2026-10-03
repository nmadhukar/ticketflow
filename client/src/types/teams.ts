/**
 * Type definitions for Teams, Team Admins, and Team Task Assignments
 */

export interface User {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
}

export interface TeamMember {
  id: number;
  teamId: number;
  userId: string;
  joinedAt: string | Date;
  user: User;
  isAdmin: boolean; // Replaces the old 'role' field
}

export interface TeamAdmin {
  id: number;
  teamId: number;
  userId: string;
  grantedBy: string;
  grantedAt: string | Date;
  permissions?: string[] | null;
  user: User;
  grantedByUser: User;
}

export interface TeamPermissions {
  canManageTeam: boolean;
  isTeamAdmin: boolean;
  isTeamCreator: boolean;
}

export interface TeamTaskAssignment {
  id: number;
  taskId: number;
  teamId: number;
  assignedUserId: string | null;
  assignedBy: string;
  assignedAt: string | Date;
  status: "active" | "completed" | "reassigned" | "cancelled";
  completedAt: string | Date | null;
  notes: string | null;
  priority: string | null;
  assignedUser: User | null;
  assignedByUser: User;
}

export interface Task {
  id: number;
  ticketNumber: string;
  title: string;
  description?: string | null;
  category: string;
  status: string;
  priority: string;
  assigneeType: "user" | "team";
  assigneeTeamId?: number | null;
  assigneeId?: string | null;
  createdBy: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

