-- Migration: SNS MessageId dedupe for inbound email (POST /api/email/inbound)
-- SNS delivers at least once; the endpoint records each MessageId it has handled so a
-- repeat delivery creates no second ticket or comment. Production applies the schema with
-- drizzle-kit push (shared/schema.ts, snsMessageDedupe); this file is the idempotent record.
CREATE TABLE IF NOT EXISTS "sns_message_dedupe" (
  "message_id" varchar(200) PRIMARY KEY NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL
);
