# Ticketflow OpenRouter Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every Ticketflow LLM workflow from Bedrock Runtime to a server-side OpenRouter HTTP client while retaining S3 and rollback compatibility.

**Architecture:** Add provider-neutral persisted AI settings and a typed `AiModelClient`; implement OpenRouter with built-in `fetch` and move all model callers and cost controls behind it. Preserve `bedrock_settings`, S3 credentials, usage history, and Bedrock URL aliases for rollback and compatibility. Coordinate canonical route names and compatibility aliases with the separate OpenAPI/MCP plan.

**Tech Stack:** TypeScript, Express 4, Drizzle ORM, PostgreSQL, React, Jest, Playwright, Docker Compose, Use existing `fetch`, Zod, and test stack; add no SDK or pricing dependency.

**Spec:** `docs/superpowers/specs/2026-10-04-ticketflow-openrouter-openapi-design.md`

## Global Constraints

- Keep `bedrock_settings` and its AWS credential fields intact for `server/services/s3Service.ts` and rollback.
- Never copy an OpenRouter model slug to legacy `bedrockModelId` or overwrite legacy AWS credentials.
- Keep `OPENROUTER_API_KEY` in deployment configuration only; never persist it or return it to a browser.
- Default model is `deepseek/deepseek-v4-pro`; provider requests use `POST https://openrouter.ai/api/v1/chat/completions`.
- Add no OpenAI API account, SDK, or speculative dependency; remove only `@aws-sdk/client-bedrock-runtime`, retaining AWS S3/SES packages.
- Preserve daily, monthly, and per-request enforcement semantics; preflight conservatively and fail closed when model price is unavailable.
- Never log credentials, prompts, ticket bodies, or raw provider response bodies.
- Preserve current AI workflows, existing Bedrock-named URL compatibility, ticket MCP contract, and old usage history.
- Do not perform a destructive down migration for rollback; old-image rollback leaves additive `ai_settings` inert.
- The parallel OpenAPI/MCP plan owns route manifest/spec validation and DSH MCP handoff documentation; this plan supplies implemented canonical and compatibility paths for that work to document.
- Do not enable AI without `OPENROUTER_API_KEY`; do not add DSH MCP connectivity or credentials.

## Review Focus

- Missing/empty deployment key or unset AI settings must keep model features safely unavailable; test readiness/status and connection-test responses.
- An unknown model price must prevent a request before provider invocation; test with price metadata unavailable.
- Empty reasoning-model output and malformed structured output must not create writes; test both at the client and calling workflow boundary.
- Provider 401/403, 402, timeout/408, 429, and 5xx must remain distinct and sanitized; test mapping and ensure response body/key/prompt are absent from logs.
- Old Bedrock settings and usage records, S3 credentials, and old-image behavior must survive the additive migration and app-only rollback; test migration compatibility and S3 operations.

---

### Task 1: Add provider-neutral AI settings schema and reversible migration

**Files:**
- Modify: `shared/schema.ts` (settings table/types and exports; preserve `bedrockSettings` and `aiUsage`)
- Modify: `server/storage/storage.inteface.ts` (provider-neutral settings methods)
- Modify: `server/storage/index.ts` (read/write/copy settings while retaining legacy methods used for storage and rollback)
- Create: `migrations/0023_ai_settings.sql` (use next sequence after `0022_users_last_failed_login.sql`)
- Create: `server/__tests__/integration/migration0023.test.ts`
- Test: `server/__tests__/integration/schemaSafety.test.ts`

**Interfaces:**
- Produces: provider-neutral settings with `modelId: string`; feature booleans; numeric thresholds/token limits; `dailyLimitUsd` and `monthlyLimitUsd` as decimal strings; optional escalation team; active/audit fields. Storage API: `getAISettings(): Promise<AISettings | undefined>` and `updateAISettings(patch: Partial<AISettings>, updatedBy: string): Promise<AISettings>`.

