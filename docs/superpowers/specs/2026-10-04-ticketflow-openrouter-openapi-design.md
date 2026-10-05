# Ticketflow OpenRouter and OpenAPI design

Date: 2026-10-04
Status: design for review
Branch base: `0ed84c1` (UI polish, deployed locally)

## Intent and acceptance

Ticketflow must use OpenRouter for its LLM features, expose an accurate OpenAPI 3.1 specification for its documented ticket, AI, admin, and MCP HTTP surface, and remain compatible with its existing ticket MCP endpoint. The local DSH harness is available for testing but is not yet an MCP integration target. Success means ticket analysis, reply generation, chat, knowledge workflows, admin configuration, usage limits, and attachment storage work without the Bedrock Runtime SDK; the existing MCP contract and UI tests still pass; and the OpenAPI document can be validated against implemented routes.

## Evidence and constraints

`bedrockIntegration.ts` is not the only model caller: `aiTicketAnalysis.ts`, `knowledgeBase.ts`, and `knowledgeBaseLearning.ts` use the Bedrock client directly. Route guards, auto-response creation, and cost monitoring also inspect Bedrock settings. `bedrock_settings` stores business settings and AWS credentials used by `s3Service.ts`; removing that table or the S3 SDK would break attachments. Existing REST routes are registered imperatively, with cookie-session auth on most operations, route-specific admin and ticket checks, and API-key auth for `POST /api/mcp`.

Runtime snapshot (2026-10-04, local Docker Desktop): `dsh-local` reported an OpenRouter key configured. A fixed harmless prompt sent from that container to OpenRouter returned HTTP 200, model `deepseek/deepseek-v4-pro`, text `OK`, and 14 prompt / 38 completion tokens; `dsh --profile headless --patch /opt/dsh-seed/web-profile.patch.yml` returned `OK`. No request ID was retained, so this is connectivity/function evidence, not billing or Ticketflow integration proof. DSH's pinned local image exposes an authenticated web UI, not a documented Ticketflow-facing MCP endpoint or OpenRouter proxy. Its MCP panel is excluded. Ticketflow's Docker and DSH currently use separate networks.

## Approaches considered

1. **Recommended: Ticketflow-owned model boundary with direct OpenRouter HTTP.** Replace all Bedrock Runtime call sites behind one typed interface. Keep the old schema for S3 and image rollback, while new AI settings become provider-neutral. This covers all model workflows and preserves a clean future MCP boundary.
2. Swap the Bedrock request inside `bedrockIntegration.ts` only. This is faster but leaves direct SDK callers, Bedrock readiness checks, cost accounting, and the admin screen broken or misleading.
3. Send Ticketflow prompts through DSH. The local DSH service has no supported model-proxy endpoint, so this would depend on private browser RPC behavior and couple two products unnecessarily.

## Model execution and errors

Create a server-only `AiModelClient` interface for text generation. Input includes operation, messages or prompt, output-token cap, temperature, optional structured-output schema, and request context. Output includes text, requested and actual model, prompt/completion tokens, generation ID, and estimated or verified cost. One OpenRouter adapter calls `POST https://openrouter.ai/api/v1/chat/completions` with `fetch`, a bounded timeout, `AbortController`, and `Authorization: Bearer` from `OPENROUTER_API_KEY`. Default model is `deepseek/deepseek-v4-pro`, configurable by an admin; no OpenAI API account or SDK is involved. Do not assume a 16-token completion produces visible text from a reasoning model; use operation-appropriate budgets and treat empty content as a failed generation.

Migrate every model call, readiness check, and response parser to that boundary. Preserve the public behavior of ticket analysis, automatic and manual reply generation, knowledge creation/search, chat, and associated API responses. Validate structured results before writes; request JSON-schema output only when the selected model supports it and otherwise use the existing parser with explicit validation. Handle 401/403, 402, 408/timeouts, 429, and 5xx as distinct server-side failures. Never log credentials, raw prompts, ticket bodies, or provider response bodies. A connection test uses a fixed harmless prompt and reports a masked configuration state plus actionable status.

## Settings, cost, and storage migration

