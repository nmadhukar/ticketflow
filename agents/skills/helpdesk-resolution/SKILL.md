---
name: helpdesk-resolution
description: Resolve a TicketFlow ticket by reusing the fix from similar past tickets and the knowledge base.
version: 1.0.0
---

# When to use

A new or open support ticket needs a customer-ready resolution, and someone has to decide what the
fix is without inventing one.

# Procedure

1. `get_ticket(includeComments)` — capture the symptom, product area, category and impact.
2. `list_tickets` — same category plus 2–3 key words from the symptom. Keep the 3 closest matches.
3. `get_ticket_history` — for each match: was it closed as solved, by which team, after what action?
4. `search_knowledge` → `get_knowledge_article` — the canonical fix. If the knowledge base is thin,
   `search_documents` → `get_document`.
5. Draft the reply: one-line answer, numbered steps, expected result, what happens next.
6. `propose_comment` — never `add_comment` unless the user explicitly says "post it".

# Quality bar

- Every claim traceable to a tool result: a ticket number or an article title.
- No internal notes, no other customers' data, no guessed numbers, dates or outcomes.
- If nothing matches: say "No existing fix found", name the owning team, and suggest the next step.
- Never state that a ticket was created, a comment posted or anything updated: proposals only.

# Example

Input: "Customer was charged twice for INV-2026-0412."

Output: similar ticket `TKT-2026-0188` (billing, closed, refund issued) + article
"Duplicate invoice charge" → reply with the refund steps → `propose_comment`.
