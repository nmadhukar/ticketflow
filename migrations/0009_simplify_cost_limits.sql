-- Migration: Simplify Cost Limits Configuration
-- Remove rate limiting and free-tier fields from bedrock_settings table
-- Keep only: daily_limit_usd, monthly_limit_usd, max_tokens_per_request

-- Drop columns that are no longer needed
ALTER TABLE "bedrock_settings" DROP COLUMN IF EXISTS "max_requests_per_day";
ALTER TABLE "bedrock_settings" DROP COLUMN IF EXISTS "max_requests_per_hour";
ALTER TABLE "bedrock_settings" DROP COLUMN IF EXISTS "is_free_tier_account";

-- Note: max_requests_per_minute remains in bedrock_settings as it's part of AI settings, not cost limits

