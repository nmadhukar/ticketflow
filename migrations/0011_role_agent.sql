-- Migration: role vocabulary and forced password change
-- Owner decision 2026-10-01: the legacy role "user" means agent.
-- Production applies the schema with drizzle-kit push, which never runs data SQL, so the same
-- UPDATE also runs at startup (server/seed/legacyRoleFixup.ts). Idempotent in every part.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp;

UPDATE "users" SET "role" = 'agent' WHERE "role" = 'user';
UPDATE "user_invitations" SET "role" = 'agent' WHERE "role" = 'user';

-- Self-registration is a customer; staff come through invitations.
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'customer';
ALTER TABLE "user_invitations" ALTER COLUMN "role" SET DEFAULT 'agent';
