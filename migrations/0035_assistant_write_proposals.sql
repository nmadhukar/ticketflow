-- Migration: assistant_write_proposals (assistant sidecar plan, Stage 7)
-- Writes the in-app assistant proposed and the user's decision on each. The assistant never writes
-- a ticket or comment itself: the user's Confirm executes a proposal once, as that user, through
-- the normal ticket service (server/assistant/proposals.ts).
-- Numbered 0035 on purpose: 0031 and 0032 are held by the open feat/ai-triage-routing branch, and
-- 0033/0034 by the assistant's usage and audit tables (Stage 8). scripts/apply-sql-migrations.mjs
-- applies files in name order and does not require consecutive numbers.
-- Production applies the schema with drizzle-kit push (shared/schema.ts, assistantWriteProposals);
-- this file runs first (db:migrate-sql) and is the idempotent record: safe to run again, and it
-- never aborts (a missing users or tasks table is reported with a NOTICE and left to push).
DO $$
BEGIN
  IF to_regclass('users') IS NULL OR to_regclass('tasks') IS NULL THEN
    RAISE NOTICE '0035: assistant_write_proposals not created, table users or tasks is absent (drizzle-kit push creates it); skipping';
  ELSE
    CREATE TABLE IF NOT EXISTS assistant_write_proposals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      user_id varchar NOT NULL CONSTRAINT assistant_write_proposals_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
      agent_id varchar(40) NOT NULL,
      run_id uuid NOT NULL,
      action varchar(32) NOT NULL,
      ticket_id integer CONSTRAINT assistant_write_proposals_ticket_id_tasks_id_fk REFERENCES tasks(id) ON DELETE CASCADE,
      payload jsonb,
      payload_sha256 varchar(64) NOT NULL,
      status varchar(16) DEFAULT 'pending' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      expires_at timestamp NOT NULL,
      decided_at timestamp,
      result_ref varchar(40),
      failure_code varchar(40),
      CONSTRAINT assistant_proposals_action_check CHECK (action IN ('create_ticket', 'add_comment')),
      CONSTRAINT assistant_proposals_status_check CHECK (status IN ('pending', 'executing', 'executed', 'rejected', 'expired', 'failed'))
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_proposals_dedupe
      ON assistant_write_proposals (user_id, action, payload_sha256, created_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_proposals_status_expires
      ON assistant_write_proposals (status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_proposals_created_at
      ON assistant_write_proposals (created_at);
  END IF;
END $$;
