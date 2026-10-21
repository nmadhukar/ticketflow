-- 0031 content-based ticket routing: ai_settings.auto_routing_enabled.
-- When a new ticket finds no matching solution, the agent classifies it and assigns it to the
-- owning team. Off by default: this reassigns a customer's ticket, so an admin enables it.
-- Runs against every database a deploy touches, before drizzle-kit push, and must never abort
-- the deploy: an absent table is skipped with a NOTICE (drizzle-kit push then creates the column).
DO $$
BEGIN
  IF to_regclass('ai_settings') IS NULL THEN
    RAISE NOTICE '0031: ai_settings not created, table ai_settings is absent (drizzle-kit push creates it); skipping';
  ELSE
    ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS auto_routing_enabled boolean DEFAULT false;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('bedrock_settings') IS NULL THEN
    RAISE NOTICE '0031: bedrock_settings is absent; skipping its auto_routing_enabled column';
  ELSE
    ALTER TABLE bedrock_settings ADD COLUMN IF NOT EXISTS auto_routing_enabled boolean DEFAULT false;
  END IF;
END
$$;
