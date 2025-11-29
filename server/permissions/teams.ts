import { IStorage } from "../storage/storage.inteface";
import { db } from "../storage/db";
import { teamAdmins, teams, departments } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Team Permissions Module
 *
 * Provides functions to check team management permissions.
 * Used to determine if a user can manage a team, grant admin status, etc.
 */

/**
 * Check if a user is a team admin for a specific team
 * @param storage - Storage instance
 * @param userId - User ID to check
 * @param teamId - Team ID to check
 * @returns Promise<boolean> - True if user is a team admin
 */
export async function isTeamAdmin(
  storage: IStorage,
  userId: string,
  teamId: number
): Promise<boolean> {
  const [admin] = await db
    .select()
    .from(teamAdmins)
    .where(and(eq(teamAdmins.userId, userId), eq(teamAdmins.teamId, teamId)))
    .limit(1);

  return !!admin;
}

/**
 * Check if a user can manage a team
 * A user can manage a team if they are:
 * - System admin (role === "admin")
 * - Team admin (in team_admins table)
 * - Team creator (teams.createdBy === userId)
 * - Manager of the department that the team belongs to
 *
 * @param storage - Storage instance
 * @param userId - User ID to check
 * @param teamId - Team ID to check
 * @returns Promise<boolean> - True if user can manage the team
 */
export async function canManageTeam(
  storage: IStorage,
  userId: string,
  teamId: number
): Promise<boolean> {
  // Get user to check role
  const user = await storage.getUser(userId);
  if (!user) {
    return false;
  }

  // System admins can manage any team
  if (user.role === "admin") {
    return true;
  }

  // Get team to check creator and department
  const team = await storage.getTeam(teamId);
  if (!team) {
    return false;
  }

  // Team creator can manage the team
  if (team.createdBy === userId) {
    return true;
  }

  // Check if user is a team admin
  const isAdmin = await isTeamAdmin(storage, userId, teamId);
  if (isAdmin) {
    return true;
  }

  // Managers can manage teams in their departments
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
      return true;
    }
  }

  return false;
}

/**
 * Check if a user can grant team admin status
 * Uses the same logic as canManageTeam
 *
 * @param storage - Storage instance
 * @param userId - User ID to check
 * @param teamId - Team ID to check
 * @returns Promise<boolean> - True if user can grant team admin status
 */
export async function canGrantTeamAdmin(
  storage: IStorage,
  userId: string,
  teamId: number
): Promise<boolean> {
  return canManageTeam(storage, userId, teamId);
}
