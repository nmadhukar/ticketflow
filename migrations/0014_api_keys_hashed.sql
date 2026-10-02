-- Migration: API keys are hashed and admin-issued
-- Production applies the schema with drizzle-kit push, which never runs data SQL. So:
--   * the index below is declared in shared/schema.ts (apiKeys) and created by push;
--   * the deactivation is run at every startup by server/seed/legacyApiKeyFixup.ts
--     (wired in server/seed/runSeeders.ts).
-- This file is the idempotent record of both.

-- Legacy rows stored the plaintext key in key_hash. They can never match a presented
-- key, so switch them off. Nothing is deleted.
UPDATE "api_keys" SET "is_active" = false
WHERE "key_hash" NOT LIKE 'sha256:%' AND "is_active" IS NOT FALSE;

-- Hashes are unique. Partial, so legacy rows (plaintext, possibly duplicated) can
-- never make this statement, or `drizzle-kit push`, fail.
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_sha256_uniq"
  ON "api_keys" ("key_hash")
  WHERE "key_hash" LIKE 'sha256:%';
