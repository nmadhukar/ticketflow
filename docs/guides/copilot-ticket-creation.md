# Copilot ticket creation (customer-facing)

The copilot popup is a customer's front door to TicketFlow: they describe a problem in
chat, the copilot asks what is missing, raises the ticket as them, and they can follow it up
without waiting for email. The AI agent then works the ticket exactly as it does for any
other new ticket.

## The flow

```
Customer (browser, signed in)
  -> CopilotKit popup            client/src/components/CopilotAssistant.tsx
  -> POST /api/copilotkit        server/copilot/runtime.ts (middleware, signed-in only)
  -> Mastra agent for THAT user  server/mastra/index.ts   (createTicketFlowAgentService(env, actor))
  -> POST /api/mcp               server/mcp/actAs.ts      (X-TicketFlow-Act-As)
  -> TicketFlow tools / DB
```

Then, on create, the existing agent path runs unchanged:

```
ticket created -> AI analysis ->  match found: reply posted
                                  no match:   routed to the owning team
```

## What the customer's copilot does

1. **Understands first.** It asks at most a few deciding questions (what they did, what
   happened instead, any error, since when) and never repeats what was already said.
2. **Answers if it can.** It searches the knowledge base and offers a known fix before
   creating anything. A ticket is raised only if the fix does not help.
3. **Creates the ticket as the customer.** Title, description, category and priority come
   from the conversation.
4. **Suggests the owning department/team** from `list_routing_options` and passes it as
   `routeId`.
5. **Follows up.** `list_tickets` / `get_ticket` / `get_ticket_history` show status and
   progress; `add_comment` adds information to an existing ticket.

## The two rules that make this safe

### 1. The agent acts as the signed-in customer

MCP accepts only an API key, and a browser must never hold one, so the agent (which does
hold the server's `mcp:tickets` key) presents the signed-in user's identity per request.

`server/mcp/actAs.ts` gates that header twice:

- it is honoured **only** inside `runAsTrustedCaller()`, which the copilot runtime wraps
  around the request it serves; an external MCP client adding the header is ignored;
- the impersonated user must be a **customer or an agent** - never an admin or manager, so a
  copilot session cannot reach admin-only tools even though the key allows them;
- concurrent customers each get their own scope, so one cannot claim another's identity.

Without this, every copilot ticket would belong to the API key's owner and never appear in
the customer's own list.

### 2. The suggested team is a suggestion, not an assignment

`routeTicket` skips a ticket that already has a deliberate team assignment
(`hasDeliberateAssignment`). If the copilot's suggestion were written as the assignment,
the "no match -> assign to the right team" step would never run for copilot tickets.

So the suggestion is recorded in `tasks.suggested_team_id` (migration 0032) and the ticket
starts in the triage queue. Routing sees the suggestion as a hint in its prompt, then
decides - confirming it or correcting it. A customer who explicitly picks a team in the
form is still respected (R36); only the copilot's `routeId` is treated as a suggestion.

## Configuration

| Setting | Needed for |
|---|---|
| `COPILOTKIT_ENABLED=true` | the popup |
| `MASTRA_AGENT_ENABLED=true` | the agent layer the copilot borrows |
| `TICKETFLOW_MCP_KEY` | the key the agent calls MCP with (its owner is replaced per request) |
| `OPENROUTER_API_KEY` | the Llama |
| `DEFAULT_TRIAGE_TEAM_ID` | where a suggested ticket waits while routing decides (recommended) |
| `ai_settings.autoResponseEnabled` / `autoRoutingEnabled` | the reply and routing halves |

## Tests

- `server/__tests__/integration/copilotTicketCreation.test.ts` - creation through the real
  `create_ticket` tool, the suggestion not blocking routing, created-as-the-customer,
  visibility, and the unaffected no-suggestion path.
- `server/__tests__/unit/mcpActAs.test.ts` - the trust boundary: ignored outside the
  copilot runtime, no cross-user claim, no admin escalation, concurrent users kept apart.
