# Mastra Studio — START HERE (working setup + 1-day plan)

**Status: WORKING, tools included.** `http://localhost:4111` → 200, `/api/agents` → 200, and the agent
really calls TicketFlow tools from Studio chat (verified: it listed the eval user's 3 tickets, then
found the similar ticket + knowledge article for an invoice-export problem).

---

## 1. Start it (one command, every time)

```powershell
cd C:\Users\Dsig\Desktop\ticketflow-main
docker compose -f docker-compose.yml -f docker-compose.studio.yml up -d agents-studio
```

Wait ~45 seconds, then open **http://localhost:4111** in your browser. No login screen — auth is off for local Studio.

Check it is up:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:4111/api/agents   # expect 200
```

Stop it: `docker compose -f docker-compose.yml -f docker-compose.studio.yml stop agents-studio`

---

## 2. Why Gemini's steps failed (so you can explain it)

| # | What Gemini said | What actually happened |
|---|---|---|
| 1 | `MASTRA_DATABASE_URL=postgres://postgres:postgres@postgres:5432/ticketflow` | The `postgres` role does not exist in your DB. The agents server **crashed on startup**. |
| 2 | Nothing about `MASTRA_HOST` | `mastra dev` binds `127.0.0.1` **inside** the container. Your Windows browser can never reach it → `ERR_CONNECTION_REFUSED`. This was the main "4111 won't open". |
| 3 | Nothing about `MASTRA_DEV` | Without it the CLI stays a file watcher and the API never finishes starting. |
| 4 | `.env` had `...@localhost:5433` | Inside a container `localhost` is the container itself → `ECONNREFUSED`. Must be `postgres:5432`. |
| 5 | `ASSISTANT_MODEL=gpt-5-mini` with provider `openai` | `gpt-5-mini` is an **OpenRouter** id, not an OpenAI id. Model calls fail. |
| 6 | Nothing about the DB role | `ticketflow_mastra` role + `mastra` schema did not exist → datasets/memory could never save. |
| 7 | Nothing about auth | `CompositeAuth` refused the Studio user on every route → 401 even with the right token. |

---

## 3. What I changed (all reversible)

| File | Change | Why |
|---|---|---|
| `.env` | `DATABASE_URL` → `@postgres:5432` | app container was crash-looping |
| `.env` | `MASTRA_DATABASE_URL` → `@postgres:5432` | same, for the agents service |
| `.env` | added `MASTRA_STUDIO_TOKEN` | 32+ chars, required by config check |
| `docker-compose.studio.yml` | rewritten | `MASTRA_HOST=0.0.0.0`, `MASTRA_DEV=true`, `MASTRA_STUDIO_NO_AUTH=true`, correct DB URL |
| `agents/mastra.config.ts` | **new** | binds `0.0.0.0` so the port is reachable from Windows |
| `agents/src/mastra/server-config.ts` | `MASTRA_STUDIO_NO_AUTH=true` → no `auth` | local Studio only; refused in production |
| `agents/src/mastra/config-issues.ts` | refuses `MASTRA_STUDIO_NO_AUTH` in production | safety |
| `agents/src/mastra/auth.ts` | `AssistantAuth` subclass + `isStudioUser` | lets the Studio token through when auth IS on |
| `agents/src/mastra/mcp.ts` | `studioRunUser()` + fallback in `sessionFetch` | Studio chat can load and call tools |
| `docker-compose.yml` | `EVAL_RUNS_ENABLED` passed to the app | the dev-only run route was never registered |
| `scripts/db/seed-eval-users.mjs` | `postgres` allowed as a local host | the compose service name was rejected |

**Production is untouched:** `docker-compose.yml` has no `MASTRA_STUDIO_NO_AUTH`, and `config-issues.ts` refuses it when `NODE_ENV=production`.

---

## 4. Studio tour — in the order you should learn it

Open `http://localhost:4111`. Left sidebar. Do them in this order (60 min).

### 4.1 Agents ← start here
Click **Agents** → `ticket-assistant`. You see its instructions, model, `maxSteps: 8`.
- **Why:** this is the agent your manager wants. Read its instructions — that IS the helpdesk process.
- **Try:** type "Summarise what you can do". It answers but **cannot call tools** (see 4.9).

### 4.2 Models panel
Inside the agent → **Models**. Change model, temperature, see fallbacks.
- **Why:** compare `gpt-5-mini` vs a cheaper model on the same question.
- **Note:** edits are in-memory unless Editor + storage are configured.

### 4.3 Tools
**Tools** page → run one tool alone with your own input.
- **Why:** this is where you prove "similar tickets lookup works" without the agent.
- **Try:** `search_knowledge` with `{"query":"invoice duplicate charge"}`.
- **Note:** tools come from MCP and need a TicketFlow run → they will show an error here too (4.9).

