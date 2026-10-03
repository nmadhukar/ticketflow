AI Workflow – Design and Implementation Guide

Overview

This document summarizes the end‑to‑end AI workflow for TicketFlow, the configuration surfaces, and the server/runtime enforcement we implemented.

Scope

- Features covered
  - Auto‑Response Configuration
  - Escalation Configuration
  - Knowledge Base Learning
- Related controls
  - Model/output controls (Bedrock)
  - Cost/Rate limits (minute/hour/day, per‑request token budget)

Key Settings (source of truth)

Settings are persisted in `server/data/ai-settings.json` and served via `GET/PUT /api/admin/ai-settings`. Relevant fields:

- Auto‑Response
  - `autoResponseEnabled: boolean`
  - `confidenceThreshold: number` (0..1)
  - `maxResponseLength: number` (100..5000 chars)
  - `responseTimeout: number` (5..120 seconds)
- Escalation
  - `escalationEnabled: boolean`
  - `complexityThreshold: number` (0..100)
  - `escalationTeamId?: number`
- Knowledge Learning
  - `autoLearnEnabled: boolean`
  - `minResolutionScore: number` (0..1)
  - `articleApprovalRequired: boolean` (draft vs auto‑publish)
- Model/output
  - `bedrockModel: string`
  - `temperature: number` (0..1)
  - `maxTokens: number` (model output cap)
- Rate limiting (AI API)
  - `maxRequestsPerMinute: number`
  - `maxRequestsPerHour: number` (0 disables)
  - `maxRequestsPerDay: number`

Cost limits (file‑based):

- `server/costMonitoring.ts` stores cost limits (daily/monthly USD, `maxTokensPerRequest`, free‑tier flag) in `server/data/cost-limits.json` via `PUT /api/bedrock/cost-limits`.

Core Flow

1. Analyze ticket (Bedrock) → compute: complexity (mapped to 0..100), confidence, suggested response context.
2. Auto‑Response (if enabled): apply when generated response confidence ≥ configured threshold and not escalated; trim to `maxResponseLength`; respect `responseTimeout`.
3. Escalation (if enabled): escalate when any:
   - complexityScore ≥ `complexityThreshold`
   - model indicates escalation needed
   - auto‑response was not applied (e.g., low confidence)
     If `escalationTeamId` is configured, assign the ticket to that team.
4. Knowledge Learning (on resolution): when `autoLearnEnabled` and heuristic quality ≥ `minResolutionScore`, create KB article; publish immediately if `articleApprovalRequired` is false, otherwise save as draft.

Runtime Enforcement

- AI API rate limiting (user‑scoped)
  - Enforced per minute/hour/day using the saved AI settings.
  - Response headers expose remaining/limits per window.
- Per‑request token budget
  - `maxTokensPerRequest` (from cost limits) is enforced at runtime:
    - Estimate input tokens from prompt; clamp model output tokens to the remaining budget.
    - If prompt alone exceeds budget, request is blocked with a helpful error.
- Model output cap
  - The model’s `maxTokens` parameter is set to the minimum of (UI output cap, budget remainder).

Primary Components

- Client: `client/src/pages/ai-settings.tsx`

  - Consolidated sections:
    - AWS Bedrock Configuration (credentials, model, temperature, model output cap)
    - Cost Limits Configuration (daily/monthly USD, per‑request token budget; strict/free‑tier mode, policy presets)
    - AI Workflow: Auto‑Response, Escalation, Learning (single card with Edit/Save/Cancel and dirty tracking)
  - Free‑tier behavior:
    - When strict is ON, numeric inputs are locked; only policy presets are selectable (Strict/Balanced/Generous). Toggling strict applies Strict immediately.
    - Presets auto‑fill rate limits and cost‑limit budgets.

- Server
  - `server/aiTicketAnalysis.ts`
    - Reads AI settings for auto‑response gating and trimming; applies `responseTimeout` via AbortController.
    - Computes complexity score; decides escalation based on settings and model signal; assigns `assigneeType='team'`/`assigneeTeamId` when configured.
  - `server/knowledgeBase.ts`
    - `learnFromResolvedTicket(ticketId, { minScore, requireApproval })` reads useful resolution data; computes a simple quality score; creates article (draft or published based on approval policy).
  - `server/routes.ts`
    - On task status transition to resolved, loads AI settings and triggers knowledge learning with policy parameters.
  - `server/security/rateLimiting.ts`
    - Enforces per‑minute/hour/day limits based on current AI settings.
  - `server/bedrockIntegration.ts`
    - Clamps model output to per‑request budget remainder; blocks over‑budget prompts.
    - Server‑side capping for free‑tier limits on update.

