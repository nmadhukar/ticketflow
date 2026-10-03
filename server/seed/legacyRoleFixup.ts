import { sql } from "drizzle-orm";
import { db } from "../storage/db";

/**
 * Startup data fix-up (production applies the schema with `drizzle-kit push`,
 * which never runs data SQL): the legacy role "user" means agent. Idempotent;
 * also recorded in migrations/0011_role_agent.sql. Logs counts only.
 * Returns the number of user rows converted.
 */
export async function migrateLegacyRoles(): Promise<number> {
  const converted = await db.execute(
    sql`UPDATE users SET role = 'agent' WHERE role = 'user' RETURNING id`
  );
  const invitations = await db.execute(
    sql`UPDATE user_invitations SET role = 'agent' WHERE role = 'user' RETURNING id`
  );
  const n = converted.rows.length;
  const m = invitations.rows.length;
  if (n > 0 || m > 0) {
    console.log(`Role fix-up: converted ${n} user(s) and ${m} invitation(s) from role "user" to "agent".`);
  }
  return n;
}
