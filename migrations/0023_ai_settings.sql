-- Add provider-neutral AI settings without changing legacy Bedrock or S3 data.
-- Production applies the schema with drizzle-kit push (shared/schema.ts, aiSettings and aiUsage);
-- this file runs first (db:migrate-sql) and is the idempotent record: safe to run again.
-- It has not been deployed anywhere yet, so it is still safe to guard it. It runs against every
-- database in turn and must never abort the deploy. A database that has users but predates
-- bedrock_settings or ai_usage (older than the AI-settings-in-DB change, upgraded directly, before
-- push could create those tables) used to fail here with 42P01 and the container did not start.
-- Each step now reports through RAISE NOTICE and leaves the object to drizzle-kit push when the
-- table (or a column it copies) is absent. The checks are the narrow ones: an absent table or
-- column, never "any error", so a real failure still stops the deploy.

-- 1. ai_settings. Its foreign keys need teams and users.
DO $$
BEGIN
  IF to_regclass('teams') IS NULL OR to_regclass('users') IS NULL THEN
    RAISE NOTICE '0023: ai_settings not created, table teams or users is absent (drizzle-kit push creates it); skipping';
  ELSE
    CREATE TABLE IF NOT EXISTS ai_settings (
      id integer PRIMARY KEY DEFAULT 1 CONSTRAINT ai_settings_singleton_id CHECK (id = 1),
      model_id varchar(255) NOT NULL DEFAULT 'deepseek/deepseek-v4-pro',
      auto_response_enabled boolean DEFAULT true,
      confidence_threshold numeric(3,2) DEFAULT 0.7,
      max_response_length integer DEFAULT 1000,
      response_timeout integer DEFAULT 30,
      auto_learn_enabled boolean DEFAULT true,
      min_resolution_score numeric(3,2) DEFAULT 0.8,
      article_approval_required boolean DEFAULT true,
      complexity_threshold integer DEFAULT 70,
      escalation_enabled boolean DEFAULT true,
      escalation_team_id integer CONSTRAINT ai_settings_escalation_team_id_teams_id_fk REFERENCES teams(id),
      temperature numeric(3,2) DEFAULT 0.3,
      max_tokens integer DEFAULT 2000,
      daily_limit_usd numeric(10,2) DEFAULT 50.0,
      monthly_limit_usd numeric(10,2) DEFAULT 100.0,
      max_tokens_per_request integer DEFAULT 3000,
      max_requests_per_minute integer DEFAULT 20,
      is_active boolean DEFAULT true,
      updated_by varchar CONSTRAINT ai_settings_updated_by_users_id_fk REFERENCES users(id),
      updated_at timestamp DEFAULT now(),
      created_at timestamp DEFAULT now()
    );
  END IF;
END
$$;

-- 2. Copy the first active legacy row once. Needs ai_settings, bedrock_settings and every column
-- the copy reads (a bedrock_settings older than the cost-limit and AI-settings columns lacks some).
-- With no row copied, getAISettings reads AI as inactive, which is the safe state.
DO $$
DECLARE
  missing text;
BEGIN
  IF to_regclass('ai_settings') IS NULL THEN
    RAISE NOTICE '0023: table ai_settings is absent; skipping the copy from bedrock_settings';
  ELSIF to_regclass('bedrock_settings') IS NULL THEN
    RAISE NOTICE '0023: table bedrock_settings is absent; skipping the copy, there is nothing to copy';
  ELSE
    SELECT string_agg(wanted.name, ', ') INTO missing
    FROM unnest(ARRAY[
      'id', 'auto_response_enabled', 'confidence_threshold', 'max_response_length',
      'response_timeout', 'auto_learn_enabled', 'min_resolution_score', 'article_approval_required',
      'complexity_threshold', 'escalation_enabled', 'escalation_team_id', 'temperature', 'max_tokens',
      'daily_limit_usd', 'monthly_limit_usd', 'max_tokens_per_request', 'max_requests_per_minute',
      'is_active', 'updated_by', 'updated_at', 'created_at'
    ]) AS wanted(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = to_regclass('bedrock_settings')
        AND a.attname = wanted.name
        AND a.attnum > 0
        AND NOT a.attisdropped
    );
    IF missing IS NOT NULL THEN
      RAISE NOTICE '0023: table bedrock_settings lacks column(s) %; skipping the copy', missing;
    ELSE
      INSERT INTO ai_settings (
        id, auto_response_enabled, confidence_threshold, max_response_length,
        response_timeout, auto_learn_enabled, min_resolution_score, article_approval_required,
        complexity_threshold, escalation_enabled, escalation_team_id, temperature, max_tokens,
        daily_limit_usd, monthly_limit_usd, max_tokens_per_request, max_requests_per_minute,
        is_active, updated_by, updated_at, created_at
      )
      SELECT 1, auto_response_enabled, confidence_threshold, max_response_length, response_timeout,
        auto_learn_enabled, min_resolution_score, article_approval_required, complexity_threshold,
        escalation_enabled, escalation_team_id, temperature, max_tokens, daily_limit_usd,
        monthly_limit_usd, max_tokens_per_request, max_requests_per_minute, is_active, updated_by,
        updated_at, created_at
      FROM bedrock_settings WHERE is_active = true ORDER BY id LIMIT 1
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;
END
$$;

-- 3. ai_usage: the OpenRouter columns, the billing_status check and the generation_id index.
DO $$
BEGIN
  IF to_regclass('ai_usage') IS NULL THEN
    RAISE NOTICE '0023: table ai_usage is absent; skipping its new columns, check and index (drizzle-kit push creates them)';
  ELSE
    ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS requested_model_id varchar(255);
    ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS generation_id varchar(255);
    ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS verified_cost_usd numeric(10,6);
    ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS billing_status varchar(16) NOT NULL DEFAULT 'estimated';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ai_usage_billing_status_check'
        AND conrelid = to_regclass('ai_usage')
    ) THEN
      ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_billing_status_check
        CHECK (billing_status IN ('estimated', 'verified'));
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_generation_id_uniq ON ai_usage(generation_id) WHERE generation_id IS NOT NULL;
  END IF;
END
$$;
