# DSH to Ticketflow MCP handoff

Status: handoff only. No DSH connection is configured or enabled.

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

The inspected local DSH container uses Docker network `dsh-local_default`; the local Ticketflow app uses `ticketflow-local_ticketflow-network`. No network path between these networks is configured. DSH still has no documented supported client configuration for this Ticketflow MCP endpoint.

This document records endpoint details only. It does not configure a client, add a Docker network, provision credentials, or make a live connection. A later integration requires confirming supported MCP client configuration in the pinned DSH version, deliberately configuring Docker network access, and provisioning a separate Ticketflow API key for the intended owner. Store that key through the approved secret mechanism; never place its value in this document or logs.

## Source references

- `server/mcp/router.ts`: mount behavior, POST-only transport, permission check, and 401/403 responses.
- `server/mcp/server.ts`: server identity and tool registration.
- `server/mcp/tools.ts`: ticket tool names and input fields.
- `server/mcp/appTools.ts`: additional read-only app tool names and fields.
- `server/services/auth/apiKeys.ts`: API-key permission and owner handling.
- `docs/superpowers/specs/2026-10-04-ticketflow-openrouter-openapi-design.md`: DSH runtime and network snapshot.
- `deepseek-harness-dc4/docker-compose.yml`: DC4 source default host and container ports.
- Local Docker inspection: `dsh-local` publishes `127.0.0.1:3090` to container `3080`; local Ticketflow and DSH use distinct networks.
