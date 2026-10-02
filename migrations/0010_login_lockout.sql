-- Migration: Login lockout
-- Five wrong passwords lock the account for 15 minutes (server/services/auth/lockout.ts).
-- Idempotent: safe to run on a database that drizzle-kit push already updated.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;