Use an additive migration for provider-neutral `ai_settings` containing selected model, existing feature toggles, thresholds, token and spending limits. Copy current non-secret settings from the active `bedrock_settings` row once; new writes also update equivalent legacy business fields during the rollback window. Never copy an OpenRouter model slug into legacy `bedrockModelId` or overwrite legacy AWS credentials. The old Bedrock provider settings remain available to the old image. The OpenRouter key is deployment configuration only, never returned to the browser or persisted in the database. The admin AI page edits model and feature/cost controls and shows whether the server key is configured; it does not display or edit the key. Keep `bedrock_settings` and AWS credential fields intact for `s3Service.ts` and rollback. Move AWS credential controls out of the AI model panel into clearly labeled storage settings while retaining their existing backend storage path until a separate S3 migration. Regression checks cover S3 upload, presigned download/read, and deletion with the retained credentials and bucket. Remove only `@aws-sdk/client-bedrock-runtime`; keep AWS S3/SES packages.

Preserve the daily, monthly, and per-request enforcement semantics. Retrieve the selected model's prompt/completion prices from OpenRouter's model metadata and cache a bounded snapshot. Preflight conservatively with the expected prompt and allowed maximum completion; fail closed if a usable price is unavailable. Record actual token counts and a price-based estimate in `ai_usage`. If the generation metadata later supplies billed `total_cost`, reconcile that row and label the dashboard's estimate/verified state. Do not use `BEDROCK_PRICING` for OpenRouter or describe estimates as exact charges. Retain old cost history and the old Bedrock model/credential fields. Before activation, verify the previous image still boots against the additive schema and, when Bedrock was configured before migration, its connection test can run with retained credentials. Backout means stop the new app, restore the pre-OpenRouter image and previous Compose environment, restart only the app, then verify health, the old AI test if previously configured, S3 operations, and MCP. Do not run a destructive down migration during backout; the new `ai_settings` table remains inert to the old image.

## HTTP and MCP contracts

Add a validated OpenAPI 3.1 YAML document under `docs/openapi/` and make it available to tooling. The first release covers the HTTP surface touched by this migration plus core ticket operations: authentication/session, ticket list/detail/create/update/delete and comments/history, AI analysis/reply/chat/knowledge, provider settings/test/usage, and the MCP HTTP mount. Describe real request/response bodies, status codes, cookie auth, admin/ticket access rules, and multipart operations where included. Mark uncovered legacy REST routes explicitly as outside initial coverage; do not claim the document describes every route. Keep an explicit in-scope route manifest and test that each named method/path exists in Express and in the OpenAPI document, including canonical AI routes, compatibility aliases such as `/api/bedrock/usage`, and chat session/history routes. Existing Bedrock-named URLs used by clients remain compatibility aliases during migration; new provider-neutral URLs become canonical. The MCP path is documented as a Streamable HTTP JSON-RPC transport with bearer API key and `mcp:tickets`, not as ordinary REST tool operations. WebSocket upgrades are outside OpenAPI.

The DSH handoff document will describe Ticketflow's MCP URL, transport, API-key scope and expected discovery/tool calls without adding credentials or enabling a live DSH connection. A later integration requires a supported MCP client configuration in the pinned DSH version and a deliberately configured Docker network path. The web UI on port 3090 is not an MCP proxy.

## Rollout and proof

1. Add schema and settings compatibility tests, then implement the provider boundary and migrate all callers. Keep the old DB table for S3 and rollback; do not auto-enable AI without `OPENROUTER_API_KEY`.
2. Add provider-neutral routes and UI, OpenAPI document and validation/route-coverage checks, and DSH MCP handoff documentation.
3. Run typecheck/build, full server and client tests, focused provider error/budget tests, MCP protocol/auth tests, and Chromium UI tests. Confirm no Bedrock Runtime imports or guards remain on active AI paths and S3 upload, presigned read, and delete checks still pass.
4. Build the local Ticketflow image, inject its own OpenRouter key through Docker configuration, run a harmless authenticated AI smoke query and MCP read-only handshake, then verify health/UI. The existing DSH query proves its own OpenRouter configuration only; it does not prove Ticketflow integration.
5. Push a feature branch and merge through the repository's approved GitHub process. Remote `main` currently has an update ruleset that blocks PR #6 even for administrator merge; do not change or bypass that policy as part of this design.

## References

- OpenRouter chat completions: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- OpenRouter model metadata/pricing: https://openrouter.ai/docs/api/api-reference/models/get-models
- OpenRouter generation billing metadata: https://openrouter.ai/docs/api/api-reference/generations/get-generation
- OpenAPI 3.1.1: https://spec.openapis.org/oas/v3.1.1.html
