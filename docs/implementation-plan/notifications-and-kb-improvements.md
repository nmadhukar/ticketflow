# Notifications and Knowledge Base Improvements

## Goals

- Add a notification dropdown (top 5 unread) with link to `/notifications`.
- Standardize server broadcast events; optional persisted notifications.
- Keep LLM-based KB search; lifecycle/metrics already implemented.

## Phases

### Phase 1 – Client Quick Wins

- Header bell icon opens a dropdown of up to 5 unread notifications.
- Badge shows unread count; footer "View all" → `/notifications`.
- `useWebSocket`: replace placeholder current-user check with `user.id`; add light de-duplication for toasts.

### Phase 2 – Server-backed Notifications

- Server events: `ticket:created`, `ticket:updated`, `ticket:reassigned`, `ticket:comment`, `system:notification`.
- Envelope format: `{ type, data, ts, v: 1 }`.
- Helpers: `broadcastToUser`, `broadcastToMany(userIds, msg)`, keep `broadcastToAll`.
- Optional persistence:
- DB table `notifications (id, userId, title, content, type, relatedTaskId, isRead, createdAt)`
- Endpoints:
- `GET /api/notifications?limit=5&read=false`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

### Phase 3 – Preferences & Reliability (Optional)

- In-app toast preferences (per event type) minimal toggle; or DB-backed later.
- Teams webhooks: add 2 retries with exponential backoff; structured logging; never fail main request on notification failure.

## Knowledge Base (Delivered + Optional Next)

- Delivered: schema/status/source, metrics, admin filters/actions, AI learning defaults, feedback aggregation, views.
- Optional next: enforce .doc/.docx and ≤10MB on `/api/admin/help` or migrate to multer for parity.

## Acceptance Criteria

- Clicking the bell shows top 5 unread; “View all” navigates to `/notifications`.
- WS toasts appear to the correct user; duplicates minimized.
- (If persisted) `/api/notifications` returns user-scoped unread list; read actions reflect in UI.

## Endpoints (New)

- `GET /api/notifications?limit=5&read=false`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

## Data Model (Optional)

- `notifications` table:
- `id SERIAL`, `user_id VARCHAR`, `title VARCHAR(255)`, `content TEXT`, `type VARCHAR(50)`, `related_task_id INTEGER`, `is_read BOOLEAN DEFAULT false`, `created_at TIMESTAMP DEFAULT NOW()`

## Notes

- Keep LLM-ranking for KB semantic search; revisit embeddings later if needed.
- Broadcasts must be best-effort; do not affect primary transaction success.

### To-dos

- [x] Add fields to knowledge_articles and write backfill migration
- [x] Update storage for status/source, metrics, and new helpers
- [x] Add admin endpoints for publish/unpublish/archive/unarchive and filters
- [x] Add view increment endpoint; ensure published listing uses status
- [x] Aggregate helpful/unhelpful votes and recompute effectivenessScore
- [x] Set source='ai_generated', status='draft' for learned articles
- [x] Update admin KB page to use status/source and show metrics
- [ ] Enforce size/type for help docs upload (optional)

## Notifications and Knowledge Base – Agreed Improvements

### Scope

- Consolidate our shared suggestions for:
  - Notifications (server, client, UX dropdown)
  - Knowledge Base (lifecycle/metrics) and Help Docs

---

## Notifications

### Current State (observed)

- WebSocket:
  - Server hosts `/ws`, maps `userId -> socket`.
  - Ad-hoc event broadcasts; limited usage of broadcast helpers.
- Microsoft Teams:
  - Sends webhook notifications on ticket updates (preference-aware).
- Client:
  - `useWebSocket` listens to `ticket:*`, `knowledge:created`, etc.; shows toasts.
  - “Assigned to current user” is a placeholder check, so some toasts won’t trigger correctly.
- Notifications page:
  - Uses mock data; route exists but not wired to server.
  - No persisted notifications or unread tracking.

### Your Request (agreed)

- Add a header notification icon:
  - Click opens a dropdown with up to 5 unread notifications.
  - Include a footer link to navigate to `/notifications`.

### Must-Have (Phase 1)

