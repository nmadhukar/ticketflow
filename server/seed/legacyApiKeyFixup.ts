import { sql } from "drizzle-orm";
import { db } from "../storage/db";

/**
 * Startup data fix-up (production applies the schema with `drizzle-kit push`,
 * which never runs data SQL): API keys were once stored with key_hash equal to
 * the plaintext. Such a row can never match a presented key, so it is switched
 * off here rather than left looking active. Rows are kept, not deleted.
 * Idempotent; also recorded in migrations/0014_api_keys_hashed.sql. Logs counts
 * only, never a key. Returns the number of rows deactivated.
 */
export async function deactivateLegacyApiKeys(): Promise<number> {
  const res = await db.execute(
    sql`UPDATE api_keys SET is_active = false
        WHERE key_hash NOT LIKE 'sha256:%' AND is_active IS NOT FALSE
        RETURNING id`
  );
  const n = res.rows.length;
  if (n > 0) {
    console.log(`API key fix-up: deactivated ${n} legacy key(s) stored without a hash.`);
  }
  return n;
}
