/**
 * System User Utility
 *
 * Provides a consistent way to get or create the system user for AI-generated actions.
 * The system user is used for:
 * - AI auto-responses
 * - System-generated comments
 * - Automated ticket assignments
 * - Other system actions that need user attribution
 */

import { db } from "../storage/db";
import { logRouteError } from "../http/errors";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export const SYSTEM_USER_ID = "system";
export const SYSTEM_USER_EMAIL = "system@ticketflow.local";

/**
 * Get or create the system user
 * @returns System user ID
 */
export async function getSystemUserId(): Promise<string> {
  // Check if system user exists
  const [systemUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, SYSTEM_USER_ID))
    .limit(1);

  if (systemUser) {
    return SYSTEM_USER_ID;
  }

  // If system user doesn't exist, create it
  try {
    await db.insert(users).values({
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      firstName: "System",
      lastName: "User",
      role: "admin",
      isActive: true,
      isApproved: true,
      // No password - system user cannot login
    });
    console.log("System user created automatically");
    return SYSTEM_USER_ID;
  } catch (error: any) {
    // If user already exists (race condition), just return the ID
    if (error.code === "23505") {
      // Unique constraint violation - user was created by another process
      return SYSTEM_USER_ID;
    }
    logRouteError("Error creating system user", error);
    throw new Error("System user not found and could not be created");
  }
}
