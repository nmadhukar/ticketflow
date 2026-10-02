-- Migration: the AI system user ("ai-assistant")
-- AI auto-response comments are authored by this account, not by the customer who opened the ticket.
-- Production applies the schema with drizzle-kit push, which never runs data SQL, so the same row is created
-- at every startup by server/utils/aiSystemUser.ts (ensureAiSystemUser, wired in server/seed/runSeeders.ts).
-- This file is the idempotent record of it. The account has no password and is never active or approved:
-- it cannot sign in by any path and is hidden from user listings.

INSERT INTO "users" ("id", "email", "first_name", "last_name", "role", "password", "is_active", "is_approved")
VALUES ('ai-assistant', 'ai-assistant@ticketflow.invalid', 'AI', 'Assistant', 'agent', NULL, false, false)
ON CONFLICT DO NOTHING;