### 4.4 MCP servers
Shows the MCP server attached and every tool it exposes, with schemas and `readOnlyHint`.
- **Why:** confirm what the agent *can* see. `isPermittedTool()` keeps only read-only + proposal tools.

### 4.5 Workflows
Visual graph, run with custom input, per-step output, time travel.
- **Why:** when steps are fixed (triage → find similar → draft), a workflow beats an agent deciding.
- **Your repo:** none defined yet — this is your practice item.

### 4.6 Processors
Input/output guardrails attached to each agent (token limit, prompt injection, moderation).
- **Why:** ticket text is untrusted input. `PromptInjectionDetector` matters here.

### 4.7 Workspaces + Skills
File browser + **Skills** tab listing `SKILL.md` skills.
- **Why:** this is where "add skills to my project" happens in the UI.

### 4.8 Request context
JSON/form of runtime variables injected into instructions/tools.
- **Why:** test "enterprise vs standard customer" without editing code.

### 4.9 Evaluation → Datasets / Scorers / Experiments
- **Datasets:** `ticketflow-assistant-evals` (created by `npm run eval`).
- **Scorers:** every score with value + reason.
- **Experiments:** run a dataset, compare 2–10 runs against a baseline.
- **Why:** the manager's "did it get better?" answer, with numbers.

### 4.10 Observability → Traces / Logs / Metrics
Timeline of every run/step/tool/model call: inputs, outputs, tokens, cost, latency.
- **Your repo:** no `observability` config yet → these pages are sparse. Add `@mastra/observability` for the full dashboard.

### 4.11 Settings
Instance URL, API prefix, custom headers, theme.

---

## 5. Studio chat WITH tools (this now works)

Studio has no signed-in TicketFlow user, so `loadRunTools` used to refuse every chat. Now, when
`MASTRA_STUDIO_NO_AUTH=true` (local Studio only), the agents service asks the app's dev-only eval
route for a run as the seeded `eval-staff` user and caches it for 4 minutes. The app still
authorises every tool call as that user, so nothing is widened.

**Prerequisite (once):** the eval users must exist.

```powershell
docker exec ticketflow-main-app-1 node scripts/db/seed-eval-users.mjs
```

**Try it in Studio:** Agents → `ticket-assistant` →

> Customer says invoice export times out. Find similar tickets and the fix.

Expected: it calls `get_ticket` / `list_tickets` / `search_knowledge`, then answers with the similar
ticket number, the article title and the fix. That is the manager's whole requirement, live.

**Production is unaffected:** `MASTRA_STUDIO_NO_AUTH` is absent from `docker-compose.yml` and
`config-issues.ts` refuses it when `NODE_ENV=production`.

---

## 6. Your manager's task — the helpdesk agent

**Requirement:** ticket comes in → look at similar tickets → give the customer the resolution.

**Your project already has every tool for this** (`server/mcp/*.ts`):

| Step | Tool | What it does |
|---|---|---|
| Read the ticket | `get_ticket(includeComments)` | one ticket by id or `TKT-…` |
| **Find similar tickets** | `list_tickets` + `get_ticket_history` | same category/keywords, how they were resolved |
| **Find the resolution** | `search_knowledge` → `get_knowledge_article` | the canonical fix |
| Extra | `search_documents` / `get_document` | help documents |
| Who owns it | `list_teams` / `list_departments` | owning team |
| Reply | `propose_comment` | draft → user confirms (never auto-posts) |

### 6.1 Add the helpdesk instructions

Edit `agents/src/mastra/agents/ticket-assistant.ts` — replace `STAFF_INSTRUCTIONS` with:

```ts
export const STAFF_INSTRUCTIONS = `You are TicketFlow's Helpdesk Agent. You help support staff
resolve a ticket by reusing what already worked for similar tickets.

Process, in order:
1. READ the ticket with get_ticket(includeComments). Summarise the problem in one line.
2. FIND SIMILAR tickets: list_tickets using the same category and the problem's key words
   (e.g. "invoice", "duplicate charge", "SSO"). Then get_ticket_history on the closest
   matches to see which were resolved and how.
3. FIND THE RESOLUTION: search_knowledge with those key words, then get_knowledge_article
   on the best match. Use search_documents/get_document when the KB is thin.
   Cite the article title and the ticket numbers you used.
4. ANSWER as a customer-ready reply: direct answer first, then the steps, then what
   happens next. Name the owning team from list_teams/list_departments only if the
   ticket has no owner.
5. PROPOSE, don't post: prepare the reply with propose_comment. Tell the user it is ready
   to review and confirm on the card. Never say a comment was posted.

${SAFETY_RULES}
${FORMAT_RULES}`;
```

Then restart Studio:

```powershell
docker compose -f docker-compose.yml -f docker-compose.studio.yml up -d --build agents-studio
```

Refresh `http://localhost:4111` → Agents → `ticket-assistant` → the new instructions are there.

### 6.2 Add the skill

Create `agents/skills/helpdesk-resolution/SKILL.md`:

