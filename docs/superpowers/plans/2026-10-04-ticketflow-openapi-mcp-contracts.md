# Ticketflow OpenAPI and MCP Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an accurate, validated OpenAPI 3.1 contract for Ticketflow’s first-release REST surface and document a safe DSH handoff to Ticketflow’s existing MCP endpoint.

**Architecture:** Keep an explicit required method/path inventory in the test and mirror it in the JSON route manifest. Validate the document and compare required and manifest routes against OpenAPI and Express. Describe MCP as its existing stateless Streamable HTTP JSON-RPC endpoint; document handoff only, with no DSH connection or credentials.

**Tech Stack:** TypeScript, Express, Jest, Supertest, OpenAPI 3.1 YAML, `@redocly/cli` 2.57.0, `yaml` 2.9.1, existing `@modelcontextprotocol/sdk` Streamable HTTP transport, Docker Compose test database.

**Spec:** `docs/superpowers/specs/2026-10-04-ticketflow-openrouter-openapi-design.md`

## Global Constraints

- The HTTP contract uses OpenAPI 3.1.
- The first release covers authentication/session, core ticket operations, AI analysis/reply/chat/knowledge, provider settings/test/usage, and the MCP HTTP mount.
- Mark uncovered legacy REST routes explicitly as outside initial coverage; do not claim the document describes every route.
- Existing Bedrock-named URLs used by clients remain compatibility aliases during migration; new provider-neutral URLs become canonical.
- The MCP path is documented as a Streamable HTTP JSON-RPC transport with bearer API key and `mcp:tickets`, not as ordinary REST tool operations.
- WebSocket upgrades are outside OpenAPI.
- The DSH handoff describes Ticketflow’s MCP URL, transport, API-key scope, and expected discovery/tool calls without adding credentials or enabling a live DSH connection.
- DSH’s local web UI on port 3090 is not an MCP proxy.

## Review Focus

- Session cookie and bearer API-key auth differ by route; document actual accepted schemes and test MCP rejection of missing, invalid, or under-scoped keys in `server/__tests__/integration/mcp/auth.test.ts`.
- Admin, staff, and ticket visibility checks add authorization beyond authentication; keep per-operation descriptions accurate and retain ticket access regression coverage in `server/__tests__/integration/contract.docs.test.ts`.
- Redirect compatibility aliases must preserve method and body; document `/api/ai/chat` and `/api/ai/chat/history/{sessionId}` as redirects and test their 307 behavior in `server/__tests__/integration/contract.docs.test.ts`.
- Express registration introspection misses mounted routers and post-registration health routes; preserve explicit exceptions and real HTTP probes in `server/__tests__/integration/contract.docs.test.ts`.
- Multipart attachment requests and Streamable HTTP JSON-RPC have distinct content types and response behavior; validate multipart schemas in OpenAPI and cover MCP transport/auth in existing MCP integration tests.

---

### Task 1: Create the scoped OpenAPI document and route manifest

**Files:**
- Create: `docs/openapi/ticketflow.yaml`
- Create: `docs/openapi/route-manifest.json`
- Reference: `server/routes/index.ts`
- Reference: `server/routes/email.ts`
- Reference: `server/routes/teams.ts`
- Reference: `server/admin/index.ts`
- Reference: `server/admin/apiKeys.ts`
- Reference: `server/http/install.ts`
- Reference: `server/mcp/router.ts`
- Reference: `server/index.ts`

**Interfaces:**
- Produces: `route-manifest.json` is the explicit list of covered `{method, path}` pairs plus named out-of-scope areas. Express paths use `:param`; OpenAPI paths use `{param}`.
- Consumes: `POST /api/mcp` is mounted by `app.use` and runs `requireMcpKey`; ordinary REST routes use the existing session/bearer middleware and route-specific checks.

- [ ] **Step 1: Record exact in-scope route groups from Express registrations**

Inspect these route groups and record only implemented method/path pairs:

