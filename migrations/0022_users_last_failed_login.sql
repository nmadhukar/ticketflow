-- Migration: users.last_failed_login_at (R53, login failure counter decay)
-- The failure counter restarts at 1 when the lockout window (15 minutes) has passed since the
-- last failed attempt. This column records when that attempt was. It is never sent to clients.
-- A NULL (a row written before this column existed) is treated as before: its count carries on.
-- Production applies the schema with drizzle-kit push (shared/schema.ts, users.lastFailedLoginAt);
-- this file runs first (db:migrate-sql) and is the idempotent record: safe to run again.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_failed_login_at" timestamp;