```ts
export interface AISettings {
  modelId: string; autoResponseEnabled: boolean; confidenceThreshold: number;
  maxResponseLength: number; responseTimeout: number; autoLearnEnabled: boolean;
  minResolutionScore: number; articleApprovalRequired: boolean; complexityThreshold: number;
  escalationEnabled: boolean; escalationTeamId?: number; temperature: number; maxTokens: number;
  dailyLimitUsd: string; monthlyLimitUsd: string; maxTokensPerRequest: number;
  maxRequestsPerMinute: number; isActive: boolean; updatedBy?: string;
}
```

- [ ] **Step 1: Add migration compatibility tests**

Write integration cases creating a legacy active `bedrock_settings` row with feature toggles and limits, an existing `ai_usage` row, and AWS credentials. Apply migration 0023 and assert copied values, retained legacy values/credentials and usage history; change `ai_settings.model_id`, reapply migration 0023, and assert the change survives. Assert `ai_settings` has no AWS credential or `bedrock_model_id` columns.

- [ ] **Step 2: Run the focused migration test and observe failure**

Run: `npm.cmd run test:integration -- --runTestsByPath server/__tests__/integration/migration0023.test.ts`
Expected: FAIL because migration 0023 and the new table are absent.

- [ ] **Step 3: Add the Drizzle schema and additive SQL migration**

Define the following singleton in `shared/schema.ts` and `migrations/0023_ai_settings.sql`; retain every legacy table/column. The fixed `id=1` plus `ON CONFLICT DO NOTHING` makes the copy rerunnable without overwriting later model/admin updates:

```sql
CREATE TABLE IF NOT EXISTS ai_settings (
 id integer PRIMARY KEY CHECK (id = 1),
 model_id varchar(255) NOT NULL DEFAULT 'deepseek/deepseek-v4-pro',
 auto_response_enabled boolean DEFAULT true, confidence_threshold numeric(3,2) DEFAULT 0.7,
 max_response_length integer DEFAULT 1000, response_timeout integer DEFAULT 30,
 auto_learn_enabled boolean DEFAULT true, min_resolution_score numeric(3,2) DEFAULT 0.8,
 article_approval_required boolean DEFAULT true, complexity_threshold integer DEFAULT 70,
 escalation_enabled boolean DEFAULT true, escalation_team_id integer REFERENCES teams(id),
 temperature numeric(3,2) DEFAULT 0.3, max_tokens integer DEFAULT 2000,
 daily_limit_usd numeric(10,2) DEFAULT 50.0, monthly_limit_usd numeric(10,2) DEFAULT 100.0,
 max_tokens_per_request integer DEFAULT 3000, max_requests_per_minute integer DEFAULT 20,
 is_active boolean DEFAULT true, updated_by varchar REFERENCES users(id),
 updated_at timestamp DEFAULT now(), created_at timestamp DEFAULT now()
);
INSERT INTO ai_settings (id, auto_response_enabled, confidence_threshold, max_response_length,
 response_timeout, auto_learn_enabled, min_resolution_score, article_approval_required,
 complexity_threshold, escalation_enabled, escalation_team_id, temperature, max_tokens,
 daily_limit_usd, monthly_limit_usd, max_tokens_per_request, max_requests_per_minute,
 is_active, updated_by, updated_at, created_at)
SELECT 1, auto_response_enabled, confidence_threshold, max_response_length, response_timeout,
 auto_learn_enabled, min_resolution_score, article_approval_required, complexity_threshold,
 escalation_enabled, escalation_team_id, temperature, max_tokens, daily_limit_usd,
 monthly_limit_usd, max_tokens_per_request, max_requests_per_minute, is_active, updated_by,
 updated_at, created_at FROM bedrock_settings WHERE is_active = true ORDER BY id LIMIT 1
ON CONFLICT (id) DO NOTHING;
```

Drizzle declares `id: integer("id").primaryKey().default(1)` plus table constraint `check("ai_settings_singleton_id", sql`${table.id} = 1`)`, matching SQL. Never copy credentials or `bedrock_model_id`. In the same migration add `requested_model_id varchar(255)`, `generation_id varchar(255)`, `verified_cost_usd numeric(10,6)`, and `billing_status varchar(16) NOT NULL DEFAULT 'estimated' CHECK (billing_status IN ('estimated','verified'))` to `ai_usage` with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; add partial unique index `CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_generation_id_uniq ON ai_usage(generation_id) WHERE generation_id IS NOT NULL` and matching Drizzle fields/index (`uniqueIndex(...).on(table.generationId).where(sql`${table.generationId} IS NOT NULL`)`). Keep `model_id` as actual model and `estimated_cost` as estimate.