```text
Auth/session: /api/auth/* and Microsoft auth routes registered by server/services/auth and server/services/auth/microsoftAuth.ts
Tickets: /api/tasks, /api/tasks/:id, /api/tasks/:id/history, /api/tasks/:id/comments, /api/tasks/:id/attachments
AI analysis/reply: /api/ai/analyze-ticket, /api/ai/generate-response, /api/tasks/:id/auto-response and its apply/generate/feedback operations
Chat: /api/chat, /api/chat/:sessionId, /api/chat-sessions, /api/ai/chat, /api/ai/chat/history/:sessionId
Knowledge: /api/ai/knowledge-search, /api/knowledge/search, /api/knowledge-base/search, /api/knowledge/articles, /api/admin/knowledge and covered article feedback/view operations
AI settings/usage: /api/admin/ai-settings, /api/admin/ai-settings/test, /api/bedrock/settings, /api/bedrock/usage, /api/bedrock/cost-statistics, /api/bedrock/cost-limits, /api/bedrock/reset-usage, /api/bedrock/export-usage, /api/bedrock/test-connection
MCP: POST /api/mcp (mounted router)
```

Confirm every listed path, method, and alias against source. Include provider-neutral AI settings/test/usage routes created by the provider migration when present in the implementation branch. Record all initial-coverage exclusions explicitly; exclude WebSocket upgrades.

- [ ] **Step 2: Write the route manifest**

Use this shape and fill it with the verified method/path pairs, not inferred client calls:

```json
{
  "inScope": [
    { "method": "GET", "path": "/api/tasks" },
    { "method": "POST", "path": "/api/tasks" },
    { "method": "POST", "path": "/api/mcp" }
  ],
  "outOfScope": ["Uncovered legacy REST routes", "WebSocket upgrades"]
}
```

Include auth/session; ticket list/detail/create/update/delete, comments/history and covered attachment operations; AI analysis/reply/chat/knowledge; provider-neutral settings/test/usage; compatibility routes such as `/api/bedrock/usage`; chat session/history routes; and MCP.

- [ ] **Step 3: Define OpenAPI security schemes and operation contracts**

Set `openapi: 3.1.0`, define cookie-session and HTTP bearer security schemes, and describe operation-specific auth in each operation. Inspect `server/services/auth/bearer.ts`, `server/admin/apiKeys.ts`, `server/permissions/staff.ts`, `server/permissions/ticketAccess.ts`, and route middleware before writing security descriptions. Document admin/staff/ticket checks as authorization requirements, not as separate authentication schemes. Include request and response schemas, query/path parameters, status codes, and `multipart/form-data` for covered attachment routes.

- [ ] **Step 4: Describe MCP as a JSON-RPC transport operation**

Define `POST /api/mcp` with bearer API key security and the `mcp:tickets` permission. Describe JSON-RPC request/response envelopes and Streamable HTTP behavior. State that the endpoint is stateless, accepts POST, and uses `application/json`; do not invent ordinary REST paths for MCP tools. Document the actual 401 missing-key and 403 insufficient-scope outcomes from `server/mcp/router.ts`.

### Task 2: Add deterministic OpenAPI and Express parity gates

**Dependency:** Execute after provider migration plan Task 5 finishes its `package.json` and `package-lock.json` edits. Do not edit those files in parallel with provider Task 5.

**Files:**
- Modify: `package.json` (add `openapi:check`, pinned validator and YAML parser dev dependencies)
- Modify: `package-lock.json`
- Modify: `server/__tests__/integration/contract.docs.test.ts`
- Test: `server/__tests__/integration/mcp/auth.test.ts`
- Test: `server/__tests__/integration/mcp/createGetList.test.ts`

**Interfaces:**
- Consumes: `route-manifest.json` lists covered routes; a hard-coded required method/path inventory in Jest prevents silently omitting required routes.
- Produces: `npm.cmd run openapi:check` validates OpenAPI. Jest requires every inventory entry in the manifest and compares required and manifest routes against OpenAPI and Express, with explicit mounted MCP and health route handling.

