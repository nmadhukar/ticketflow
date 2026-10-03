import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

/**
 * Seeds the e2e users straight into the e2e database through the app's own
 * storage and hash functions. The demo accounts are not used: startup
 * deactivates demo logins still on their published passwords.
 */
export const E2E_USERS = {
  customerA: { email: "e2e-customer-a@example.test", role: "customer", env: "E2E_CUSTOMER_A_PASSWORD" },
  customerB: { email: "e2e-customer-b@example.test", role: "customer", env: "E2E_CUSTOMER_B_PASSWORD" },
  agent: { email: "e2e-agent@example.test", role: "agent", env: "E2E_AGENT_PASSWORD" },
  admin: { email: "e2e-admin@example.test", role: "admin", env: "E2E_ADMIN_PASSWORD" },
} as const;

export default async function globalSetup(): Promise<void> {
  // server/storage reads DATABASE_URL at import time.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { storage } = await import("../server/storage");
  const { db, pool } = await import("../server/storage/db");
  const { hashPassword } = await import("../server/services/auth");
  const { users, bedrockSettings, emailProviders, teamsIntegrationSettings } = await import("../shared/schema");

  try {
    // No credential held in the database may trigger an outbound call during the
    // run: drop Bedrock settings, email providers and Teams webhooks (earlier
    // integration runs on this database may have stored fake ones), then store
    // one credential-less Bedrock row with auto-response and auto-learn OFF
    // (with no row at all the app defaults auto-response to ON).
    await db.delete(bedrockSettings);
    await db.delete(emailProviders);
    await db.delete(teamsIntegrationSettings);
    await db.insert(bedrockSettings).values({ autoResponseEnabled: false, autoLearnEnabled: false });

    for (const spec of Object.values(E2E_USERS)) {
      const password = await hashPassword(process.env[spec.env]!);
      const [existing] = await db.select().from(users).where(eq(users.email, spec.email));
      if (existing) {
        await db
          .update(users)
          .set({ password, role: spec.role, isActive: true, isApproved: true, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null })
          .where(eq(users.id, existing.id));
        continue;
      }
      await storage.createUser({
        id: randomUUID(),
        email: spec.email,
        password,
        firstName: spec.role,
        lastName: "E2E",
        role: spec.role,
        isApproved: true,
        isActive: true,
        mustChangePassword: false,
      });
    }
  } finally {
    await pool.end();
  }
}
