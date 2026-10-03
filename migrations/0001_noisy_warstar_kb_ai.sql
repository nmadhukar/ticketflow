CREATE TABLE "ai_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"feedback_type" varchar(50) NOT NULL,
	"reference_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"ticket_id" integer,
	"created_at" timestamp DEFAULT now()
);
-- Create bedrock_settings table
CREATE TABLE IF NOT EXISTS "bedrock_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"bedrock_access_key_id" varchar(255),
	"bedrock_secret_access_key" varchar(255),
	"bedrock_region" varchar(50) DEFAULT 'us-east-1',
	"bedrock_model_id" varchar(100) DEFAULT 'amazon.titan-text-express-v1',
	"is_active" boolean DEFAULT true,
	"updated_by" varchar(255) REFERENCES "users"("id"),
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bedrock_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"cost" numeric(10, 6) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"content" text,
	"file_data" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"uploaded_by" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"manager_id" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escalation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_name" varchar(100) NOT NULL,
	"description" text,
	"conditions" jsonb NOT NULL,
	"target_role" varchar(50) NOT NULL,
	"target_user_id" varchar,
	"target_team_id" integer,
	"priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "faq_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_hash" varchar(64) NOT NULL,
	"original_question" text NOT NULL,
	"normalized_question" text NOT NULL,
	"answer" text NOT NULL,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"last_used" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "faq_cache_question_hash_unique" UNIQUE("question_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"source_ticket_ids" integer[],
	"category" varchar(100),
	"tags" varchar(100)[],
	"usage_count" integer DEFAULT 0,
	"effectiveness_score" numeric(3, 2),
	"is_published" boolean DEFAULT false,
	"status" varchar(20) DEFAULT 'draft',
	"source" varchar(20) DEFAULT 'manual',
	"view_count" integer DEFAULT 0,
	"helpful_votes" integer DEFAULT 0,
	"unhelpful_votes" integer DEFAULT 0,
	"archived_at" timestamp,
	"last_used" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"embedding" jsonb NOT NULL,
	"embedding_model" varchar(100) DEFAULT 'amazon.titan-embed-text-v1',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "knowledge_embeddings_article_id_unique" UNIQUE("article_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"process_status" varchar(50) DEFAULT 'pending',
	"processing_attempts" integer DEFAULT 0,
	"processed_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"related_task_id" integer,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resolution_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"category" varchar(100),
	"frequency" integer DEFAULT 1,
	"success_rate" numeric(3, 2),
	"source_ticket_ids" integer[],
	"extracted_at" timestamp DEFAULT now(),
	"last_used" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sso_configuration" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar,
	"client_secret" varchar,
	"tenant_id" varchar,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_integration_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"enabled" boolean DEFAULT false,
	"team_id" varchar,
	"team_name" varchar,
	"channel_id" varchar,
	"channel_name" varchar,
	"webhook_url" text,
	"notification_types" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "teams_integration_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_auto_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"ai_response" text NOT NULL,
	"confidence_score" numeric(3, 2) NOT NULL,
	"was_helpful" boolean,
	"was_applied" boolean DEFAULT false,
	"responded_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_complexity_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"complexity_score" integer NOT NULL,
	"factors" jsonb NOT NULL,
	"ai_analysis" text,
	"calculated_at" timestamp DEFAULT now(),
	CONSTRAINT "ticket_complexity_scores_ticket_id_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
CREATE TABLE "user_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"department" varchar(100),
	"department_id" integer,
	"invited_by" varchar NOT NULL,
	"invitation_token" varchar NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_invitations_invitation_token_unique" UNIQUE("invitation_token")
);
--> statement-breakpoint
ALTER TABLE "smtp_settings" ALTER COLUMN "host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "smtp_settings" ALTER COLUMN "port" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "smtp_settings" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "smtp_settings" ALTER COLUMN "password" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "ticket_prefix" varchar(10) DEFAULT 'TKT' NOT NULL;--> statement-breakpoint
ALTER TABLE "smtp_settings" ADD COLUMN "aws_access_key_id" varchar(255);--> statement-breakpoint
ALTER TABLE "smtp_settings" ADD COLUMN "aws_secret_access_key" varchar(255);--> statement-breakpoint
ALTER TABLE "smtp_settings" ADD COLUMN "aws_region" varchar(50) DEFAULT 'us-east-1';--> statement-breakpoint
ALTER TABLE "smtp_settings" ADD COLUMN "use_aws_ses" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_approved" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_token" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_expires" timestamp;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_ticket_id_tasks_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bedrock_usage" ADD CONSTRAINT "bedrock_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bedrock_settings" ADD CONSTRAINT "bedrock_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policies" ADD CONSTRAINT "company_policies_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_target_team_id_teams_id_fk" FOREIGN KEY ("target_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_article_id_knowledge_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."knowledge_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_queue" ADD CONSTRAINT "learning_queue_ticket_id_tasks_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_configuration" ADD CONSTRAINT "sso_configuration_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_integration_settings" ADD CONSTRAINT "teams_integration_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_auto_responses" ADD CONSTRAINT "ticket_auto_responses_ticket_id_tasks_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_auto_responses" ADD CONSTRAINT "ticket_auto_responses_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_complexity_scores" ADD CONSTRAINT "ticket_complexity_scores_ticket_id_tasks_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;

-- Squashed KB/AI/Cleanup originally planned for 0002–0005
-- KB columns + backfills + indexes
ALTER TABLE knowledge_articles
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS helpful_votes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unhelpful_votes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_used TIMESTAMP NULL;

UPDATE knowledge_articles
SET status = CASE WHEN is_published = TRUE THEN 'published' ELSE 'draft' END
WHERE status IS NULL OR status NOT IN ('draft','published','archived');

UPDATE knowledge_articles
SET source = 'manual'
WHERE source IS NULL OR source NOT IN ('manual','ai_generated');

UPDATE knowledge_articles
SET effectiveness_score = '0.00'
WHERE effectiveness_score IS NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_status ON knowledge_articles(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_source ON knowledge_articles(source);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_category ON knowledge_articles(category);