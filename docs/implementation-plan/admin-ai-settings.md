# Admin AI Settings - Implementation Notes and Suggestions

## Scope

- Route: `admin/ai-settings?section=configuration`
- Client: `client/src/pages/ai-settings.tsx`
- Server: `GET/PUT/POST /api/admin/ai-settings[/**]`

## Current Implementation

- Client renders a comprehensive AI configuration UI with sections for configuration, learning, escalation, model, rate limiting, and queue.
- Data hooks expect these endpoints:
  - `GET /api/admin/ai-settings`
  - `PUT /api/admin/ai-settings`
  - `POST /api/admin/ai-settings/test`
- Deep-linking via `?section=` was not previously wired.

## Changes Applied

- Added deep-linking by scrolling to `#ai-<section>` anchors on mount.
  - Anchors: `ai-configuration`, `ai-learning`, `ai-escalation`, `ai-queue`, `ai-bedrock`.
- Implemented server endpoints with admin-only access and validation:
  - `GET /api/admin/ai-settings` → returns saved settings (with sensible defaults).
  - `PUT /api/admin/ai-settings` → validates ranges server-side and persists.
  - `POST /api/admin/ai-settings/test` → uses Bedrock integration to verify connectivity.
- Persistence implemented via `server/data/ai-settings.json` (file-based) to avoid DB migration.

## Validation Rules (server-side)

- `confidenceThreshold`, `minResolutionScore`, `temperature`: 0..1
- `maxResponseLength`: 100..5000 chars
- `responseTimeout`: 5..120 seconds
- `complexityThreshold`: 0..100
- `maxTokens`: 100..4000
- `maxRequestsPerMinute`: 1..100
- `maxRequestsPerDay`: 10..10000

## Suggestions

- Migrate persistence to database when convenient:
  - Add `ai_settings` table or embed JSON column in a general `app_settings` table.
  - Record `updatedBy` and audit logs for changes.
- Reflect Bedrock model availability dynamically based on account access.
- Add a “Reset to defaults” button with confirmation.
- Display a dismissible banner if required Bedrock creds are not configured.
- Rate limiting: consider server-side enforcement via middleware per user/key.

## Deep-link Examples

- `/admin/ai-settings?section=configuration`
- `/admin/ai-settings?section=model`
- `/admin/ai-settings?section=queue`

## Files Touched

- `server/admin/aiSettings.ts` (new)
- `server/routes.ts` (new endpoints)
- `client/src/pages/ai-settings.tsx` (anchors + scroll)
