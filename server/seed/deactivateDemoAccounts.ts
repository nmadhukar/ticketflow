import { eq, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../storage/db";
import { comparePasswords } from "../services/auth";
import { DEMO_ACCOUNTS } from "./demoAccounts";
import { describeError } from "../http/errors";

/**
 * Older deployments ran the demo seeders and still carry accounts with
 * published passwords. Deactivate (never delete) every active account whose
 * email is a known demo email AND whose stored hash still verifies against the
 * published password; an account whose password was changed is left alone.
 * Skipped when SEED_DEMO_DATA=true. Idempotent. Logs counts, emails and error types only.
 *
 * Failures (M8): one account's failure never stops the others being checked.
 * A stored hash that cannot be read is skipped (that account cannot sign in
 * either: login runs the same comparison). A failed lookup or update is
 * different, the account may still be live with a published password, so once
 * every account has been tried the function throws, and startup stops.
 */
export async function deactivateDemoAccounts(
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  if (env.SEED_DEMO_DATA === "true") return [];

  const deactivated: string[] = [];
  const unchecked: string[] = [];
  for (const demo of DEMO_ACCOUNTS) {
    let row: typeof users.$inferSelect | undefined;
    try {
      [row] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${demo.email}`)
        .limit(1);
    } catch (error) {
      unchecked.push(demo.email);
      console.error(`Could not look up demo account ${demo.email} [${describeError(error)}]`);
      continue;
    }
    if (!row || !row.isActive || !row.password) continue;

    let published: boolean;
    try {
      published = await comparePasswords(demo.password, row.password);
    } catch (error) {
      console.error(
        `Could not check demo account ${demo.email}; skipping it: its stored hash is unreadable, so it cannot sign in [${describeError(error)}]`
      );
      continue;
    }
    if (!published) continue;

    try {
      await db.update(users).set({ isActive: false }).where(eq(users.id, row.id));
      deactivated.push(demo.email);
    } catch (error) {
      unchecked.push(demo.email);
      console.error(`Could not deactivate demo account ${demo.email} [${describeError(error)}]`);
    }
  }
  if (deactivated.length > 0) {
    console.warn(
      `Deactivated ${deactivated.length} demo account(s) that still had the published demo password: ${deactivated.join(", ")}`
    );
  }
  if (unchecked.length > 0) {
    throw new Error(`Demo account check failed for ${unchecked.length} account(s): ${unchecked.join(", ")}`);
  }
  return deactivated;
}
