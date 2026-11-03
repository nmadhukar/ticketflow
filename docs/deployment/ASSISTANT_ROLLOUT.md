# In-app assistant: rollout and operations

The in-app assistant answers questions about tickets inside TicketFlow. There are two, chosen by
role:

- **Support assistant** for customers: their own tickets, knowledge articles, and drafting a ticket
  or a comment for them.
- **Ticket assistant** for agents, managers and admins: the tickets their role can see, the queue,
  teams and stats, and drafting comments.

The assistant never changes anything itself. A draft appears as a card, and nothing is written
until the user presses **Confirm**. It then runs once, as that user, through TicketFlow's normal
ticket rules. Every assistant lookup goes through the same visibility rules as the rest of the
app, so nobody sees a ticket through the assistant that they could not open themselves.

It runs as a second service, `agents` (the Mastra sidecar in `agents/`). Only the app can reach it,
and it has no public port. It reaches the model provider (OpenRouter by default, model
`openai/gpt-5-mini`). Nothing changes for users until `ASSISTANT_ENABLED=true`.

## Before you start

- **An OpenRouter API key** (`OPENROUTER_API_KEY`). Set a spend limit on the key at OpenRouter as
  well.
- **AI budgets** in Admin → AI settings. Assistant spend counts towards the same daily and monthly
  limits as TicketFlow's other AI features. When a limit is reached, new assistant runs are
  refused with a "spending limit" message.
- **A database backup** (`scripts/db/backup.sh`).
- Both images build: `docker compose build app agents`.

## Settings

| Setting | Service | Default | Purpose |
|---|---|---|---|
| `ASSISTANT_ENABLED` | app, agents | off | `true` switches the assistant on. Anything else is off. |
| `ASSISTANT_AUDIENCE` | app | `all` | `staff`: agents, managers and admins only. `all`: customers too. |
| `ASSISTANT_SESSION_SECRET` | app only | none | Signs the app's internal tool tokens. Never give it to the agents service. |
| `ASSISTANT_AGENT_SECRET` | app, agents | none | Signs the tokens the app sends to the agents service. Same value on both. |
| `OPENROUTER_API_KEY` | agents | none | Model provider key. |
| `ASSISTANT_MODEL` | agents | `openai/gpt-5-mini` | Model for both assistants. `ASSISTANT_SUPPORT_MODEL` / `ASSISTANT_STAFF_MODEL` override one. |
| `ASSISTANT_WRITES_ENABLED` | app | on | `false` stops all drafts. The assistant still answers. |
| `ASSISTANT_STAFF_HISTORY` | app, agents | off | Saved staff conversations. See [ASSISTANT_DB.md](ASSISTANT_DB.md). |
| `ASSISTANT_RUN_MAX_SECONDS` | app | 900 | Longest one answer may take (60–3600). |
| `ASSISTANT_USAGE_RETENTION_DAYS` | app | 90 | Usage records kept (1–365). |
| `ASSISTANT_AUDIT_RETENTION_DAYS` | app | 365 | Audit trail kept (30–3650). Check your legal requirement. |

The two secrets must each be at least 32 random characters, different from each other and from
`SESSION_SECRET` and `JWT_SECRET`. Generate each with `openssl rand -base64 32`. While the
assistant is on, the app refuses to start with a missing or weak secret, or an invalid value
above, and names the setting at fault.

## Stage 1: deploy it switched off

Deploy this release with `ASSISTANT_ENABLED` unset.

- Migrations `0033`–`0035` run as usual on deploy. They add three tables
  (`assistant_usage_events`, `assistant_audit_events`, `assistant_write_proposals`) and one empty,
  nullable column, `ai_usage.assistant_run_id`. No existing data changes.
- The `agents` service starts in standby, answering only its health check.

Check:

- TicketFlow works as before.
- `docker compose ps` shows `agents` healthy.
- No user sees an assistant button.

## Stage 2: staff only

1. In `.env`, set:

   ```sh
   ASSISTANT_ENABLED=true
   ASSISTANT_AUDIENCE=staff
   ASSISTANT_SESSION_SECRET=<openssl rand -base64 32>
   ASSISTANT_AGENT_SECRET=<openssl rand -base64 32>
   OPENROUTER_API_KEY=<key>
   ```

   To save staff conversations, also follow [ASSISTANT_DB.md](ASSISTANT_DB.md).
2. Run `docker compose up -d`.
3. Check, signed in as an agent or a manager:
   - A **Ticket assistant** button appears at the bottom left.
   - "How many tickets are open?" gives the same number as the dashboard.
   - "Draft a comment on TKT-… saying we're looking into it" shows a card. **Confirm and post**
     adds the comment once. **Discard** adds nothing.
   - Admin → Analytics → **Assistant Activity** shows the runs, their cost and the audit trail.
