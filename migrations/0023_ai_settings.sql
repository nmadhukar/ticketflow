-- Add provider-neutral AI settings without changing legacy Bedrock or S3 data.
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

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS requested_model_id varchar(255);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS generation_id varchar(255);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS verified_cost_usd numeric(10,6);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS billing_status varchar(16) NOT NULL DEFAULT 'estimated';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_usage_billing_status_check'
      AND conrelid = 'ai_usage'::regclass
  ) THEN
    ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_billing_status_check
      CHECK (billing_status IN ('estimated', 'verified'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_generation_id_uniq ON ai_usage(generation_id) WHERE generation_id IS NOT NULL;
