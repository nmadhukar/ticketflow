import { eq, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../storage/db";
import { comparePasswords } from "../services/auth";
import { DEMO_ACCOUNTS } from "./demoAccounts";

/**
 * Older deployments ran the demo seeders and still carry accounts with
 * published passwords. Deactivate (never delete) every active account whose
 * email is a known demo email AND whose stored hash still verifies against the
 * published password; an account whose password was changed is left alone.
 * A failure on one account is logged and skipped. Skipped when SEED_DEMO_DATA=true. Idempotent. Logs counts and emails only.
 */
export async function deactivateDemoAccounts(
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  if (env.SEED_DEMO_DATA === "true") return [];

  const deactivated: string[] = [];
  for (const demo of DEMO_ACCOUNTS) {
    const [row] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${demo.email}`)
      .limit(1);
    if (!row || !row.isActive || !row.password) continue;
    try {
      if (!(await comparePasswords(demo.password, row.password))) continue;
      await db.update(users).set({ isActive: false }).where(eq(users.id, row.id));
      deactivated.push(demo.email);
    } catch (error) {
      // One bad row (e.g. a malformed stored hash) must not stop the rest.
      console.error(
        `Could not check demo account ${demo.email}; skipping it:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  if (deactivated.length > 0) {
    console.warn(
      `Deactivated ${deactivated.length} demo account(s) that still had the published demo password: ${deactivated.join(", ")}`
    );
  }
  return deactivated;
}
