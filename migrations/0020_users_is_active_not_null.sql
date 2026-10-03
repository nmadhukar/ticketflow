-- Migration: users.is_active becomes NOT NULL (default true)
-- A NULL in this column was read as "inactive" by every sign-in, session and listing check, so a
-- row with NULL silently could not sign in and no screen said why. Rows that already hold NULL
-- keep exactly the behaviour they have today: they become false (inactive), never true, so no
-- account is switched ON by this migration. Nothing is deleted.
-- Production applies the schema with drizzle-kit push (shared/schema.ts, users.isActive); this
-- file runs first (db:migrate-sql) so push finds no NULLs, and is the idempotent record:
-- every statement is safe to run again.
UPDATE "users" SET "is_active" = false WHERE "is_active" IS NULL;
ALTER TABLE "users" ALTER COLUMN "is_active" SET DEFAULT true;
ALTER TABLE "users" ALTER COLUMN "is_active" SET NOT NULL;