- [ ] **Step 1: Extend the existing contract test for manifest parity**

Import and read `docs/openapi/route-manifest.json` and `docs/openapi/ticketflow.yaml` in `server/__tests__/integration/contract.docs.test.ts`. Hard-code required routes so edits cannot silently remove coverage:

```ts
const REQUIRED_ROUTES = [
  ["POST", "/api/auth/register"], ["POST", "/api/auth/login"],
  ["POST", "/api/auth/logout"], ["GET", "/api/auth/user"],
  ["POST", "/api/auth/forgot-password"], ["POST", "/api/auth/reset-password"],
  ["GET", "/api/tasks"], ["POST", "/api/tasks"],
  ["GET", "/api/tasks/:id"], ["PATCH", "/api/tasks/:id"],
  ["DELETE", "/api/tasks/:id"], ["GET", "/api/tasks/:id/history"],
  ["GET", "/api/tasks/:id/comments"], ["POST", "/api/tasks/:id/comments"],
  ["GET", "/api/tasks/:id/attachments"], ["POST", "/api/tasks/:id/attachments"],
  ["GET", "/api/ai/status"],
  ["GET", "/api/ai/settings"], ["POST", "/api/ai/settings"],
  ["POST", "/api/ai/test-connection"], ["GET", "/api/ai/usage"],
  ["GET", "/api/storage/aws-settings"], ["POST", "/api/storage/aws-settings"],
  ["GET", "/api/bedrock/settings"], ["POST", "/api/bedrock/settings"],
  ["GET", "/api/bedrock/usage"], ["GET", "/api/bedrock/cost-statistics"],
  ["PUT", "/api/bedrock/cost-limits"], ["POST", "/api/bedrock/reset-usage"],
  ["GET", "/api/bedrock/export-usage"], ["GET", "/api/bedrock/test-connection"],
  ["POST", "/api/ai/analyze-ticket"], ["POST", "/api/ai/generate-response"],
  ["POST", "/api/chat"], ["GET", "/api/chat-sessions"],
  ["POST", "/api/ai/chat"], ["GET", "/api/ai/chat/history/:sessionId"],
  ["POST", "/api/mcp"],
] as const;
for (const [method, path] of REQUIRED_ROUTES) {
  expect(manifest.inScope).toContainEqual({ method, path });
  expect(openapi.paths[toOpenApiPath(path)]?.[method.toLowerCase()]).toBeDefined();
  expect(isRegistered(routes, method, documentedSegments(path))).toBe(true);
}
```

Add exact existing auth and ticket CRUD/comment/history methods to `REQUIRED_ROUTES`. Reuse `registeredRoutes()` and `documentedSegments()`; compare additional manifest entries against OpenAPI and Express too. Require out-of-scope labels for uncovered legacy REST routes and WebSocket upgrades. Preserve existing Postman, reference-document, MCP 401, and health probes.

- [ ] **Step 2: Add an OpenAPI 3.1 validation command**

After provider Task 5 completes, add pinned development-only `@redocly/cli@2.57.0` and `yaml@2.9.1`, update the lockfile, and define:

```json
"openapi:check": "redocly lint docs/openapi/ticketflow.yaml"
```

Redocly must parse the full YAML and validate OpenAPI structure and references. Keep manifest/OpenAPI and manifest/Express parity in Jest; a valid YAML parse alone is insufficient. Run `npm.cmd run openapi:check` and expect exit code 0.

- [ ] **Step 3: Run the OpenAPI and route parity checks**

After provider Task 5 registers the canonical routes and aliases, parse `docs/openapi/ticketflow.yaml` with `parse` from pinned `yaml@2.9.1`. Then run parity assertions, including `/api/ai/test-connection`, against Express:

