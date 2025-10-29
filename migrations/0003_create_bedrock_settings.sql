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

-- Remove Bedrock columns from smtp_settings table
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_access_key_id";
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_secret_access_key";
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_region";
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_model_id";