Policy Presets (free‑tier)

- Strict (default when strict ON)
  - Per‑minute: 10; Per‑hour: 100; Per‑day: 500
  - Tokens per request: 1000
  - Daily: $1; Monthly: $10
- Balanced (free‑tier)
  - Per‑minute: 20; Per‑hour: 0; Per‑day: 1000
  - Tokens per request: 2000
  - Daily: $2; Monthly: $15
- Generous (free‑tier cautious)
  - Per‑minute: 30; Per‑hour: 300; Per‑day: 1500
  - Tokens per request: 3000
  - Daily: $3; Monthly: $25

UX Notes

- Workflow card provides Edit/Save/Cancel with field snapshot and dirty hint.
- Rate presets switch to “Custom” upon manual edits (when strict is OFF).
- Inline validation mirrors server clamps.
- Banners indicate missing Bedrock credentials and free‑tier managed fields.

Acceptance Criteria

- Auto‑Response
  - Disabling auto‑response stops AI replies.
  - Threshold changes are reflected immediately; responses are trimmed to `maxResponseLength`.
  - Requests respect `responseTimeout`.
- Escalation
  - Disabled escalation avoids team routing.
  - Tickets route to `escalationTeamId` when rules match.
- Knowledge Learning
  - Disabled learning prevents article creation on resolve.
  - `minResolutionScore` gates drafts/publishes correctly with `articleApprovalRequired`.
- Rate/Cost
  - AI API requests are limited per minute/hour/day by settings.
  - Over‑budget prompts are blocked or clamped; headers expose remaining quotas.

API Reference (selected)

- `GET /api/admin/ai-settings` – fetch settings
- `PUT /api/admin/ai-settings` – update settings
- `POST /api/admin/ai-settings/test` – Bedrock connectivity test
- `GET /api/bedrock/settings` / `POST /api/bedrock/settings` – Bedrock credentials/config
- `PUT /api/bedrock/cost-limits` – update cost limits (file‑based)

Operational Notes

- File‑based persistence (settings/cost) is intentional to avoid DB migrations; migrate to DB tables when convenient.
- For production, consider Redis for rate‑limit trackers.
- Keep model lists synced with account availability; show warnings when premium models are selected under strict free‑tier policy.

#### Ticket AI pipeline (current code)

`processTicketWithAI` no longer exists. The pieces are:

- `server/services/ai/createTimeAutoResponse.ts` (`runCreateTimeAutoResponse`) runs after `POST /api/tasks` has created the ticket. It never throws; failures are logged as error type, HTTP status and ticket id only (never prompts, model output or credentials). Settings are read per ticket: with `autoResponseEnabled` off, or Bedrock unconfigured, no Bedrock call is made.
- `aiAutoResponseService.analyzeTicket(ticket)` (`server/services/ai/aiAutoResponse.ts`) does the analysis and owns the single `ticket_auto_responses` write for it: one row per analysis, text cut to `maxResponseLength`, always stored with `wasApplied = false`. It returns `shouldAutoRespond`, the one decision, made by the real `calculateConfidence` (`bedrockIntegration.ts`) from the admin settings: `autoResponseEnabled` and `confidenceThreshold`.
- When `shouldAutoRespond` is true the create path posts the comment as the AI system user (`ai-assistant`, shown to clients as "AI Assistant") and only then sets the row `wasApplied = true`. A failed comment leaves the row unapplied.
- `POST /api/tasks/:id/auto-response/generate` (staff) stores a draft the same way and posts nothing. `POST /api/tasks/:id/auto-response/apply` (staff, idempotent) posts the stored draft as the AI user and marks it applied. `GET /api/tasks/:id/auto-response` shows customers only the latest applied row; staff see the latest row of any kind.
- `POST /api/ai/analyze-ticket` and `/api/ai/generate-response` (staff) take `{ ticketId }`, load the ticket from the database, require access to it (404 missing, 403 outside scope or customer) and map a cost-limit block to 429 `quota_exceeded`. analyze-ticket stores nothing.
- Escalation settings (`escalationEnabled`, `escalationTeamId`, `complexityThreshold`) are stored but not active: nothing reassigns tickets from them, and the admin UI does not show them.
