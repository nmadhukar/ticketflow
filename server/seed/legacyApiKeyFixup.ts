import { sql } from "drizzle-orm";
import { db } from "../storage/db";

/** What a legacy plaintext key_hash is replaced with: this prefix + sha256 hex of the old value. */
export const LEGACY_REVOKED_PREFIX = "legacy-revoked:";

/**
 * Startup data fix-up (production applies the schema with `drizzle-kit push`,
 * which never runs data SQL): API keys were once stored with key_hash equal to
 * the plaintext. Such a row can never match a presented key, so it is switched
 * off here rather than left looking active, and (M6) its plaintext is replaced
 * by "legacy-revoked:" + sha256 hex of it, so no usable key stays at rest.
 * Rows are kept, not deleted. Idempotent: a "legacy-revoked:" value is never
 * hashed again, and a "sha256:" row is never touched. The deactivation is also
 * recorded in migrations/0014_api_keys_hashed.sql. Logs counts only, never a key.
 * Returns the number of rows deactivated.
 */
export async function deactivateLegacyApiKeys(): Promise<number> {
  const scrubbed = await db.execute(
    sql`UPDATE api_keys
        SET key_hash = ${LEGACY_REVOKED_PREFIX} || encode(sha256(convert_to(key_hash, 'UTF8')), 'hex')
        WHERE key_hash NOT LIKE 'sha256:%' AND key_hash NOT LIKE ${`${LEGACY_REVOKED_PREFIX}%`}
        RETURNING id`
  );
  const res = await db.execute(
    sql`UPDATE api_keys SET is_active = false
        WHERE key_hash NOT LIKE 'sha256:%' AND is_active IS NOT FALSE
        RETURNING id`
  );
  const n = res.rows.length;
  const s = scrubbed.rows.length;
  if (n > 0 || s > 0) {
    console.log(
      `API key fix-up: deactivated ${n} legacy key(s) stored without a hash; replaced ${s} stored plaintext value(s) with a one-way hash.`
    );
  }
  return n;
}