- [ ] **Step 4: Implement provider-neutral storage methods**

Add the exact interface methods above to `storage.inteface.ts` and implement them in `storage/index.ts`. Preserve legacy `getBedrockSettings`/`updateBedrockSettings` for `s3Service.ts`; mirror compatible business fields only, never `bedrockModelId`, `bedrockAccessKeyId`, or `bedrockSecretAccessKey`. Store selected model only in `ai_settings.model_id`.

```ts
const [row] = await db.insert(aiSettings).values({ id: 1, ...patch, updatedBy })
  .onConflictDoUpdate({ target: aiSettings.id, set: { ...patch, updatedBy, updatedAt: new Date() } })
  .returning();
```

- [ ] **Step 5: Run schema, migration, and type checks**

Run: `npm.cmd run test:integration -- --runTestsByPath server/__tests__/integration/migration0023.test.ts server/__tests__/integration/schemaSafety.test.ts`
Run: `npm.cmd run check`
Expected: PASS; migration preserves legacy storage and repeated application.

### Task 2: Implement typed model boundary, OpenRouter adapter, errors, and pricing

**Files:**
- Create: `server/services/ai/aiModelClient.ts`
- Create: `server/services/ai/openRouterClient.ts`
- Create: `server/services/ai/openRouterPricing.ts`
- Create: `server/__tests__/unit/openRouterClient.test.ts`
- Create: `server/__tests__/unit/openRouterPricing.test.ts`
- Modify: `server/services/ai/aiErrors.ts`
- Modify: `server/env.ts`
- Test: `server/__tests__/unit/secrets.failclosed.test.ts`

**Interfaces:**
- Produces: `AiModelClient.generate(request: GenerateRequest): Promise<GenerateResult>` with these exact types:

```ts
export type GenerateRequest = {
  operation: string; messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxOutputTokens: number; temperature: number; responseSchema?: Record<string, unknown>;
  context?: { userId?: string; ticketId?: number };
};
export type GenerateResult = {
  text: string; requestedModel: string; actualModel: string; promptTokens: number;
  completionTokens: number; generationId?: string; estimatedCostUsd: number;
  verifiedCostUsd?: number;
};
export interface AiModelClient { generate(request: GenerateRequest): Promise<GenerateResult> }
```
- Produces: OpenRouter error mapping with stable codes for auth, credits, timeout, rate limit, provider failure, invalid/empty output; pricing API resolves cached model prompt/completion rates or explicit unavailable state.

- [ ] **Step 1: Write adapter contract tests using mocked `fetch`**

Test request URL, bearer header, selected model, messages, operation cap/temperature, AbortSignal timeout, usage/model/generation parsing, empty content rejection, and no raw body in safe errors. Add separate cases for 401/403, 402, 408/timeout, 429, and 5xx.

- [ ] **Step 2: Run focused tests and observe failure**

Run: `npm.cmd test -- --runTestsByPath server/__tests__/unit/openRouterClient.test.ts`
Expected: FAIL because client module is not implemented.

- [ ] **Step 3: Define the typed model-client contract and safe error type**

Add the shared request/result types and provider error codes in `aiModelClient.ts` and `aiErrors.ts`. Ensure error messages contain status/code only, never provider response content.

- [ ] **Step 4: Implement the OpenRouter fetch adapter**

Use native `fetch` and a 30-second `AbortSignal.timeout`. Read `OPENROUTER_API_KEY` server-side, default model to `deepseek/deepseek-v4-pro`, validate response JSON, and reject blank content. Include `generationId` only if supplied; never log request data.

```ts
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model, messages, max_tokens: maxOutputTokens, temperature }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw mapOpenRouterStatus(response.status);
const body = openRouterResponseSchema.parse(await response.json());
const text = body.choices[0]?.message.content?.trim();
if (!text) throw new AiModelError("empty_output");
```