```ts
const toOpenApiPath = (path: string) =>
  path.replace(/:([^/]+)/g, "{$1}");
for (const route of manifest.inScope) {
  const path = toOpenApiPath(route.path);
  expect(openapi.paths[path]?.[route.method.toLowerCase()]).toBeDefined();
  expect(isRegistered(routes, route.method, documentedSegments(route.path))).toBe(true);
}
```

Run `npm.cmd run openapi:check` and `npm.cmd test -- --runTestsByPath server/__tests__/integration/contract.docs.test.ts`. Expect exit code 0. A missing method/path must fail with that pair in the Jest diff. Keep mounted `POST /api/mcp` as an explicit known mount validated by the real HTTP probe.

- [ ] **Step 4: Verify alias, auth, and mounted-router coverage**

Add focused assertions to `contract.docs.test.ts` for both compatibility redirects:

```ts
const postRedirect = await agent.post("/api/ai/chat").send({ message: "hello" });
expect(postRedirect.status).toBe(307);
expect(postRedirect.headers.location).toBe("/api/chat");

const historyRedirect = await agent.get("/api/ai/chat/history/session-1");
expect(historyRedirect.status).toBe(307);
expect(historyRedirect.headers.location).toBe("/api/chat/session-1");
```

Keep MCP credential/scope behavior in the existing auth suite. Run the parity test and MCP tests with the Docker-backed integration database:

```powershell
npm.cmd run test:db:up
npm.cmd run test:db:push
npm.cmd test -- --runTestsByPath server/__tests__/integration/contract.docs.test.ts server/__tests__/integration/mcp/auth.test.ts server/__tests__/integration/mcp/createGetList.test.ts
```

Expected: all manifest method/path pairs resolve; missing MCP credentials return 401, insufficient scope returns 403, valid scoped keys complete existing MCP calls, aliases redirect as documented, and no existing Postman contract regresses.

### Task 3: Write the DSH MCP handoff without connecting DSH

**Files:**
- Create: `docs/integrations/dsh-ticketflow-mcp.md`
- Reference: `server/mcp/router.ts`
- Reference: `server/mcp/tools.ts`
- Reference: `server/mcp/appTools.ts`
- Reference: `server/services/auth/apiKeys.ts`

**Interfaces:**
- Consumes: Ticketflow MCP transport is stateless Streamable HTTP at `POST /api/mcp`, authenticated by a Ticketflow API key carrying `mcp:tickets`.
- Produces: Handoff gives operators the URL pattern, transport/auth facts, discovery sequence, read-only first tool guidance, and prerequisites for a later DSH connection. It contains no credential value and enables no connection.

- [ ] **Step 1: Document URL, transport, scope, and tool discovery**

Describe the URL as `https://<ticketflow-host>/api/mcp`, `POST`, Streamable HTTP JSON-RPC, and `Authorization: Bearer <Ticketflow API key>`. State that the key must carry `mcp:tickets`; do not show a real key or a generated example token. Document the discovery sequence as `initialize`, `tools/list`, then a read-only ticket tool such as `list_tickets` with bounded pagination. Confirm exact tool names and input fields from `server/mcp/tools.ts` and `server/mcp/appTools.ts`.

- [ ] **Step 2: State DSH prerequisites and explicit non-connection status**

Explain that current DSH deployment has no documented supported client configuration for this Ticketflow endpoint and no configured network path. Port 3090 serves the DSH UI; it is not a Ticketflow MCP client endpoint or proxy. A later connection requires verified support in the pinned DSH version, deliberate Docker network access, and separately provisioned credentials. Do not add client config, network changes, or secrets.

- [ ] **Step 3: Cross-check handoff and final gates**

Run `npm.cmd run openapi:check` and the focused Docker-backed integration command from Task 2. Compare documented URL, key scope, methods, tool names, and auth failures with the OpenAPI document and MCP router. Confirm no DSH live call, secret, new network, or runtime configuration change appears in the diff.
