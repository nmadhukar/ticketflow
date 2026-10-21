# TicketFlow agent: run and demo guide

A single page to start the app and show the create-time agent. Two demos: the memory/routing half
(no external services) and the model half (needs an OpenRouter key).

## 1. Start the stack

```powershell
# from the repository root
docker compose up -d postgres        # Postgres on host port 5433 (see .env: POSTGRES_PORT)

$env:DATABASE_URL = "postgresql://ticketflow_user:ticketflow_password@localhost:5433/ticketflow"
npm.cmd run db:migrate-sql           # applies 0007..0031; safe to re-run
npm.cmd run dev                      # serves http://localhost:5000
```

Open <http://localhost:5000> and sign in with a demo account:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@ticketflow.local` | `Admin123!` |
| Manager | `manager@ticketflow.local` | `Password123!` |
| Agent | `agent@ticketflow.local` | `Password123!` |
| Customer | `customer@ticketflow.local` | `Password123!` |

If the boot refuses with "database schema is missing", run `npm.cmd run db:migrate-sql` first: the
database predates a migration. That is the expected first step on an older database.

## 2. Enable the AI half (optional, needs a key)

```
# .env
OPENROUTER_API_KEY=sk-or-...
```

Restart `npm.cmd run dev`. Then, as an admin, open **Admin > AI settings** and:

1. turn **Enable AI model calls** ON (the master switch; saving AI settings creates the row with it
   OFF, so a fresh save silently turns the agent off — this is the usual "nothing happened" cause);
2. leave **Auto-response** on for the "match found" demo;
3. turn on **Route unmatched tickets** for the "no match" demo;
4. click **Test connection** and confirm it succeeds before you present.

The model is called only when `OPENROUTER_API_KEY` is set **and** the master switch is on, so with
no key (or the switch off) the app runs normally and simply makes no model call.

### If a ticket gets a "holding message" instead of an answer

The agent must never post `I'm unable to generate an automated response at this time...` as if it were
a matched reply; that text means no answer was produced. If you see it, the model call failed (check
the server console). The client already turns reasoning off for the JSON calls and rejects a reply
the provider cut off at the token cap, so a truncated/empty reasoning output is treated as "no
answer" and the ticket is routed instead. If connection tests fail, pick another model in
**Admin > AI settings**.

## 3. Demo A - match found, AI replies

1. As the agent, open a resolved ticket and add a resolution comment (this is a "known fix").
2. As the customer, create a ticket describing the same problem.
3. Open the ticket: the **AI Assistant** comment answers it, built from the resolved ticket and the
   knowledge base. Confidence counts only real knowledge-base matches.

## 4. Demo B - no match, routed to the right team

1. As the customer, create a ticket that resembles nothing already resolved.
2. Open it: the agent classifies the problem area and assigns the team that owns it, with an
   "AI Assistant" history entry showing why it moved.
3. With routing off, the same ticket is left for a person, exactly as before.

## 5. Demo C - the DeepSeek Harness drives TicketFlow over MCP

No model key is needed for this one; it proves the agent can call TicketFlow.

1. As the admin, go to **Admin > Integrations > Developer resources** and create an API key for an
   agent user. The `tfk_...` value is shown once.
2. Register the endpoint with the harness from `docs/integrations/dsh/cordis.patch.yml`.
3. From the harness, run: `initialize` (server name `ticketflow`) then `tools/list` then a
   read-only `list_tickets`. The result matches the same user's REST answer.

### Command-line probe (no harness needed)

```powershell
# after creating a key, replace <KEY> below
$h = @{ Authorization = "Bearer <KEY>"; Accept = "application/json, text/event-stream" }
Invoke-WebRequest http://localhost:5000/api/mcp -Method POST -Headers $h -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}}}' -UseBasicParsing
```

A call with no key answers 401 with `WWW-Authenticate: Bearer`; a key without `mcp:tickets` answers
403. Every key is scoped to `mcp:tickets` by the server.

## 6. Optional - Hindsight memory

With a Hindsight service running, add to `.env` and restart:

```
HINDSIGHT_ENABLED=true
HINDSIGHT_URL=http://localhost:8888
HINDSIGHT_BANK_ID=ticketflow
```

Then Demo A recalls similar past resolutions before writing the reply, and resolving a ticket stores
one memory. Off by default; with it off no request is made.

## 7. Before you present

```powershell
npm.cmd run check           # type check (all three tsconfigs)
npm.cmd run lint            # 0 errors
npm.cmd run test:unit       # unit + ai
npm.cmd run test:client
$env:TEST_DATABASE_URL = "postgresql://ticketflow_user:ticketflow_password@localhost:5433/ticketflow_test_e2e"
npm.cmd run test:integration
npx.cmd playwright test
```

The full runtime gate is `GATE_NONCE=local bash scripts/ai/verify.sh` (a Git Bash + Docker CLI
shell); it builds the production bundle, boots it against a real PostgreSQL and runs every suite.