- [ ] **Step 5: Add bounded, fail-closed model pricing lookup**

Implement model metadata retrieval from OpenRouter's models endpoint, normalize prompt/completion rates, and cache at most 500 model records for 15 minutes. Return unavailable on missing/malformed price or network failure; callers reject preflight. Add `reconcileGenerationCost(generationId: string): Promise<void>` to retrieve delayed billing metadata and update the unique usage row; set `verified_cost_usd` and `billing_status='verified'` only when billed total exists. Repeated polling is idempotent by generation ID; missing billed cost leaves status `estimated`.

```ts
type ModelPrice = { promptUsdPerToken: number; completionUsdPerToken: number };
const estimateCostUsd = (input: number, output: number, p: ModelPrice) =>
  input * p.promptUsdPerToken + output * p.completionUsdPerToken;
```

- [ ] **Step 6: Validate deployment key parsing without exposing it**

Add `OPENROUTER_API_KEY` to `server/env.ts` as an optional secret. Status/config output may report only configured boolean and masked readiness; add no key return path.

- [ ] **Step 7: Run provider boundary tests**

Run: `npm.cmd test -- --runTestsByPath server/__tests__/unit/openRouterClient.test.ts server/__tests__/unit/openRouterPricing.test.ts server/__tests__/unit/secrets.failclosed.test.ts`
Expected: PASS with sanitized distinct errors and preflight price state.

### Task 3: Move all model workflows and cost enforcement behind `AiModelClient`

**Files:**
- Modify: `server/services/ai/bedrockIntegration.ts` (preserve exported business-level helpers during caller transition; remove Bedrock Runtime usage)
- Modify: `server/services/ai/aiTicketAnalysis.ts`
- Modify: `server/services/ai/knowledgeBase.ts`
- Modify: `server/services/ai/knowledgeBaseLearning.ts`
- Modify: `server/services/ai/aiAutoResponse.ts`
- Modify: `server/services/ai/createTimeAutoResponse.ts`
- Modify: `server/services/ai/costMonitoring.ts`
- Modify: `server/services/ai/bedrockPrice.ts` (remove from active OpenRouter path; retain only if legacy rollback code needs it)
- Modify: `server/admin/aiSettings.ts`
- Modify: `server/routes/index.ts` (chat fallback/readiness/cost at existing lines around 2044–2285)
- Modify: `server/__tests__/integration/ai.routes.test.ts`
- Modify: `server/__tests__/integration/ai.caveats.test.ts`
- Modify: `server/__tests__/unit/aiAutoResponse.test.ts`
- Modify: `server/__tests__/mocks/aws-bedrock.mock.ts` (replace active AI mock boundary)
- Create: `server/__tests__/unit/aiBudget.test.ts`

**Interfaces:**
- Consumes: `AISettings` from Task 1 and `AiModelClient` / OpenRouter error / price contracts from Task 2.
- Produces: all active analysis, reply, chat, knowledge create/search/learning, automatic response, readiness, and usage paths use the OpenRouter client; `ai_usage` records requested/actual model, tokens, and estimated/verified cost.

- [ ] **Step 1: Add budget tests around existing semantics**

Test per-request output cap, daily/monthly limits, preflight at prompt plus max completion, absent-price fail-closed behavior, actual token persistence, and delayed verified-cost reconciliation that preserves estimates and is idempotent across repeated polls.

```ts
expect(() => assertBudgetAvailable({ promptTokens: 900, maxOutputTokens: 1200, price, settings, todayUsd: 0, monthUsd: 0 })).not.toThrow();
expect(() => assertBudgetAvailable({ promptTokens: 900, maxOutputTokens: 1200, price: undefined, settings, todayUsd: 0, monthUsd: 0 }))
  .toThrow(new AiModelError("price_unavailable"));
```

Define `assertBudgetAvailable(input: { promptTokens: number; maxOutputTokens: number; price?: ModelPrice; settings: AISettings; todayUsd: number; monthUsd: number }): void` in `costMonitoring.ts`; it rejects unavailable prices and projected request/daily/monthly limit breaches before provider invocation.