```markdown
---
name: helpdesk-resolution-from-similar-tickets
description: Resolve a TicketFlow ticket by reusing the fix from similar past tickets and the knowledge base.
version: 1.0.0
---

# When to use
A new or open support ticket needs a customer-ready resolution.

# Procedure
1. `get_ticket(includeComments)` — capture symptom, product area, category, impact.
2. `list_tickets` — same category + 2-3 key words from the symptom. Keep the 3 closest.
3. `get_ticket_history` — for each: was it closed as solved? by which team? after what action?
4. `search_knowledge` -> `get_knowledge_article` — the canonical fix. If none, `search_documents`.
5. Draft: one-line answer, numbered steps, expected result, next step.
6. `propose_comment` — never `add_comment` unless the user explicitly says "post it".

# Quality bar
- Every claim traceable to a tool result (article title or ticket number).
- No internal notes, no other customers' data, no guessed numbers.
- If nothing matches: "No existing fix found" + who should own it.
```

### 6.3 Prove it with evals

```powershell
cd agents
npm run eval
```

Then in Studio: **Evaluation → Datasets** → `ticketflow-assistant-evals`.

Add a helpdesk case in `agents/src/mastra/datasets/cases.ts`:

```ts
{ id: 'helpdesk-similar-invoice', group: 'tools',
  prompt: 'Customer was charged twice for INV-2026-0412. Find similar tickets and the fix.',
  expectTools: ['get_ticket', 'list_tickets', 'search_knowledge'],
  mustIncludeAny: [['duplicate', 'charged twice']],
  mustNotInclude: ['posted'] }
```

---

## 7. Your 1-day clock

| Time | Do | Output |
|---|---|---|
| 0:00–0:15 | Run the start command, open 4111, confirm 200 | Studio open |
| 0:15–1:15 | Tour 4.1 → 4.11, click every page once | one note per page |
| 1:15–2:00 | Read `ticket-assistant.ts` + `rules.ts` + `mcp.ts` | you can explain the agent |
| 2:00–3:00 | 6.1 helpdesk instructions + 6.2 skill, rebuild | the agent |
| 3:00–4:00 | 6.3 evals: run, open dataset, add a case | score |
| 4:00–5:00 | Experiments: run A → change prompt → run B → compare | before/after |
| 5:00–6:00 | Traces: open a run, screenshot tool calls | evidence |
| 6:00–7:00 | Write the demo script (section 8) | 10-min demo |
| 7:00–8:00 | Rehearse, fix anything that breaks | ready |

---

## 8. Demo script (say it in this order)

1. "Studio is the UI over the same REST API the app uses — Swagger at `/swagger-ui` proves it."
2. "Here is the helpdesk agent's process, encoded as instructions + a skill."
3. "Here is the tool that finds similar tickets — run live."
4. "Here is the same flow scored: dataset → experiment → score."
5. "Here is the trace: every tool call, every token, the article it used."
6. "Live customer replies happen in the app because the run identity (tenant isolation) is issued there. Studio is where we iterate, measure and debug."

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `localhost:4111` refused | `docker compose -f docker-compose.yml -f docker-compose.studio.yml up -d agents-studio`, wait 45s |
| Container restarting | `docker logs ticketflow-main-agents-studio-1` — usually a bad env value |
| 401 on `/api/agents` | `MASTRA_STUDIO_NO_AUTH: "true"` missing from `docker-compose.studio.yml` |
| Datasets empty after restart | `MASTRA_DATABASE_URL` must be `@postgres:5432` |
| `dataset item identities conflict` | `npm run eval -- --reset` |
| Model errors | `ASSISTANT_MODEL` must match the provider. `openai` + `gpt-5-mini` **is valid** (verified: answers in ~6s) |
| Studio chat says "No assistant run" | run `docker exec ticketflow-main-app-1 node scripts/db/seed-eval-users.mjs` |
| App container restarting | `DATABASE_URL` must be `@postgres:5432`, not `localhost:5433` |

---

## 10. References

- [Studio overview](https://mastra.ai/docs/studio/overview) · [Studio auth](https://mastra.ai/docs/studio/auth) · [Studio deployment](https://mastra.ai/docs/studio/deployment)
- [Agents](https://mastra.ai/docs/agents/overview) · [Tools](https://mastra.ai/docs/agents/tools) · [Processors](https://mastra.ai/docs/agents/processors) · [Memory](https://mastra.ai/docs/memory/overview) · [MCP](https://mastra.ai/docs/connections/mcp)
- [Workflows](https://mastra.ai/docs/workflows/overview) · [Evals](https://mastra.ai/docs/evals/overview) · [Observability](https://mastra.ai/docs/observability/overview) · [CLI](https://mastra.ai/reference/cli/mastra)
- Companion: `docs/mastra-studio-1day.md`, `docs/helpdesk-agent-studio-playbook.md`
