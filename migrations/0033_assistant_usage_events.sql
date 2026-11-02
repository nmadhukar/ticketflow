-- Migration: assistant_usage_events, and ai_usage.assistant_run_id (assistant sidecar plan, Stage 8)
-- One row per in-app assistant run: who, which agent and model, how it ended, how long it took,
-- which tools it called and how many writes it proposed. No conversation content, no tokens and
-- no cost: those stay in ai_usage, the one record of AI cost, whose rows for assistant runs carry
-- assistant_run_id (nullable; every other AI feature leaves it empty). Kept 90 days
-- (ASSISTANT_USAGE_RETENTION_DAYS).
-- Production applies the schema with drizzle-kit push (shared/schema.ts, assistantUsageEvents and
-- aiUsage.assistantRunId); this file runs first (db:migrate-sql) and is the idempotent record:
-- safe to run again, and it never aborts (a missing table is reported with a NOTICE and left to push).
DO $$
BEGIN
  IF to_regclass('users') IS NULL THEN
    RAISE NOTICE '0033: assistant_usage_events not created, table users is absent (drizzle-kit push creates it); skipping';
  ELSE
    CREATE TABLE IF NOT EXISTS assistant_usage_events (
      id serial PRIMARY KEY NOT NULL,
      run_id uuid NOT NULL,
      agent_id varchar(40) NOT NULL,
      user_id varchar CONSTRAINT assistant_usage_events_user_id_users_id_fk REFERENCES users(id) ON DELETE SET NULL,
      provider varchar(40),
      model varchar(255),
      started_at timestamp NOT NULL,
      duration_ms integer NOT NULL,
      status varchar(16) NOT NULL,
      error_category varchar(40),
      step_count integer DEFAULT 0 NOT NULL,
      tool_names text[] NOT NULL,
      proposal_count integer DEFAULT 0 NOT NULL,
      CONSTRAINT assistant_usage_events_run_id_unique UNIQUE (run_id),
      CONSTRAINT assistant_usage_status_check CHECK (status IN ('completed', 'failed', 'stopped', 'refused'))
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_usage_started_at ON assistant_usage_events (started_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_usage_agent_started ON assistant_usage_events (agent_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_usage_user_id ON assistant_usage_events (user_id);
  END IF;

  IF to_regclass('ai_usage') IS NULL THEN
    RAISE NOTICE '0033: table ai_usage is absent; assistant_run_id not added (drizzle-kit push creates it)';
  ELSE
    ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS assistant_run_id uuid;
    CREATE INDEX IF NOT EXISTS idx_ai_usage_assistant_run_id ON ai_usage (assistant_run_id);
  END IF;
END $$;