- [ ] **Step 2: Run budget tests and observe failure**

Run: `npm.cmd test -- --runTestsByPath server/__tests__/unit/aiBudget.test.ts`
Expected: FAIL until the provider-neutral accounting contract is integrated.

- [ ] **Step 3: Update settings access and cost monitoring**

Change `server/admin/aiSettings.ts` and `server/services/ai/costMonitoring.ts` to use provider-neutral settings, `modelId`, prices, and usage labels. Keep existing limit behavior; remove `BEDROCK_PRICING` from active calls. Persist `generation_id`, keep `estimated_cost` immutable, and expose `billing_status='estimated'` until Task 2 reconciliation receives billed total, then `verified`.

```ts
const result = await aiModelClient.generate({ operation: "ticket_analysis", messages,
  maxOutputTokens: settings.maxTokens, temperature: settings.temperature });
await costMonitoring.recordUsage({ modelId: result.actualModel, inputTokens: result.promptTokens,
  outputTokens: result.completionTokens, requestedModelId: result.requestedModel,
  generationId: result.generationId, estimatedCost: result.estimatedCostUsd, ticketId,
  billingStatus: "estimated" });
```

- [ ] **Step 4: Migrate ticket analysis and reply operations**

Adapt `aiTicketAnalysis.ts`, `aiAutoResponse.ts`, `createTimeAutoResponse.ts`, and `bedrockIntegration.ts` helpers to call `AiModelClient` with operation-specific budgets. Keep public response shapes and parse/validate structured output before writes; use JSON-schema mode only for models that advertise support.

```ts
const ticketAnalysisSchema = z.object({
  complexity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum(["bug", "feature", "support", "enhancement", "incident", "request"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  estimatedResolutionTime: z.number(), suggestedAssignee: z.string().optional(),
  tags: z.array(z.string()), confidence: z.number().min(0).max(100), reasoning: z.string(),
});
const generated = await aiModelClient.generate({ operation: "ticket_analysis", messages,
  maxOutputTokens: 1200, temperature: settings.temperature });
const analysis = ticketAnalysisSchema.parse(JSON.parse(generated.text)); // before DB writes
```

- [ ] **Step 5: Migrate knowledge operations**

Update `knowledgeBase.ts` and `knowledgeBaseLearning.ts` to the shared boundary. Insert articles only after schema validation; preserve search and learning behavior.

```ts
const article = z.object({ title: z.string().min(1).max(255), content: z.string().min(1),
  summary: z.string().nullable().optional(), category: z.string().nullable().optional(),
  tags: z.array(z.string()).optional() }).parse(JSON.parse(result.text));
await db.insert(knowledgeArticles).values(article);
```

- [ ] **Step 6: Migrate chat readiness and generation**

Replace the direct Bedrock readiness and helper path in `server/routes/index.ts` chat handlers with provider-neutral readiness and the shared client. Preserve the current knowledge fallback and distinguish missing configuration from provider errors.

```ts
if (!process.env.OPENROUTER_API_KEY || !settings.isActive)
  return res.status(503).json({ error: "ai_unavailable", reason: "provider_not_configured" });
```

- [ ] **Step 7: Replace SDK mock and exercise errors/workflows**

Move tests to mock `fetch` at the client boundary, retaining workflow assertions for AI responses, usage records, malformed output, and error conditions. Update `aws-bedrock.mock.ts` consumers or remove the mock only when all AI test imports are migrated.

- [ ] **Step 8: Run focused AI suite and typecheck**

Run: `npm.cmd test -- --runTestsByPath server/__tests__/unit/openRouterClient.test.ts server/__tests__/unit/openRouterPricing.test.ts server/__tests__/unit/aiBudget.test.ts server/__tests__/integration/ai.routes.test.ts server/__tests__/integration/ai.caveats.test.ts server/__tests__/unit/aiAutoResponse.test.ts`
Run: `npm.cmd run check`
Expected: PASS; confirm `rg -n "BedrockRuntime|BEDROCK_PRICING|bedrockIntegration" server/services/ai server/routes/index.ts` finds no direct model call or active provider guard (compatibility wrapper names can remain only if provider-neutral internally).

