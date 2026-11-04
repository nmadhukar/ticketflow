# TicketFlow assistant sidecar

The in-app assistant's Mastra service. It runs as the `agents` service in `docker-compose.yml`,
next to the app, and is reachable only by the app over the internal `assistant` network. It has no
published port and nginx does not proxy it.

| Agent | Who gets it |
|---|---|
| `support-assistant` | customers |
| `ticket-assistant` | agents, managers and admins (each with their own permissions) |

## How a request is authenticated

The app accepts a signed-in user's chat request, opens a run and sends this service two tokens:

- `Authorization: Bearer <agent-hop token>`: verified here (`src/mastra/session-token.ts`) with
  `ASSISTANT_AGENT_SECRET`. It names the user, the agent and the run, and lasts five minutes.
- `X-TicketFlow-MCP-Session: <MCP-hop token>`: forwarded, unread, on every tool call to the app's
  internal MCP endpoint (`ASSISTANT_MCP_URL`). It is signed with `ASSISTANT_SESSION_SECRET`, which
  only the app holds, so this service cannot mint one. The app reloads the user on every call.

A token allows one thing: running that user's own agent (and, for staff, reading their own saved
conversations). Every other Mastra route is refused. The app mints both tokens in
`server/assistant/`; `server/__tests__/unit/assistant/sessionToken.contract.test.ts` keeps the two
implementations in step.

## Configuration

See `.env.example`. The service refuses to start, naming the setting, when a setting is invalid, and
also when it is given `ASSISTANT_SESSION_SECRET` (app only) or, in production, `TICKETFLOW_MCP_KEY`.
With `ASSISTANT_ENABLED` other than `true` it runs in standby: `/health` 200, `/ready` 503, nothing
else served.

## Commands

```sh
npm ci
npm run check   # typecheck
npm test        # node --test
npm run dev     # local Studio (needs .env, see .env.example)
npm run build   # what the Docker image runs
npm run eval    # answer-quality evals against a running TicketFlow (see below)
```

## Evals

`evals/` asks fixed questions as real users of a running TicketFlow (app, this service and the
model), and checks each answer by rule. Each question is a real model call.

- What the cases check: `evals/cases.mjs`.
- The data they ask about: `evals/fixtures.mjs`, created through the app's API.
- `tests/evals-grade.test.mjs` proves the grader fails bad answers.

Never run evals against production. How to run them, and what they cost:
`docs/deployment/ASSISTANT_ROLLOUT.md`. Re-run them after changing a model or the instructions in
`src/mastra/agents/`.

Versions are pinned exactly. `@mastra/server` and `@mastra/deployer` are pinned through
`overrides` to match `@mastra/core`: the CLI would otherwise bundle a newer server than the core it
runs on, which crashes at start. The image build also fails if the bundle imports a name the
installed packages lack (`scripts/check-bundle-imports.mjs`).
