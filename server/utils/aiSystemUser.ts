import { and, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../storage/db";

/**
 * The one account AI-written comments are attributed to. It is identified by
 * this constant (its id), never by display name. It is a real `users` row so
 * the comment foreign key holds, but it is never a person: no password, never
 * active, never approved, so no sign-in path (local login, password reset,
 * SSO, session deserialize) accepts it. See migrations/0013_ai_system_user.sql
 * (the idempotent record of the same row; production creates it here).
 */
import { AI_SYSTEM_USER_EMAIL, AI_SYSTEM_USER_ID, SYSTEM_ACCOUNT_IDS } from "./aiSystemUserId";

export {
  AI_SYSTEM_USERNAME,
  AI_SYSTEM_USER_ID,
  AI_SYSTEM_USER_EMAIL,
  LEGACY_SYSTEM_USER_ID,
  SYSTEM_ACCOUNT_IDS,
  isAiSystemUserId,
  isSystemAccountId,
} from "./aiSystemUserId";

/**
 * WHERE fragment for any listing, picker or count over `users`: leaves out
 * both system accounts (the AI user and the legacy "system" user).
 */
export function excludeSystemAccounts(): SQL {
  return notInArray(users.id, [...SYSTEM_ACCOUNT_IDS]);
}

/**
 * Creates the AI system user, or puts a tampered row back (password removed,
 * inactive, unapproved, role agent). Idempotent; runs at every startup and on
 * demand before the first AI comment. Returns the id.
 *
 * If a DIFFERENT account already holds the AI user's email, it is not ours to
 * touch and startup must not stop: one loud log line (ids only, no email), and
 * the function returns null. Callers then post no AI comment at all (AI
 * authorship is disabled until the clash is resolved); they never fall back to
 * the customer's or another user's id.
 */
export async function ensureAiSystemUser(): Promise<string | null> {
  const locked = {
    role: "agent",
    password: null,
    isActive: false,
    isApproved: false,
    passwordResetToken: null,
    passwordResetExpires: null,
  };
  try {
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(ne(users.id, AI_SYSTEM_USER_ID), sql`lower(${users.email}) = ${AI_SYSTEM_USER_EMAIL}`))
      .limit(1);
    if (clash) {
      console.error(
        `AI system user NOT created: user ${clash.id} already holds its email. AI comments are disabled until that is resolved.`
      );
      return null;
    }
    await db
      .insert(users)
      .values({
        id: AI_SYSTEM_USER_ID,
        email: AI_SYSTEM_USER_EMAIL,
        firstName: "AI",
        lastName: "Assistant",
        ...locked,
      })
      .onConflictDoUpdate({ target: users.id, set: locked });
    return AI_SYSTEM_USER_ID;
  } catch (error) {
    // 23505 from a race with the check above: same outcome as a clash.
    if ((error as { code?: string })?.code === "23505") {
      console.error("AI system user NOT created: unique violation on its email. AI comments are disabled until that is resolved.");
      return null;
    }
    throw error;
  }
}
