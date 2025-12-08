-- Migration: Migrate AI settings and cost limits to bedrock_settings table
-- Create ai_usage table and drop legacy bedrock_usage table

-- Create ai_usage table
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost" numeric(10, 6) NOT NULL,
	"operation" varchar(100) NOT NULL,
	"user_id" varchar,
	"ticket_id" integer,
	"created_at" timestamp DEFAULT now()
);

-- Add cost limits columns to bedrock_settings
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "daily_limit_usd" numeric(10, 2) DEFAULT '50.0';
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "monthly_limit_usd" numeric(10, 2) DEFAULT '100.0';
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "max_tokens_per_request" integer DEFAULT 3000;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "max_requests_per_day" integer DEFAULT 5000;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "max_requests_per_hour" integer DEFAULT 200;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "is_free_tier_account" boolean DEFAULT false;

-- Add AI settings columns to bedrock_settings
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "auto_response_enabled" boolean DEFAULT true;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "confidence_threshold" numeric(3, 2) DEFAULT '0.7';
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "max_response_length" integer DEFAULT 1000;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "response_timeout" integer DEFAULT 30;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "auto_learn_enabled" boolean DEFAULT true;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "min_resolution_score" numeric(3, 2) DEFAULT '0.8';
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "article_approval_required" boolean DEFAULT true;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "complexity_threshold" integer DEFAULT 70;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "escalation_enabled" boolean DEFAULT true;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "escalation_team_id" integer;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "temperature" numeric(3, 2) DEFAULT '0.3';
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "max_tokens" integer DEFAULT 2000;
ALTER TABLE "bedrock_settings" ADD COLUMN IF NOT EXISTS "max_requests_per_minute" integer DEFAULT 20;

-- Add foreign key constraints
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_ticket_id_tasks_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bedrock_settings" ADD CONSTRAINT "bedrock_settings_escalation_team_id_teams_id_fk" FOREIGN KEY ("escalation_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;

-- Create indexes for ai_usage table
CREATE INDEX IF NOT EXISTS "idx_ai_usage_timestamp" ON "ai_usage" USING btree ("timestamp");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_operation" ON "ai_usage" USING btree ("operation");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_user_id" ON "ai_usage" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_ticket_id" ON "ai_usage" USING btree ("ticket_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_model_id" ON "ai_usage" USING btree ("model_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_timestamp_operation" ON "ai_usage" USING btree ("timestamp", "operation");

-- Drop legacy bedrock_usage table if it exists
DROP TABLE IF EXISTS "bedrock_usage";

