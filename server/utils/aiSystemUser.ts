import { ne, type SQL } from "drizzle-orm";
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
import { AI_SYSTEM_USER_EMAIL, AI_SYSTEM_USER_ID } from "./aiSystemUserId";

export {
  AI_SYSTEM_USERNAME,
  AI_SYSTEM_USER_ID,
  AI_SYSTEM_USER_EMAIL,
  isAiSystemUserId,
} from "./aiSystemUserId";

/** WHERE fragment for any listing, picker or count over `users`. */
export function excludeAiSystemUser(): SQL {
  return ne(users.id, AI_SYSTEM_USER_ID);
}

/**
 * Creates the AI system user, or puts a tampered row back (password removed,
 * inactive, unapproved, role agent). Idempotent; runs at every startup and on
 * demand before the first AI comment. Returns the id.
 */
export async function ensureAiSystemUser(): Promise<string> {
  const locked = {
    role: "agent",
    password: null,
    isActive: false,
    isApproved: false,
    passwordResetToken: null,
    passwordResetExpires: null,
  };
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
}
