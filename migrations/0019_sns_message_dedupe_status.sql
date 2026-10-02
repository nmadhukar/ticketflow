-- Migration: claim state for the SNS MessageId dedupe (POST /api/email/inbound)
-- A claim is 'processing' while the message is being handled and 'done' once its ticket or
-- comment is committed. A 'processing' claim older than 10 minutes (a crashed process) may be
-- claimed again; 'done' is final. Rows that already exist were completed or abandoned
-- deliveries from before this column, so they become 'done'. Production applies the schema
-- with drizzle-kit push (shared/schema.ts, snsMessageDedupe); this file is the idempotent record.
ALTER TABLE "sns_message_dedupe" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'done' NOT NULL;
