# Notifications Improvement Plan

## Goals

- Add a notification dropdown (top 5 unread) with link to `/notifications`.
- Standardize and expand server broadcast events for ticket lifecycle and comments.
- Optionally persist notifications and expose REST endpoints for unread lists and read state.

## Phases

### Phase 1 – Client Quick Wins

- Header bell icon opens a dropdown of up to 5 unread notifications.
- Badge shows unread count; footer "View all" → `/notifications`.
- `useWebSocket`: use real `user.id` for toasts; add light de‑duplication.

### Phase 2 – Server‑backed Notifications

- Events: `ticket:created`, `ticket:updated`, `ticket:reassigned`, `ticket:comment`, `system:notification`.
- Envelope: `{ type, data, ts, v: 1 }`.
- Helpers: `broadcastToUser`, `broadcastToMany(userIds, msg)`, `broadcastToAll`.
- Optional persistence and endpoints:
  - Table: `notifications (id, userId, title, content, type, relatedTaskId, isRead, createdAt)`.
  - `GET /api/notifications?limit=5&read=false`
  - `PATCH /api/notifications/:id/read`
  - `PATCH /api/notifications/read-all`

### Phase 3 – Preferences & Reliability (Optional)

- In‑app toast preferences (local or DB).
- Teams webhook retry (2 attempts, exponential backoff); structured logs; never fail primary request.

## Acceptance Criteria

- Bell shows top 5 unread; “View all” navigates to `/notifications`.
- Real‑time toasts reach intended users; duplicates minimized.
- (If persisted) unread list and read state reflected across UI.

## Endpoints (New, if persistence enabled)

- `GET /api/notifications?limit=5&read=false`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

## Data Model (Optional)

- `notifications` table:
  - `id SERIAL`, `user_id VARCHAR`, `title VARCHAR(255)`, `content TEXT`, `type VARCHAR(50)`, `related_task_id INTEGER`, `is_read BOOLEAN DEFAULT false`, `created_at TIMESTAMP DEFAULT NOW()`

## Implementation Touchpoints

- Client: `components/header.tsx`, `hooks/useWebSocket.tsx`, `pages/notifications.tsx`.
- Server: `routes.ts`, `storage.ts`, `microsoftTeams.ts`, `shared/schema.ts` (optional table).
