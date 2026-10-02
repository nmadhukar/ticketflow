import { and, eq, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { users } from "@shared/schema";
import { db } from "../storage/db";
import { hashPassword } from "../services/auth";

/**
 * First-run admin. When no ACTIVE admin who can log in exists (the
 * passwordless "system" user does not count), create one from ADMIN_EMAIL and
 * ADMIN_PASSWORD. With either unset nothing is created. The password is never
 * logged.
 */
export async function seedBootstrapAdmin(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        eq(users.isActive, true),
        isNotNull(users.password)
      )
    )
    .limit(1);
  if (existing) return;

  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn(
      "No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin."
    );
    return;
  }

  // The email may already belong to a non-admin, inactive or SSO account:
  // leave it exactly as it is and say so, rather than failing on the insert.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  if (taken) {
    console.warn(
      `ADMIN_EMAIL ${email.toLowerCase()} already belongs to an existing account that is not an active admin with a password. No admin was created and that account was not changed. Promote it in the database or choose a different ADMIN_EMAIL.`
    );
    return;
  }

  await db.insert(users).values({
    id: randomUUID(),
    email,
    password: await hashPassword(password),
    firstName: "System",
    lastName: "Administrator",
    role: "admin",
    isActive: true,
    isApproved: true,
  });
  console.log(`Bootstrap admin created: ${email}`);
}