### Task 4: Add provider-neutral admin APIs and update AI/storage settings UI

**Files:**
- Modify: `server/routes/index.ts` (settings, test connection, usage, cost limits aliases around lines 1428–1595 and 2331–2490)
- Modify: `server/admin/aiSettings.ts`
- Modify: `client/src/pages/admin/Configuration/ai-settings.tsx`
- Create: `client/src/pages/admin/Configuration/storage-settings.tsx`
- Modify: `client/src/pages/admin/index.tsx`
- Modify: `client/src/components/sidebar.tsx`
- Modify: `client/src/components/bedrock-cost-monitoring.tsx`
- Modify: `client/src/hooks/useBedrockCostNotifications.ts`
- Modify: `client/src/locales/en/bedrock.json`
- Modify: `client/src/locales/es/bedrock.json`
- Modify: `server/__tests__/integration/ai.admin.test.ts`
- Delete: `server/__tests__/integration/bedrock-api.test.ts` (opt-in live AWS Bedrock test; replaced by the provider smoke in Task 6 and S3 preservation test in Task 5)
- Create: `client/src/pages/admin/Configuration/__tests__/ai-settings.test.tsx`
- Create: `e2e/admin-ai-settings.spec.ts` (Chromium browser scenario)

**Interfaces:**
- Produces: `/api/ai/settings` and `/api/ai/test-connection` own provider settings and never alias `/api/bedrock/settings`. Add `/api/storage/aws-settings` for S3 AWS credentials; retain `/api/bedrock/settings` as a compatibility alias to that AWS storage handler with its existing request/response shape. Alias `/api/bedrock/usage`, cost-statistics, cost-limits, reset-usage, and export-usage only to provider-neutral usage handlers after tests prove identical shapes.
- Produces: AI page edits model/features/limits and shows only server-key configured status. AWS credential controls live under clearly labeled storage settings, preserving the current `bedrock_settings` storage path.

- [ ] **Step 1: Add admin route tests**

Cover admin-only provider settings and AWS settings writes, non-admin denial, configured-key boolean, fixed harmless connection prompt, each actionable connection error, usage/cost alias equivalence, and that changing `/api/ai/settings` leaves AWS credentials unchanged while updating `/api/storage/aws-settings` is reflected by `/api/bedrock/settings`.

- [ ] **Step 2: Implement canonical provider-neutral routes with aliases**

In `server/routes/index.ts`, keep provider settings and storage settings as separate handlers. Register `GET`/`POST /api/ai/settings` with `getAISettings`/`saveAISettings`; register `GET`/`POST /api/storage/aws-settings` with the existing Bedrock AWS credential storage handler and retain `GET`/`POST /api/bedrock/settings` as aliases to that same AWS handler. Alias usage/cost endpoints only where existing clients accept the current response schema with additive estimate/billing fields. Connection-test responses contain safe status/code only.

```ts
const getUsage = async (req: any, res: any, next: any) => {
  try {
    const callerId = getUserId(req);
    const caller = await storage.getUser(callerId);
    const targetUserId = caller?.role === "admin" && req.query.userId ? String(req.query.userId) : callerId;
    const usage = await storage.getAIUsage({ userId: targetUserId,
      startDate: req.query.startDate ? new Date(String(req.query.startDate)) : undefined,
      endDate: req.query.endDate ? new Date(String(req.query.endDate)) : undefined });
    res.json(usage.map((u) => ({ id: u.id, userId: u.userId, inputTokens: u.inputTokens,
      outputTokens: u.outputTokens, modelId: u.modelId, cost: Number(u.estimatedCost),
      requestedModelId: u.requestedModelId, verifiedCostUsd: u.verifiedCostUsd,
      billingStatus: u.billingStatus, createdAt: u.createdAt })));
  } catch (error) { next(error); }
};
app.get("/api/ai/usage", isAuthenticated, getUsage);
app.get("/api/bedrock/usage", isAuthenticated, getUsage); // compatible legacy projection
app.get("/api/storage/aws-settings", isAuthenticated, requireAdmin, getAwsStorageSettings);
app.get("/api/bedrock/settings", isAuthenticated, requireAdmin, getAwsStorageSettings); // AWS only
```

