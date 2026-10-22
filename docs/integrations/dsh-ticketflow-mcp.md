# DSH to Ticketflow MCP handoff

Status: endpoint contract plus a checked-in wiring kit (`docs/integrations/dsh/`). The harness connection itself is an operator action: one `docker network connect` and one key in the harness environment. DSH's MCP tools default off; enable MCP in the harness before expecting tools to appear.

## Ticketflow endpoint

Use `https://<ticketflow-host>/api/mcp` with `POST`. Ticketflow implements stateless Streamable HTTP carrying MCP JSON-RPC. Send `Authorization: Bearer <Ticketflow API key>` and an `Accept` header that permits `application/json, text/event-stream`.

For `POST`, a missing bearer credential receives HTTP 401 and `WWW-Authenticate: Bearer`. An invalid, revoked, or expired bearer is rejected by the bearer middleware with HTTP 401 and `WWW-Authenticate: Bearer error="invalid_token"`. A valid API key without `mcp:tickets` receives HTTP 403 and `WWW-Authenticate: Bearer error="insufficient_scope"`. A session cookie alone is not accepted. Ticket access follows the key owner's permissions and visibility.

The endpoint is POST-only. Other HTTP methods receive 405 with `Allow: POST` when no invalid bearer is present; an invalid bearer is rejected first with 401. The 405 response does not set `WWW-Authenticate`. Each request creates a fresh MCP server and transport; the endpoint does not create an MCP session.

## Discovery and first read

An MCP client first sends `initialize`, then `tools/list`, then calls a listed tool with `tools/call`. Use a read-only tool for initial validation. For example, call `list_tickets` with `limit: 10` and `offset: 0`.

`list_tickets` accepts optional `status`, `priority`, `category`, `assigneeId`, and `search` filters. `limit` accepts a number or numeric string from 1 through 100; it defaults to 25. `offset` accepts a number or numeric string of 0 or greater; it defaults to 0. The result includes `total`, `returned`, `limit`, `offset`, and `hasMore`. When `hasMore` is true, request the next page with `offset + returned`.

Other read-only ticket tools include `get_ticket` (`id`, optional `includeComments: true`) and `get_ticket_history` (`id`). `list_activity` and `get_stats` also read ticket data. Ticket reads are limited to records the key owner may see.

Important: `mcp:tickets` is not a read-only permission. The same tool list also includes ticket mutation tools such as `create_ticket`, `update_ticket`, `close_ticket`, `reopen_ticket`, `delete_ticket`, and `add_comment`. A client that needs read-only behavior must enforce that policy itself; do not call mutation tools during initial validation.

## DSH deployment status and prerequisites

The DC4 source Compose default publishes DSH on `127.0.0.1:3080` for its web UI. The current local Docker test container maps host `127.0.0.1:3090` to container port `3080`; this is a separate test mapping, not the DC4 default. Both ports serve the DSH web UI. Neither is a Ticketflow MCP client endpoint or an MCP proxy.

The harness container runs on its own Docker network; the TicketFlow app runs on `ticketflow-main_ticketflow-network`. `scripts/ai/dsh/attach-dsh-network.sh` joins the two with `docker network connect` (idempotent; no container is recreated), and `docs/integrations/dsh/cordis.patch.yml` is the harness profile entry that registers this endpoint. The runbook is `docs/integrations/dsh/README.md`.

This document records the endpoint contract; the client configuration lives in `docs/integrations/dsh/`. A live connection still needs the network join and a scoped Ticketflow API key (an admin issues it; every key already carries `mcp:tickets`). Store the key through the harness's approved secret mechanism as `TICKETFLOW_MCP_KEY`; never place its value in this document or logs.

## Source references

- `server/mcp/router.ts`: mount behavior, POST-only transport, permission check, and 401/403 responses.
- `server/mcp/server.ts`: server identity and tool registration.
- `server/mcp/tools.ts`: ticket tool names and input fields.
- `server/mcp/appTools.ts`: additional read-only app tool names and fields.
- `server/services/auth/apiKeys.ts`: API-key permission and owner handling.
- `docs/integrations/dsh/`: the harness profile patch, the network-attach script and the runbook.
- `docs/superpowers/specs/2026-10-04-ticketflow-openrouter-openapi-design.md`: DSH runtime and network snapshot.
- `deepseek-harness-dc4/docker-compose.yml`: DC4 source default host and container ports.
- Local Docker inspection: `dsh-local` publishes `127.0.0.1:3090` to container `3080`; local Ticketflow and DSH use distinct networks.