4. Check that a customer sees no assistant button.
5. Optionally run the evals against this deployment, if it is a staging site (see Evals below).

Leave it with staff for as long as you need. Watch the Assistant Activity page for failed runs
and cost.

## Stage 3: customers

Set `ASSISTANT_AUDIENCE=all` and run `docker compose up -d`. Customers now see a **Support
assistant** button.

Customers are limited to 30 assistant requests per 15 minutes and staff to 60. These limits apply
when `RATE_LIMITING_ENABLED=true`.

## Switching it off

Each switch takes effect when you run `docker compose up -d` (the app restarts).

| To stop | Set |
|---|---|
| Drafts only (answers continue) | `ASSISTANT_WRITES_ENABLED=false` |
| Customers only | `ASSISTANT_AUDIENCE=staff` |
| The whole assistant | `ASSISTANT_ENABLED=false` |
| Spending | Lower the limits in Admin → AI settings. New runs are refused at the limit. |

Turning it off does not delete anything. Drafts that were never confirmed expire.

## Monitoring

- **Admin → Analytics → Assistant Activity**:
  - Runs by day and outcome (completed, failed, stopped, refused).
  - Drafts proposed.
  - Tokens, and cost by day and model.
  - The audit trail: drafts proposed, confirmed, rejected, executed or failed; refused runs and
    tokens; withheld or deleted conversations.
- **Total AI spend**, including the assistant, is in the existing AI usage figures.
- **App logs** have one line per refused token or run. These contain no conversation text.

## What is stored, and what leaves

- **Customer conversations are not stored.** Staff conversations are stored only with
  `ASSISTANT_STAFF_HISTORY=true`, for 30 days by default.
- Usage records hold who ran which assistant, when, how it ended, and which tools it used. The
  audit trail holds decisions and refusals, with a keyed hash of the IP address. Neither holds
  any message text.
- **The model provider** receives the conversation and what the assistant looked up to answer it.
- **Telemetry is off** for both libraries:
  - CopilotKit's (in the app) is forced off in code, so no setting turns it on.
  - Mastra's (in the agents service) is off through `MASTRA_TELEMETRY_DISABLED=1` in the agents
    image. Leave that setting alone.

## Rotating the secrets

1. Set `ASSISTANT_SESSION_SECRET_PREVIOUS` (or `ASSISTANT_AGENT_SECRET_PREVIOUS`) to the current
   value.
2. Set the main variable to a new value.
3. Run `docker compose up -d`.
4. Wait at least `ASSISTANT_RUN_MAX_SECONDS` (15 minutes by default).
5. Clear the `_PREVIOUS` variable and run `docker compose up -d` again.

Answers in progress carry on through the rotation.

## Evals

`agents/evals/` asks fixed questions as real users and checks each answer by rule. It checks:

- Facts match the data.
- Nobody sees another customer's ticket.
- Instructions planted in a ticket are ignored.
- Drafts appear only when asked for, and are never described as done.
- Answers contain no internal names or raw values.

Each question is a real model call, about $0.002 with `gpt-5-mini`.

```sh
cd agents
EVAL_BASE_URL=http://localhost EVAL_ADMIN_EMAIL=<admin> EVAL_ADMIN_PASSWORD=<password> npm run eval
npm run eval -- --repeat 3        # answers vary: repeat for a pass rate
```

**Never run evals against production.** They register two `@assistant.eval` customers and create
three `[eval]` tickets. The tool refuses an `https://` address unless `EVAL_ALLOW_REMOTE=1` is set
for a staging site. Re-run the evals after changing the model or the assistants' instructions
(`agents/src/mastra/agents/`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No assistant button | `ASSISTANT_ENABLED` is not exactly `true`, a customer while `ASSISTANT_AUDIENCE=staff`, or a stale page (reload). |
| "The assistant is unavailable right now" | The `agents` service is down or not ready: `docker compose ps`, `docker compose logs agents`. |
| "Cannot reach the assistant" | The browser lost its connection to TicketFlow. |
| "Spending limit" | A daily or monthly AI budget is used up (Admin → AI settings). |
| The app will not start | Its log names the assistant setting at fault (see Settings). |
| Saved conversations missing | History is staff-only. It shows as unavailable while its store cannot be reached. See [ASSISTANT_DB.md](ASSISTANT_DB.md). |

## Rolling back

- Setting `ASSISTANT_ENABLED=false` is enough to stop the assistant.
- Deploying the previous release is also safe. The assistant's tables and the `ai_usage` column
  are additive, and older code ignores them.
- To remove saved conversations as well, see [ASSISTANT_DB.md](ASSISTANT_DB.md) → Remove.