Define `getUsage` by extracting the existing `/api/bedrock/usage` implementation and preserve its admin/self filtering and legacy fields, adding `requestedModelId`, `verifiedCostUsd`, and `billingStatus`. Define `getAwsStorageSettings` from the current `/api/bedrock/settings` GET body (`bedrockAccessKeyId`, `bedrockRegion`, `bedrockModelId`, `hasBedrockSecret`). Keep that legacy storage response intact for S3 and rollback. Provider settings return `modelId` and key-configured boolean separately.

- [ ] **Step 3: Update the AI configuration form and cost display**

Change `ai-settings.tsx`, `bedrock-cost-monitoring.tsx`, notification hook, and locale files to label OpenRouter and estimated versus verified costs. Show only whether the server key is configured; never render a key input/value. Build `storage-settings.tsx`, register it in `admin/index.tsx` and `sidebar.tsx`, and move AWS fields there; use `/api/storage/aws-settings` while retaining the existing `bedrock_settings` persistence path.

```tsx
<Select value={settings.modelId} onValueChange={(modelId) => save({ modelId })} />
<Badge>{settings.openRouterKeyConfigured ? "Server key configured" : "Server key missing"}</Badge>
```

- [ ] **Step 4: Add UI tests for key secrecy and settings behavior**

Assert model and limits can be edited, key configured state is visible, no credential value or key-edit field renders in the AI page, and estimate/verified usage labels are distinguishable. Add `e2e/admin-ai-settings.spec.ts`; mock `/api/ai/settings`, `/api/storage/aws-settings`, and their POST routes with Playwright `page.route`, call `loginViaUi(page, "admin")`, visit the admin AI configuration and storage settings screens, edit the model/limit, and assert the storage secret control stays masked and absent from AI settings.

```ts
test("admin separates OpenRouter and AWS storage settings", async ({ page }) => {
  await page.route("**/api/ai/settings", (route) => route.fulfill({ json: { modelId: "deepseek/deepseek-v4-pro", openRouterKeyConfigured: true, maxTokens: 2000 } }));
  await page.route("**/api/storage/aws-settings", (route) => route.fulfill({ json: { bedrockAccessKeyId: "AKIA_TEST", bedrockRegion: "us-east-1", hasBedrockSecret: true } }));
  await loginViaUi(page, "admin");
  await page.goto("/admin/ai-settings");
  await expect(page.getByText(/server key configured/i)).toBeVisible();
  await expect(page.getByLabel(/secret access key/i)).toHaveCount(0);
  await page.goto("/admin/storage-settings");
  await expect(page.getByText(/secret configured/i)).toBeVisible();
});
```

- [ ] **Step 5: Run focused route and UI tests**

Run: `npm.cmd test -- --runTestsByPath server/__tests__/integration/ai.admin.test.ts client/src/pages/admin/Configuration/__tests__/ai-settings.test.tsx`
Expected: PASS; AWS settings alias retains exact existing fields, provider settings do not affect S3 credentials, and only compatible usage/cost response schemas are shared. `bedrock-api.test.ts` invokes live AWS only when `RUN_INTEGRATION_TESTS=true`; delete this opt-in SDK test as part of removing the SDK and use the harmless OpenRouter smoke instead.

