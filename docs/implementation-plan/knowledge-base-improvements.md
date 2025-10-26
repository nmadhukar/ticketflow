# Knowledge Base Improvements

## Delivered

- Schema additions: `status (draft|published|archived)`, `source (manual|ai_generated)`, `viewCount`, `helpfulVotes`, `unhelpfulVotes`, `archivedAt`, `lastUsed`.
- Migration with backfill; new indexes.
- Server:
  - Filters by `status`, `source`; publish/unpublish/archive/unarchive endpoints.
  - View counter endpoint; effectiveness recalculated from votes.
  - AI learning saves `source='ai_generated'`, `status='draft'`.
- Client:
  - Admin page filters by `status` and `source`.
  - Table shows Views, Usage, Effectiveness, Created; Source column added.

## Optional Next

- Help Docs upload validation
  - Enforce .doc/.docx and ≤10MB at server for the base64 endpoint (or migrate to multer for 10MB parity with company policies).
- Semantic search
  - Keep LLM-ranking for now; revisit vector/embeddings later if needed.

## Acceptance Criteria

- Admins can manage article lifecycle via status transitions.
- Users can see correct Views/Usage/Effectiveness; voting adjusts effectiveness.
- AI-created articles default to `draft` with `source='ai_generated'`.

## Related Seeds and Admin APIs

- Help Documents seed and `/api/admin/help` (JSON) for manager UI.
- User Guide Categories and Guides seeds (HTML, Scribehow, Video).

## Implementation Touchpoints

- Server: `shared/schema.ts`, `server/routes.ts`, `server/storage.ts`, `server/knowledgeBaseLearning.ts`.
- Client: `client/src/pages/knowledge-base.tsx` (filters, columns), `client/src/components/HelpDocumentManager.tsx` (admin uploads).
