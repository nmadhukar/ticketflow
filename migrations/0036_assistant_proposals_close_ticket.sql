-- Allow the copilot's "is it sorted? close it" proposal card.
-- Before this, a proposal could only be create_ticket or add_comment, so propose_close_ticket
-- (server/assistant/proposals.ts) would have failed at insert time.
ALTER TABLE assistant_write_proposals
  DROP CONSTRAINT IF EXISTS assistant_proposals_action_check;

ALTER TABLE assistant_write_proposals
  ADD CONSTRAINT assistant_proposals_action_check
  CHECK (action IN ('create_ticket', 'add_comment', 'close_ticket'));
