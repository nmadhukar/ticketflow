# DeepSeek Harness wiring kit

This folder holds the pieces that connect a DeepSeek Harness to TicketFlow's MCP
endpoint. The harness is a separate product with its own image and network, so the
connection is configuration an operator applies. Nothing here changes TicketFlow.

Files:

- `cordis.patch.yml` - the harness profile patch that registers TicketFlow as an
  MCP tool source (`@deepseek-ai/dsh-mcp-client`, streamable HTTP).
- `attach-dsh-network.sh` - joins a running harness container to the TicketFlow
  Docker network so it can resolve the app.

## 1. Issue a scoped key

An admin issues the key: Admin > Integrations > Developer resources, or
`POST /api/api-keys` with `{ "userId": "<agent user id>", "name": "dsh-agent" }`.
The plaintext is shown once (`tfk_...`). Every key is already scoped to
`mcp:tickets`; the caller never chooses permissions. Store it in the harness
container's environment as `TICKETFLOW_MCP_KEY`, never in a file.

## 2. Reach the endpoint

TicketFlow's MCP endpoint is `POST /api/mcp`, authenticated by
`Authorization: Bearer <key>` and an `Accept` header for
`application/json, text/event-stream`. It is a single stateless transport: one
fresh server per request, `initialize` then `tools/list` then `tools/call`.

A harness in a container reaching an app on the same PC has two names for it:

- app running in Docker Compose on the same network: `http://app:5000/api/mcp`;
- app running on the host (`npm run dev`): `http://host.docker.internal:5000/api/mcp`.

## 3. Join the networks

```bash
bash scripts/ai/dsh/attach-dsh-network.sh          # harness container "dsh-local"
bash scripts/ai/dsh/attach-dsh-network.sh my-dsh   # or name it explicitly
```

## 4. Register the tools and verify

Mount or copy `cordis.patch.yml` into the harness profile and start it with
`--patch`. Then confirm the handshake:

1. `initialize` returns `serverInfo.name = "ticketflow"` and the document-search
   instructions;
2. `tools/list` returns the ticket, app and document tools (the list is the
   source of truth, not a count written down here);
3. call a read-only tool such as `list_tickets` with `{ "limit": 10 }` and check
   the result matches the same user's REST answer.

`mcp:tickets` is not read-only: the same list carries `create_ticket`,
`update_ticket` and `add_comment`. A client that must stay read-only enforces
that itself.
