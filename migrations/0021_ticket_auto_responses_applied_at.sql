-- Migration: ticket_auto_responses.applied_at (R48)
-- When an AI draft was applied (its comment posted). The ai-analytics "tickets resolved by AI"
-- count used to INFER this from the earliest AI comment created after the draft, which could
-- borrow another draft's earlier comment and over-count. A row applied before this column
-- existed keeps NULL (no backfill) and is still counted by the old rule.
-- Production applies the schema with drizzle-kit push (shared/schema.ts, ticketAutoResponses);
-- this file runs first (db:migrate-sql) and is the idempotent record.
-- This file has not been deployed anywhere yet, so it is still safe to guard it. It runs against
-- every database in turn and must never abort the deploy: on a database that has no
-- ticket_auto_responses table (older than the table's own migration) it reports and leaves it to
-- drizzle-kit push, which creates the table with this column. The check is the narrow one: an
-- absent table, not "any error", so a real failure still stops the deploy.
DO $$
BEGIN
  IF to_regclass('ticket_auto_responses') IS NULL THEN
    RAISE NOTICE '0021: table ticket_auto_responses is absent; skipping (drizzle-kit push creates it with applied_at)';
  ELSE
    ALTER TABLE "ticket_auto_responses" ADD COLUMN IF NOT EXISTS "applied_at" timestamp;
  END IF;
END
$$;
