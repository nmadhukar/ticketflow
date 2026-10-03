-- Migration: ticket_auto_responses.applied_at (R48)
-- When an AI draft was applied (its comment posted). The ai-analytics "tickets resolved by AI"
-- count used to INFER this from the earliest AI comment created after the draft, which could
-- borrow another draft's earlier comment and over-count. A row applied before this column
-- existed keeps NULL (no backfill) and is still counted by the old rule.
-- Production applies the schema with drizzle-kit push (shared/schema.ts, ticketAutoResponses);
-- this file runs first (db:migrate-sql) and is the idempotent record.
ALTER TABLE "ticket_auto_responses" ADD COLUMN IF NOT EXISTS "applied_at" timestamp;