### Task 5: Remove Bedrock Runtime dependency while preserving S3/SES and rollback

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docker-compose.yml`
- Create: `server/__tests__/integration/s3BedrockSettingsCompatibility.test.ts`
- Modify: `docs/implementation-plan/aws-bedrock-create-and-configure.md` (mark model configuration as legacy/rollback and S3 credential use as retained)

**Interfaces:**
- Produces: deployment injects `OPENROUTER_API_KEY` into Ticketflow server; S3/SES AWS packages and `bedrock_settings` credential storage stay available to current and rollback images.

- [ ] **Step 1: Add S3 preservation integration coverage**

With the legacy settings row populated, verify S3 upload, presigned download/read, and deletion still use retained bucket/region/AWS credentials. Verify no provider migration path overwrites those credentials.

- [ ] **Step 2: Wire deployment environment and remove only Bedrock Runtime package**

This provider plan owns Bedrock Runtime removal from `package.json` and `package-lock.json`; the parallel OpenAPI plan adds any validator only after this task, preventing concurrent lockfile edits. Add optional `OPENROUTER_API_KEY` pass-through to the Ticketflow `app` service in `docker-compose.yml`. Remove all active `@aws-sdk/client-bedrock-runtime` imports and package entries. Keep `@aws-sdk/client-s3`, `@aws-sdk/client-ses`, and S3 presigner packages.

Apply production database changes in the required order: `npm.cmd run db:migrate-sql` then `npm.cmd run db:push`. Keep Drizzle schema and migration 0023 identical, including the `ai_settings` singleton check and all `ai_usage` columns/indexes; verify both commands preserve existing `bedrock_settings` rows.

```yaml
services:
  app:
    environment:
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
```

Keep the variable optional so old-image rollback starts with the same Compose file; never add a literal key to `.env.example`, image layers, or logs. The Dockerfile builds the app only and does not receive the secret as a build argument.

- [ ] **Step 3: Update operator documentation and run package/S3 checks**

Clarify OpenRouter key provisioning without writing an actual secret. Run `npm.cmd run check`, `npm.cmd run build`, and `npm.cmd test -- --runTestsByPath server/__tests__/integration/s3BedrockSettingsCompatibility.test.ts`; inspect `rg -n "@aws-sdk/client-bedrock-runtime|BedrockRuntimeClient|BedrockRuntime" --glob '!package-lock.json' .` and confirm only historical docs/tests explicitly marked legacy remain, then remove obsolete active mocks.

### Task 6: Full regression, local container smoke, and branch completion

**Files:**
- Test: `server/__tests__/integration/ai.routes.test.ts`
- Test: `server/__tests__/integration/ai.admin.test.ts`
- Test: `server/__tests__/integration/mcp/`
- Test: `client/src/`
- Test: `e2e/` (use actual configured directory from `playwright.config.ts`)
- Check: `server/services/ai/`, `server/routes/index.ts`, `package.json`, `docker-compose.yml`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: tested Ticketflow image using its own OpenRouter key; no direct Bedrock Runtime caller; retained S3 behavior and MCP contract, with canonical and compatibility paths ready for the separate OpenAPI/MCP plan.

- [ ] **Step 1: Run full static and test gates**

Run: `npm.cmd run check`
Run: `npm.cmd run build`
Run: `npm.cmd test`
Run: `npm.cmd run e2e`
Expected: Chromium runs `e2e/admin-ai-settings.spec.ts` and proves an admin can configure the model while AWS settings remain isolated and masked.
Expected: PASS, and no Bedrock Runtime imports/guards on active AI paths. Attribute every result to this worktree.

- [ ] **Step 2: Build and start local Ticketflow container**

Build with `docker compose build`; inject `OPENROUTER_API_KEY` from the operator's existing local secret mechanism without echoing it; start the app and verify its health endpoint and authenticated UI. Do not copy or rely on DSH's configured key.

- [ ] **Step 3: Prove Ticketflow provider and preserved integrations**

Run one fixed harmless authenticated model query and capture status/model/token result with no secret or ticket data; execute S3 upload, presigned read, and delete checks. Require Chromium admin UI tests for AI model/limit editing and storage credential configuration without secret exposure. Confirm old image boots against additive schema. For backout, restore the previous Compose environment and image, restart only the app, then verify health, the old-image Bedrock connection test when Bedrock was previously configured, S3 upload/read/delete, and MCP. The separate OpenAPI/MCP plan owns protocol handshake and route coverage validation.

- [ ] **Step 4: Reconcile final state and prepare the feature branch**

Inspect `git status --short`, `git diff --check`, branch/HEAD/upstream, and `git diff --stat`; preserve unrelated edits, especially `API_DOCUMENTATION.md`. Stage only intended migration files, summarize gates, and push the feature branch. Do not alter/bypass the `main` update ruleset; use the repository-approved PR process.
