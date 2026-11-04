-- Migration: assistant_audit_events (assistant sidecar plan, Stage 8)
-- The durable security record of the in-app assistant: refused tokens and runs, every proposed
-- write and its outcome (proposed, confirmed, rejected, executed, failed, refused), saved
-- conversations withheld or deleted. Codes and ids only: never a token, a message, ticket content
-- or a raw IP address (ip_hash is a keyed hash). actor_user_id and ticket_id carry no foreign key,
-- so the record outlives the user or ticket it names. Kept 365 days (ASSISTANT_AUDIT_RETENTION_DAYS),
-- apart from usage analytics.
-- Production applies the schema with drizzle-kit push (shared/schema.ts, assistantAuditEvents); this
-- file runs first (db:migrate-sql) and is the idempotent record: safe to run again.
CREATE TABLE IF NOT EXISTS assistant_audit_events (
  id bigserial PRIMARY KEY NOT NULL,
  occurred_at timestamp DEFAULT now() NOT NULL,
  event_type varchar(32) NOT NULL,
  actor_user_id varchar,
  agent_id varchar(40),
  run_id uuid,
  proposal_id uuid,
  ticket_id integer,
  reason varchar(80),
  ip_hash varchar(32),
  details jsonb,
  CONSTRAINT assistant_audit_event_type_check CHECK (event_type IN (
    'mcp_auth_refused', 'renew_refused', 'run_refused',
    'write_proposed', 'write_confirmed', 'write_rejected', 'write_executed', 'write_failed', 'write_refused',
    'history_withheld', 'history_deleted'
  ))
);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_occurred_at ON assistant_audit_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_type_occurred ON assistant_audit_events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_actor ON assistant_audit_events (actor_user_id);
