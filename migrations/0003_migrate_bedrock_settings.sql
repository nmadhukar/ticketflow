-- Migration script to move Bedrock settings from smtp_settings to bedrock_settings
-- This preserves existing data while decoupling the services

-- Step 1: Create bedrock_settings table
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

-- Step 2: Migrate existing Bedrock data from smtp_settings to bedrock_settings
INSERT INTO "bedrock_settings" (
	"bedrock_access_key_id",
	"bedrock_secret_access_key", 
	"bedrock_region",
	"bedrock_model_id",
	"is_active",
	"updated_by",
	"updated_at",
	"created_at"
)
SELECT 
	"bedrock_access_key_id",
	"bedrock_secret_access_key",
	COALESCE("bedrock_region", 'us-east-1'),
	COALESCE("bedrock_model_id", 'amazon.titan-text-express-v1'),
	true,
	"updated_by",
	"updated_at",
	"created_at"
FROM "smtp_settings" 
WHERE "bedrock_access_key_id" IS NOT NULL 
   OR "bedrock_secret_access_key" IS NOT NULL
   OR "bedrock_region" IS NOT NULL
   OR "bedrock_model_id" IS NOT NULL;

-- Step 3: Remove Bedrock columns from smtp_settings table
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_access_key_id";
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_secret_access_key";
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_region";
ALTER TABLE "smtp_settings" DROP COLUMN IF EXISTS "bedrock_model_id";
