-- 0032 copilot ticket creation: tasks.suggested_team_id.
-- When a customer raises a ticket through the copilot, the copilot suggests the owning team from
-- the conversation. That suggestion is recorded here, beside the assignment, and the ticket still
-- starts in the triage queue so the AI routing step can confirm or correct it. Without this, a
-- suggested team would look like a deliberate assignment and routing would skip the ticket.
--
-- Idempotent and safe on every database a deploy touches: the column is added only if absent, and
-- an absent tasks table is skipped with a NOTICE (drizzle-kit push then creates it).
DO $$
BEGIN
  IF to_regclass('tasks') IS NULL THEN
    RAISE NOTICE '0032: tasks is absent (drizzle-kit push creates it); skipping suggested_team_id';
  ELSE
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS suggested_team_id integer REFERENCES teams(id);
  END IF;
END
$$;