- Header dropdown (client-only, non-blocking)
  - Add bell icon with unread badge (count).
  - Dropdown shows top 5 unread from client state (or API later).
  - Each item shows type icon, title, message, relative time; clicking navigates to `actionUrl` or `/notifications`.
  - “View all” goes to `/notifications`.
- Client WS fixes
  - Replace placeholder “current-user-id” with real `user.id` gating for toasts.
  - Add a small dedupe window to avoid duplicate toasts when cache invalidation triggers re-renders.

### Server Enhancements (Phase 2)

- Event hooks and consistent envelopes
  - Standardize broadcasts: `ticket:created`, `ticket:updated`, `ticket:reassigned`, `ticket:comment`, `system:notification`.
  - Message envelope: `{ type, data, ts, v: 1 }`.
  - Add helper `broadcastToMany(userIds, message)`; keep `broadcastToUser`, `broadcastToAll`.
- Persisted notifications (optional but recommended)
  - DB table `notifications` (userId, title, content, type, relatedTaskId, isRead, createdAt).
  - Endpoints:
    - `GET /api/notifications?limit=5&read=false`
    - `PATCH /api/notifications/:id/read`
    - `PATCH /api/notifications/read-all`
- Preferences (lightweight)
  - Reuse Teams preferences notion for WebSocket toasts:
    - Minimal: add a client-side “mute” flag in localStorage.
    - Better (optional): add a user preference in DB for in-app toasts (on/off per event type).

### Reliability/Integrations (Phase 3, optional)

- Teams webhooks: add 2 retry attempts with exponential backoff; never fail the main request.
- (Future) Email notifications for key events using SES templates.

### Acceptance Criteria

- Bell icon shows top 5 unread; “View all” navigates to `/notifications`.
- Real-time toasts appear to the correct user (no placeholders).
- (If persisted) `/api/notifications` returns user-specific unread list; marking read updates counts across UI.

---

## Knowledge Base (delivered + next)

### Delivered (alignment)

- Schema additions: `status (draft|published|archived)`, `source (manual|ai_generated)`, `viewCount`, `helpfulVotes`, `unhelpfulVotes`, `archivedAt`, `lastUsed`.
- Migration with backfill; new indexes.
- Server:
  - Filters by `status`, `source`; publish/unpublish/archive/unarchive endpoints.
  - View counter endpoint; effectiveness recalculated from votes.
  - AI learning saves `source='ai_generated'`, `status='draft'`.
- Client:
  - Admin page filters by `status` and `source`.
  - Table shows Views, Usage, Effectiveness, Created; Source column added.

### Optional Next

- Help Docs upload validation
  - Enforce .doc/.docx and ≤10MB at server for the base64 endpoint (or migrate to multer for 10MB parity with company policies).
- Semantic search
  - Keep LLM-ranking for now; revisit vector/embeddings later if needed.

---

## Help & Documentation (delivered)

- Seeds added for:
  - Help Documents: sample Word docs (base64 + content).
  - User Guide Categories and Guides: HTML, Scribehow, Video examples.
- Admin GET `/api/admin/help` implemented (JSON) to support manager UI.

---

## Phased Plan Summary

### Phase 1 (UI quick wins)

- Add header dropdown for unread (top 5) + badge + “View all” link.
- Fix WS current user checks and add toast dedupe.

### Phase 2 (server-backed notifications)

- Implement persisted `notifications` with CRUD endpoints.
- Add server event hooks and consistent WS envelopes.
- Header dropdown now pulls from `GET /api/notifications?limit=5&read=false`; mark read endpoints wire-up.

### Phase 3 (preferences/reliability)

- Add in-app toast preferences (minimal or DB).
- Teams webhook retries and structured logging.

---

## File touchpoints (for reference)

- Client:
  - `components/header.tsx` (bell icon + dropdown)
  - `hooks/useWebSocket.tsx` (user check, dedupe)
  - `pages/notifications.tsx` (list view, mark read all)
- Server:
  - `routes.ts` (notifications endpoints, event broadcasts)
  - `storage.ts` (notifications CRUD)
  - `microsoftTeams.ts` (retry/backoff helper)
  - `shared/schema.ts` (optional `notifications` table)
