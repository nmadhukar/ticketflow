-- Add new columns to company_settings table
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "default_ticket_priority" varchar(20) DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "auto_close_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "timezone" varchar(50) DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "date_format" varchar(20) DEFAULT 'YYYY-MM-DD';--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "time_format" varchar(10) DEFAULT '24h';--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "max_file_upload_size" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "maintenance_mode" boolean DEFAULT false;--> statement-breakpoint
