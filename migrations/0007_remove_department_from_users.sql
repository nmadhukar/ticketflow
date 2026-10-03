-- Migration: Remove department column from users table
-- Since departments are managed separately and users don't need direct department assignment

ALTER TABLE "users" DROP COLUMN IF EXISTS "department";

