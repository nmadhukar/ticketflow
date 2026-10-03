# TicketFlow API Endpoints Reference

This reference describes the API as the code behaves after the 2026-10 fix program. Every
route is under `/api` unless noted. Examples use placeholders (`{{baseUrl}}`, `{{apiKey}}`);
there are no real values in this file. Where this file and the code disagree, the code wins:
please report the difference.

Contents: conventions, authentication, tickets, ticket workflow, comments, attachments, AI,
knowledge base, help/policies/guides, API keys, SSO and email settings, Teams webhooks,
teams and departments, users and invitations, statistics, inbound email, realtime
WebSocket, MCP server, other routes, rate limits.

## 1. Conventions

### Error contract

Every API failure is JSON, never HTML, and never carries a stack trace:

```json
{ "error": "validation_failed", "message": "Invalid input", "details": { "formErrors": [], "fieldErrors": { "title": ["Title is required"] } } }
```

- `error`: a stable machine code (snake_case). Branch on this, not on `message`.
- `message`: human text. For 500 it is always the fixed text "Internal server error".
- `details`: optional. For 400 validation failures it is zod's `{ formErrors, fieldErrors }`.

| Status | Typical `error` codes | Meaning |
|---|---|---|
| 400 | `validation_failed`, `invalid_id`, `invalid_json`, `email_registered`, `invalid_expiry`, `invalid_role`, `invalid_webhook_url`, `invalid_current_password`, `password_unchanged`, `invalid_reset_token`, `ai_disabled` | Bad input. A value outside a closed set (status, priority, category) is always 400, never an empty list. |
| 401 | `unauthorized`, `invalid_credentials`, `invalid_token`, `session_revoked` | No or invalid credentials. Bearer failures also send `WWW-Authenticate`. |
| 403 | `forbidden`, `session_required`, `password_change_required`, `invalid_role` | Authenticated but not allowed. |
| 404 | `not_found`, `user_not_found`, `invitation_not_found`, `api_key_not_found` | Missing record, or an unknown `/api/...` path (JSON, not HTML). |
| 405 | `method_not_allowed` | Only `POST /api/mcp` is served on the MCP path. |
| 409 | `invalid_transition`, `last_admin`, `self_demotion`, `no_local_password`, `email_in_use`, `conflict` | State conflict. |
| 413 | `payload_too_large` | Request body over the limit. |
| 423 | `account_locked` | Five wrong passwords lock the account for 15 minutes. |
| 429 | `too_many_requests`, `quota_exceeded` | Rate limit (every limiter, `/api/mcp` included), or the AI cost limit (see section 8). |
| 503 | `ai_not_configured`, `ai_unavailable`, `inbound_email_not_configured`, `S3_CONFIGURATION_REQUIRED` | A dependency is not configured or not available. |

Two non-obvious rules:
- A route id that is not a positive integer answers `400 invalid_id` before anything else
  (including before 401), for `:id`, `:taskId`, `:teamId` and `:assignmentId`.
- A ticket id that does not exist is `404 not_found`; one that exists but is outside the
  caller's scope is `403 forbidden`.

### Ticket visibility (one rule everywhere)

Lists, by-id routes, history, comments, attachments, AI routes, dashboard counts, realtime
events and MCP all use the same rule:

- admin: every ticket.
- manager: tickets they created, tickets assigned to them or to a member of a team in a
  department they manage, and tickets queued to such a team.
- agent (the legacy role `user` is read as `agent`): tickets they created, are assigned,
  or that are queued to a team they belong to or assigned to a teammate.
- customer: only tickets they created.

Roles are `admin`, `manager`, `agent`, `customer`. Self-registration creates a `customer`.

### Response shape quirks

- `GET /api/tasks`, `/api/tasks/my`, `/api/tasks/my-groups` return a **bare JSON array**, not
  an envelope. The MCP `list_tickets` tool returns an envelope (section 13).
- Customers see staff in comments, history and ticket lists as a minimal profile
  (id, name, picture): no email or phone.

## 2. Authentication

Two ways to authenticate, never mixed in one request:

1. **Session cookie** (browser): `POST /api/auth/login` sets an httpOnly session cookie
   (7-day lifetime). Used by the web app.
2. **Bearer token** (automation): `Authorization: Bearer tfk_...` with an API key.
   A JWT bearer is accepted **only when `BEARER_JWT_ENABLED=true`** (section 2.3).

A request that carries a Bearer header is authenticated by the bearer alone: an invalid,
expired or revoked bearer is `401 invalid_token` even when a valid session cookie came
with it. Bearer requests never create a session and never set a cookie. Bearer applies to
`/api` paths only, and a valid bearer is accepted only on `/api/mcp`, `/api/tasks/**` and
`/api/auth/user` (section 2.4, R33).

### 2.1 Session routes

| Method and path | Auth | Notes |
|---|---|---|
| `POST /api/auth/register` | none | Body `{email, password (min 8), firstName, lastName, inviteToken?}`. 201 `{message, user:{id,email,firstName,lastName,role,isApproved}}`. Account is an unapproved `customer` unless a valid invitation token for that email is presented (then invited role, approved). An existing email, password or SSO account alike, is `400 {"error":"email_registered","message":"Email already registered"}`. |
| `POST /api/auth/login` | none | Body `{email, password}`. 200 `{id,email,firstName,lastName,role,mustChangePassword}` and a cookie. Failures: 401 `invalid_credentials` (wrong password, unknown email, SSO-only account, deactivated, or pending approval all use 401 with a message), 423 `account_locked`, 403 `invalid_role`. |
| `POST /api/auth/logout` | session | 200 `{message}`. Session only (R33). |
| `GET /api/logout` | session | Redirect to `/`. Session only. |
| `GET /api/auth/user` | session | 200 `{id,email,firstName,lastName,role,mustChangePassword,profileImageUrl,phone,createdAt,updatedAt}`; 401 when signed out. |
| `POST /api/auth/forgot-password` | none | Body `{email}`. Always answers the same generic 200 for known, unknown and SSO-only emails. The reset token is emailed (the link is built on `APP_BASE_URL`, never the request's Host, R34), stored only as a hash, and never logged. |
| `POST /api/auth/reset-password` | none | Body `{token, password}`. Ends all sessions of that user and clears any lock. Bad or expired token: 400 `invalid_reset_token`. |
| `POST /api/auth/change-password` | session | Body `{currentPassword, password}`. 200; keeps this session, ends the user's other sessions and sockets. 409 `no_local_password` for SSO accounts, 400 `invalid_current_password`, 400 `password_unchanged`. Session only (R33). |
| `GET /api/auth/microsoft`, `GET/POST /api/auth/microsoft/callback` | none | Microsoft 365 SSO. 503 JSON when SSO is not configured. SSO sign-ups default to `customer`. |
| `GET /api/user/sessions`, `DELETE /api/user/sessions/:sessionId` | session | List and revoke the caller's own sessions. |

There is **no `check-email` endpoint**: it was removed because it allowed account
enumeration. Registering an existing email answers `400 email_registered` as above.

A user whose password was reset by an admin has `mustChangePassword: true`. Until they
change it, every `/api` call except `GET /api/auth/user`, `GET /api/logout`,
`POST /api/auth/login`, `POST /api/auth/logout` and `POST /api/auth/change-password` is
`403 password_change_required` (case-insensitive path match).

Accounts that are deactivated or un-approved lose their existing sessions on the next
request (401). A session older than the last password change is `401 session_revoked`.

### 2.2 API-key bearer

`Authorization: Bearer tfk_<43 characters>`. The request acts as the key's owner with the
owner's role and scope. See section 10 for issuing keys. Failure answers:

```json
{ "error": "invalid_token", "message": "The bearer token is invalid, expired or revoked." }
```

with `WWW-Authenticate: Bearer error="invalid_token"`. Failed bearers are counted per IP:
the 11th failure in a minute is `429 too_many_requests` (even for a valid key from that IP
until the window ends). Valid traffic never consumes that budget. A key whose owner is
inactive, unapproved, must change their password, or is a system account is refused.

### 2.3 JWT bearer (off by default)

Accepted only when `BEARER_JWT_ENABLED=true` (and `JWT_SECRET` is set). Otherwise any
non-`tfk_` bearer is `401 invalid_token`. When enabled the token must be HS256, carry the
same `iss` and `aud` as the application's own tokens, a numeric `iat` not in the future,
`exp`, a lifetime of at most 24 hours, not be a refresh token, and be issued after the
owner's last password change. The token's own role claim is ignored: the role is read from
the user row. Nothing in the app mints such tokens today.

### 2.4 Where a bearer works (R33, supersedes R28)

A bearer (API key or JWT) is accepted **only** on:

- `/api/mcp`
- `/api/tasks` and every path under it (`/api/tasks/:id`, `/api/tasks/:id/comments`, ...)
- `/api/auth/user`

Every other `/api` route answers a valid bearer with

```json
{ "error": "session_required", "message": "This action needs a signed-in session; API keys and bearer tokens work only on the ticket API." }
```

(403), whatever the key owner's role: an admin's key cannot invite users, change roles,
rewrite webhook or other settings, list or end sessions, mint keys, change passwords or sign
the owner out. Paths compare lower-cased and by whole segment (`/api/tasksX` is not allowed).

## 3. Tickets ("tasks")

### GET /api/tasks

Tickets the caller may see (see visibility rule), newest first (ties broken by id).
Authentication: session or bearer. Returns a bare array of ticket objects with creator and
assignee names.

Query parameters (all optional; a blank value means absent):

| Parameter | Values |
|---|---|
| `status` | `open`, `in_progress`, `on_hold`, `resolved`, `closed` |
| `priority` | `low`, `medium`, `high`, `urgent` |
| `category` | one of the configured ticket categories (invalid value is 400) |
| `assigneeId` | user id; narrows the visible set, never widens it |
| `teamId`, `departmentId` | positive integers, narrow only |
| `mine` | `true` or `false`; `false` hides tickets assigned to or created by the caller |
| `search` | up to 200 characters, case-insensitive match on title or description; `%` and `_` are literal |
| `limit` | integer 1-500. **Omitted means no limit** (all visible tickets). |
| `offset` | integer 0-1000000 (default 0) |

An invalid `status`, `priority`, `category`, `limit` or `offset` is `400 validation_failed`
with `details`, never an empty list. Pages never overlap or skip rows.

### GET /api/tasks/my

Only tickets **assigned to the caller** as a user assignment, narrowed by the same
`status`, `priority`, `category`, `search`, `limit` and `offset` parameters.

### GET /api/tasks/my-groups

Visible tickets that are not the caller's own (team queues and teammates' tickets). Same
filters.

### POST /api/tasks

Create a ticket. Accepts JSON or multipart (`files` field for attachments, `tags` as a JSON
string). The body is strict: unknown or server-owned fields (`status`, `resolvedAt`,
`closedAt`, `createdBy`, `ticketNumber`, timestamps) are `400`.

```json
{
  "title": "Database connection timeout issue",
  "description": "Users see timeouts on the dashboard",
  "category": "support",
  "priority": "high",
  "severity": "major",
  "assigneeId": "<user-id>",
  "assigneeType": "user",
  "dueDate": "2026-12-01T00:00:00Z",
  "tags": ["database"],
  "estimatedHours": 8
}
```

- Required: `title` (1-255 characters, trimmed) and `category`.
- Created with status `open`, `createdBy` the caller, and a number `TKT-YYYY-NNNN` taken
  from a locked per-year counter (parallel creates never collide).
- `estimatedHours` and `actualHours` are staff only: a customer sending them gets 400.
- Assignment: `assigneeId` (user) or `assigneeType: "team"` with `assigneeTeamId`. Sending
  both ids without `assigneeType` is 400. A nonexistent assignee is 400 naming the field.
  An agent may assign only to themself or to a team they belong to (403 otherwise).
  Customers may send `assigneeType`, `assigneeId`, `teamId`, `departmentId` as routing hints
  (user, team, department-only or unassigned).
- 201 returns the ticket. If an attachment failed to link, a `warning` field is added.
- After creation (never failing it): the AI auto-response if enabled, a realtime event,
  and Teams webhooks of users who can see the ticket.

### GET /api/tasks/:id

One ticket. 400 `invalid_id`, 404 missing, 403 outside the caller's scope.

### PATCH /api/tasks/:id

(`PUT` is not a route.) Partial update. Which fields a role may change:

| Role | Fields |
|---|---|
| admin | `title`, `description`, `category`, `priority`, `status`, `notes`, `assigneeId`, `assigneeType`, `assigneeTeamId`, `dueDate`, `departmentId`, `teamId`, `tags`, `estimatedHours`, `actualHours` |
| manager | same as admin |
| agent | `priority`, `status`, `notes`, `estimatedHours`, `actualHours` |
| customer | `title`, `description`, `notes`, `status` (reopen only) |

Fields the role may not set are dropped; a customer naming hours is refused with 403.
`dueDate: null` clears the date; an absent `dueDate` leaves it. Reassigning clears the other
assignee column. A status change follows the workflow (section 4). Returns the updated
ticket (the MCP tool also reports `appliedFields` and `ignoredFields`).

### DELETE /api/tasks/:id

Permanent delete of the ticket with its comments, history, attachments (S3 objects are
removed best-effort) and assignments. Cost-tracking rows are kept with a null ticket.

- **204** no content on success.
- **Admin only.** A manager may delete only when the server runs with
  `ALLOW_MANAGER_DELETE=true`. Agents and customers get 403.
- 404 when the id does not exist; 403 outside scope.

### GET /api/tasks/:id/history

The ticket's audit trail, oldest first, with the same access rule as `GET /api/tasks/:id`.
Each entry: `{id, taskId, userId, action, field, oldValue, newValue, createdAt, user}` where
`action` is `created`, `updated` or `commented`, `field`/`oldValue`/`newValue` are structured (the client
renders "field: old -> new"), and `user` is the public actor (a customer sees staff as
id/name/picture only).

### Ticket meta

- `GET /api/tickets/meta`: pickers and permissions for the create form. For a customer,
  `assignableUsers` is active, approved managers and agents as `{id, displayName}` only (no
  email, no role).
- `GET /api/tickets/:id/meta`: the same plus what this caller may do on this ticket
  (`allowedFields`, `allowedStatuses`, `allowedAssigneeTypes`, `canAssign`, `canChangeStatus`),
  derived from the same tables PATCH enforces.

## 4. Status workflow

Statuses: `open`, `in_progress`, `on_hold`, `resolved`, `closed`.

Staff (admin, manager, agent) may move a ticket as follows; everything else is
`409 invalid_transition`:

| From | To |
|---|---|
| open | in_progress, on_hold, resolved, closed |
| in_progress | open, on_hold, resolved, closed |
| on_hold | open, in_progress, resolved, closed |
| resolved | open, closed |
| closed | open |

- Staff can **close** from any open state and **reopen** a resolved or closed ticket.
- A **customer** may do exactly one thing: **reopen their own** resolved or closed ticket
  (status `open`). Any other status change by a customer is `403 forbidden`, and a combined
  body containing a refused status is refused whole.
- Setting the status a ticket already has is a no-op `200`.
- `resolvedAt` and `closedAt` are stamped on resolve and close and cleared on reopen.
- The status write is conditional on the status that was checked: if it changed
  concurrently the answer is `409 invalid_transition`.
- A refused status change is written to the security audit log.

409 example:

```json
{ "error": "invalid_transition", "message": "Cannot move a ticket from resolved to on_hold" }
```

## 5. Comments

- `GET /api/tasks/:id/comments`: comments oldest first with a public `user` projection.
- `POST /api/tasks/:id/comments`: body `{content}` only (trimmed, 1-10000 characters; any
  `taskId` or `userId` in the body is ignored). 201 returns the comment. Empty or
  over-long content is 400.

## 6. Attachments

- `GET /api/tasks/:id/attachments`: list with presigned download URLs (1 hour).
- `POST /api/tasks/:id/attachments`: multipart `file`. The access check runs before the
  upload is parsed. 503 `S3_CONFIGURATION_REQUIRED` when S3 is not configured.
- `GET /api/attachments/:id/download`, `DELETE /api/attachments/:id`: need access to the
  ticket; agents may delete only their own uploads.

## 7. Teams webhooks, departments, teams

### Teams (Microsoft) webhook notifications

All five routes are **admin only** (403 for everyone else, 401 anonymous):

| Route | Notes |
|---|---|
| `GET /api/teams-integration/settings` | The caller's webhook settings. |
| `POST /api/teams-integration/settings` | Body fields `enabled`, `teamId`, `teamName`, `channelId`, `channelName`, `webhookUrl`, notification types. The webhook URL must be `https`, default port, no credentials, host name (not an address) under **`*.webhook.office.com`**. Anything else is `400 invalid_webhook_url`. An empty string clears it. |
| `DELETE /api/teams-integration/settings` | Disable. |
| `GET /api/teams-integration/teams` | Needs a Microsoft sign-in token (401 `microsoft_auth_required`). |
| `POST /api/teams-integration/test` | Sends a test card. A stored URL that is not allow-listed, or that resolves to a private address, is refused with 400 before any request. |

Delivery never follows redirects, times out after 8 seconds, refuses private or reserved
addresses, and logs only the host. A ticket event notifies only webhooks whose owner can
access that ticket. The old `outlook.office.com/webhook` URLs are no longer delivered:
re-save a `*.webhook.office.com` URL.

### Teams and team management rules

- `POST /api/teams`: only an **admin** or the **manager of the department** the team is in
  (403 otherwise; the creator does not become a member or team admin by calling it).
  Department must exist and be active (400).
- `POST /api/admin/users/:userId/assign-team` and
  `DELETE /api/admin/users/:userId/remove-team/:teamId`: only an admin or the manager of the
  team's department. Nobody can add themselves. System accounts are refused (404).
- `POST /api/teams/:id/admins`, `DELETE /api/teams/:id/admins/:adminId`: admin, team admin,
  team creator, or the department's manager.
- Team members widen ticket visibility (the "teammate" term), which is why membership
  changes are restricted.
- Other team routes: `GET /api/teams`, `/api/teams/my`, `/api/teams/departments`,
  `/api/teams/:id`, `/api/teams/:id/members`, `/api/teams/:id/admins`,
  `/api/teams/:id/permissions`, `/api/teams/:id/tasks` (the team queue intersected with the
  ticket rule), `/api/teams/:id/tasks/:taskId/assignments` (GET, POST, and PATCH/DELETE on
  `/:assignmentId`; each assignment must belong to the named ticket and team),
  `PATCH /api/teams/:teamId/members/:userId`, `GET /api/user/team-admin-status`.
- Departments: `GET /api/departments`, `/api/departments/:id`, `/api/departments/:id/teams`,
  `/api/departments/:id/stats`; admin: `POST /api/admin/departments`,
  `PUT|DELETE /api/admin/departments/:id`.

## 8. AI routes

All AI routes need a session; the ones under `/api/tasks/:id/...` also take a bearer (R33). AI tools that act on a ticket take **`{ticketId}`**;
the ticket text is always read from the database, never from the request.

| Route | Who | Behaviour |
|---|---|---|
| `POST /api/ai/analyze-ticket` | staff | Body `{ticketId}` (positive integer or digit string up to 2147483647). Read-only analysis; stores nothing. |
| `POST /api/ai/generate-response` | staff | Body `{ticketId}`. Suggested reply for the stored ticket. 400 `ai_disabled` when auto-response is switched off. |
| `GET /api/tasks/:id/auto-response` | ticket access | Staff see the latest AI draft. A customer gets the latest **applied** one, else `404 not_found`: customers never see unapplied drafts. |
| `POST /api/tasks/:id/auto-response/generate` | staff | Generates and stores **one not-applied draft**; posts no comment. |
| `POST /api/tasks/:id/auto-response/apply` | staff | Posts the stored draft as a comment by the AI system user and marks it applied. Idempotent (`{applied:true, alreadyApplied}`); two simultaneous applies post one comment. 404 when there is no draft, 503 `ai_user_unavailable`. |
| `POST /api/tasks/:id/auto-response/feedback` | ticket access | Body `{wasHelpful: boolean}`. 404 when the ticket has no auto-response. |
| `GET /api/ai/knowledge-search` | staff | Query `query` (required, up to 500 characters), `category`, `maxResults`. |
| `GET /api/ai/status` | staff | Which AI features are available. |
| `POST /api/ai/knowledge-learning/run` | admin | Runs the learning pass. |
| `POST /api/tasks/:id/add-to-learning` | ticket access | Queue a ticket for knowledge learning. |
| `POST /api/ai-feedback`, `GET /api/ai-feedback/:type/:referenceId` | signed in | Ratings follow the referenced ticket's access rule; ticketless rows are admin only. |
| `POST /api/chat`, `GET /api/chat/:sessionId`, `GET /api/chat-sessions`, `POST /api/ai/chat` | signed in | Chat assistant. |

Order of refusals for `analyze-ticket` and `generate-response`: 400 bad body, 404 no such
ticket, 403 outside scope or not staff, 503 `ai_not_configured`, 429 over quota.

Cost limit: when the daily, monthly or per-request limit stops a Bedrock call the answer is

```json
{ "error": "quota_exceeded", "message": "AI usage limit reached", "details": { "reason": "...", "costEstimate": 0.12, "isBlocked": true } }
```

Auto-response at ticket creation honours the AI settings at the time of creation (enabled
flag, confidence threshold, `maxResponseLength`); the comment is authored by the AI system
user, not the customer. One analysis stores exactly one auto-response row. The AI system
user (`ai-assistant`) is hidden from every user list and picker, cannot sign in, cannot be
assigned, cannot be given an API key and cannot be named in admin routes (404).

Admin AI settings and analytics: `GET|PUT /api/admin/ai-settings`,
`POST /api/admin/ai-settings/test`, `GET /api/admin/ai-analytics`,
`GET /api/analytics/ai-performance`, Bedrock usage and cost routes under `/api/bedrock/*`.
Escalation settings are stored but have no effect and their controls are hidden in the UI.

## 9. Knowledge base, help documents, company policies, guides

Reading help, policies and guides **requires sign-in** (401 anonymous); previously some were
public.

| Area | Routes | Rules |
|---|---|---|
| Help documents | `GET /api/help`, `GET /api/help/search?q=`, `GET /api/help/:id` | Any signed-in user. Admin: `GET|POST /api/admin/help`, `PUT|DELETE /api/admin/help/:id`. |
| Company policies | `GET /api/company-policies`, `GET /api/company-policies/:id`, `GET /api/company-policies/:id/download` | Signed in. Inactive policies are 404 for non-admins; `includeInactive=true` works for admins only. Admin: `POST /api/admin/company-policies`, `PUT|DELETE /api/admin/company-policies/:id`, `POST .../:id/toggle`. |
| Guides | `GET /api/guide-categories`, `GET /api/guides`, `GET /api/guides/:id` | Signed in. Customers see **published** guides only (a draft is the same 404 as a missing id). Admin: `POST /api/admin/guide-categories`, `PUT|DELETE /api/admin/guide-categories/:id`, `POST /api/admin/guides` (content required), `PUT|DELETE /api/admin/guides/:id`. Guide HTML is sanitised (scripts, handlers, iframes and styles removed; embeds are dropped on save). |
| Knowledge | `GET /api/knowledge/search?query=` (published only; `%` and `_` literal), `GET /api/knowledge/articles`, `POST /api/knowledge/:id/feedback`, `/rate`, `/track-usage`, `POST /api/knowledge/articles/:id/view` | Signed in. |
| Knowledge admin | `GET|POST /api/admin/knowledge`, `GET|PUT|DELETE /api/admin/knowledge/:id`, `PATCH /api/admin/knowledge/:id/publish` (no body toggles; an explicit boolean wins; non-boolean is 400), `/unpublish`, `/archive`, `/unarchive` | Admin only. POST needs `title` and `content`; extra fields are ignored. |

The global request sanitiser is lossless: it strips NUL bytes and the keys `__proto__`,
`constructor`, `prototype`, and never rewrites text. Ticket and comment text round-trips
byte for byte; the strict Content-Security-Policy (`script-src 'self'`) and React escaping
protect plain text. Only fields rendered as HTML (guides) are HTML-sanitised.

## 10. API keys

Admin only, **session only** (R33). Keys are issued by an admin for a chosen user; a caller
cannot create a key for themselves.

### POST /api/api-keys

Body (anything else is ignored; the server sets permissions):

```json
{ "userId": "<owner-user-id>", "name": "reporting agent", "expiresInDays": 90 }
```

- `expiresInDays`: 1-365, default 90.
- **201** returns the key **once**:

```json
{ "id": 7, "userId": "<owner>", "name": "reporting agent", "keyPrefix": "tfk_ab12", "permissions": ["mcp:tickets"], "expiresAt": "...", "isActive": true, "expired": false, "createdAt": "...", "plainKey": "tfk_..." }
```

- The key looks like `tfk_` plus 43 URL-safe characters. Only its **sha256 hash** is stored;
  the plaintext exists nowhere else and is never logged. Lose it and you issue a new one.
- 400 `account_inactive`, `pending_approval` or `system_account` when the owner may not hold
  a key; 404 `user_not_found`.

### GET /api/api-keys[?userId=]

Active keys, never the key or the hash; expired keys are marked `expired: true`.

### DELETE /api/api-keys/:id

Revoke. 204. 404 `api_key_not_found`.

A key stops working immediately when it is revoked or expired, or its owner is deactivated,
unapproved, or must change their password. A password change does not revoke keys. Keys
issued before this release stopped working (legacy rows were deactivated at startup): an
admin re-issues them. The old third-party (Perplexity) key routes no longer exist.

## 11. SSO and email settings (admin only, secrets masked)

Secrets are **never returned**. The response says only whether one is stored.

- `GET /api/sso/config` returns `{clientId, tenantId, hasClientSecret}`.
- `POST /api/sso/config` (session only) takes `{clientId?, tenantId?, clientSecret?}`. An
  absent, null or blank `clientSecret` **keeps** the stored one; a non-empty value replaces
  it. Returns the same masked shape.
- `GET /api/sso/status` (signed in): `{configured: boolean}`. `POST /api/sso/test` (admin):
  checks the tenant's OpenID metadata.
- `GET /api/company-settings/email` returns provider, from address and flags such as
  `hasAwsSecret`, `mailtrapHasToken`, `hasSmtpPassword`. `POST /api/company-settings/email`,
  `PATCH .../email/sender`, `PATCH .../email/settings`, `POST .../email/test` (writes are
  session only). A blank secret keeps the stored one **only for the same provider**; a
  secret never follows an admin across a provider switch.
- `GET /api/bedrock/settings` is masked the same way.
- Company settings: `GET /api/company-settings/branding|tickets|preferences` (signed in),
  `PATCH` the same (admin), `POST /api/company-settings/branding/logo` (admin). A `ticketPrefix`
  must match `^[A-Za-z0-9]{1,6}$` (else `400 validation_failed`).

## 12. Users, invitations, statistics, other routes

| Area | Routes |
|---|---|
| Users | `GET /api/users` (staff only, 403 for customers; no secret fields; system accounts hidden). `GET|PATCH /api/user/preferences`. |
| Admin users | `GET /api/admin/users`, `PATCH /api/admin/users/:userId` (role/profile; 409 `last_admin` when it would leave no active admin, 409 `self_demotion` for your own account, 409 `email_in_use`, 400 `invalid_role`), `POST .../toggle-status`, `POST .../approve`, `POST .../reset-password` (session only; returns `{tempPassword}` once with `Cache-Control: no-store`, sets `mustChangePassword`, ends the user's sessions; 409 `no_local_password` for SSO or system accounts). |
| Invitations | Admin: `GET|POST /api/admin/invitations` (`role` whitelist, `expiresAt` must be in the future and within 30 days, default 7 days; 400 `invalid_expiry` / `invalid_role`), `DELETE /api/admin/invitations/:id`, `POST .../:id/resend`. Public: `GET /api/invitations/:token`, `POST /api/invitations/:token/accept` (an anonymous caller gets `{registrationRequired:true, email, registerPath}` and no account; a signed-in user whose email matches is promoted). Claiming an invitation is atomic. Tokens are 32 random bytes and are redacted from request logs. The admin responses never include the token (R33): it travels only in the emailed link, built on `APP_BASE_URL` (R34). |
| Statistics | `GET /api/stats`, `GET /api/stats/agent`, `GET /api/stats/manager`, `GET /api/stats/global` (admin only), `GET /api/admin/stats` (admin only), `GET /api/activity?limit=` (only events of tickets the caller can see). Counts follow the same visibility rule as the lists. `GET /api/stats/manager` returns `totalTickets`, `priorityDistribution` and `categoryBreakdown` over the manager's `/api/stats` scope (tickets they created, are assigned, or that are queued or assigned within their departments), plus `personal: {assignedToMe, createdByMe}`; its `department` and `teamPerformance` blocks count only tickets queued to the department's teams. |
| Notifications | `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`. |
| Email templates | `GET /api/email-templates`, `PUT /api/email-templates/:name`. |
| Health | `GET /health`, `GET /api/security/health` (outside `/api` JSON contract; no auth). |
| Interactive docs | The `/api-docs` page of the web app. |

## 13. Inbound email: POST /api/email/inbound

The Amazon SNS HTTPS subscription endpoint for SES inbound mail. It has **no session**; the
SNS signature is the only authentication. It sits outside the general `/api` rate limit and
has its own limiter (600 per 15 minutes per IP).

Verification, in this order:

1. The body must be an SNS message (400 `invalid_message`).
2. `SNS_INBOUND_TOPIC_ARN` must be configured, else `503 inbound_email_not_configured`.
3. `TopicArn` must equal it (403 `forbidden`).
4. The message signature must verify (SignatureVersion 1 or 2) with a certificate from
   `sns.<region>.amazonaws.com` of the topic's region (403 `forbidden`).
5. `SubscriptionConfirmation` is confirmed only when `SubscribeURL` is on the SNS host.
6. A `Notification` MessageId is claimed once: a repeat answers `{"status":"duplicate"}`; a
   fresh in-flight claim answers `503 in_progress` with `Retry-After` so SNS retries.

Who may create tickets by email (rulings R25, R26): only **customer** accounts that are
active and approved, matched by exact email, and only when SES reports **DMARC PASS**
(DKIM alone is not enough; there is no switch that lifts this). Staff, AI and system
accounts are never inbound senders. The From header must be a single mailbox and match
SES's parsed From. Unknown senders, auto-replies and virus-flagged mail are ignored.

Outcomes (200): `{"status":"created","ticketId":N}`, `{"status":"commented","ticketId":N}`
(a reply carrying `[TKT-YYYY-NNNN]` becomes a comment by the sender on a ticket they can
access) or `{"status":"ignored","reason":"..."}`. AI auto-response, realtime and Teams
hooks run after SNS is answered and cannot fail it. Nothing logs the sender, subject or
body.

## 14. Realtime WebSocket: `/ws`

Connect to `wss://<host>/ws` with the **session cookie** (the upgrade runs through the same
session and deserialization as HTTP). Identity is never taken from a message the client
sends; client messages are ignored (frames over 1 KB close the socket).

- An upgrade with no valid session, a foreign `Origin` (anything other than the page's own
  host or an entry of `CORS_ORIGIN`; `*` is ignored), an inactive/unapproved user, a user
  forced to change password, a session revoked by a password change, or the AI system user
  is accepted and then closed with code **1008**.
- A role change reconnects the socket (**1012**).

Messages (server to client only):

```json
{ "type": "ticket_updated", "ticketId": 123, "reason": "created", "ts": 1760000000000, "v": 1 }
```

`reason` is `created`, `updated`, `comment` or `deleted`. **Ticket events carry ids only**:
no title, text or user data; the client re-fetches through the REST route, which applies the
access rule. An event is sent only to connected users who can see that ticket right now
(judged on their current row, not their role at connect time); after a reassignment both
the people who lost and gained access hear about it. Staff also receive
`department:created|updated|deleted` events carrying the department.

## 15. MCP server: POST /api/mcp

A Model Context Protocol server over **Streamable HTTP**, stateless (a new server per
request, no session id, JSON responses).

- `POST /api/mcp` only. `GET` and `DELETE` are `405 method_not_allowed` with `Allow: POST`.
- Send `Content-Type: application/json` and
  `Accept: application/json, text/event-stream`.
- Authentication: `Authorization: Bearer tfk_...` with an API key that carries the
  **`mcp:tickets`** permission (every admin-issued key does). No credential or a session
  cookie alone: `401` with `WWW-Authenticate: Bearer`. A JWT is refused. A key without the
  permission: `403 forbidden`. Revoked, expired or unknown keys: `401`.
- Every tool acts as the key's owner and applies the same service rules as REST
  (visibility, field table, workflow, delete rule).

Tool results are JSON text. On success `isError` is absent. On failure the result has
`isError: true` and the text is `{"code","message","details?"}` with `code` one of:

| Code | REST equivalent |
|---|---|
| `VALIDATION` | 400 `validation_failed` (with `details.fieldErrors`) |
| `NOT_FOUND` | 404 `not_found` |
| `FORBIDDEN` | 403 `forbidden` (also reveals that a ticket exists, as REST does) |
| `INVALID_STATE` | 409 `invalid_transition` |
| `INTERNAL` | unexpected failure, generic message, no stack |

Wrong values reach the service and come back as `VALIDATION`, not a protocol error.

A ticket `id` is a positive integer, as a number or as a string of plain digits (`"12"` is 12): no sign,
space, leading zero or decimal point, at most 2147483647. Anything else (`"abc"`, `"1.5"`, `""`, `" 12"`,
`0`, `-1`) is `VALIDATION` with `details.fieldErrors.id`. `limit` and `offset` take a number or a numeric
string the same way; a value out of range or not numeric is `VALIDATION` with `details.fieldErrors.limit`
or `.offset`.

| Tool | Arguments | Returns |
|---|---|---|
| `create_ticket` | `title`, `category` (required); `description`, `priority`, `severity`, `notes`, `assigneeId`, `assigneeType`, `assigneeTeamId`, `dueDate`, `tags`, `estimatedHours`, `actualHours` (staff only) | The ticket (status `open`, created as the key owner). A `status` argument is rejected. |
| `get_ticket` | `id`; `includeComments?` | The ticket, optionally with comments. |
| `list_tickets` | `status`, `priority`, `category`, `assigneeId`, `search`, `limit` (1-100, default 25; number or numeric string), `offset` (0 or more, default 0; number or numeric string) | `{tickets, total, returned, limit, offset, hasMore}`. `total` counts all matching visible tickets; page with `offset + returned` while `hasMore`. An invalid filter is `VALIDATION`, never an empty list. |
| `update_ticket` | `id` plus any updatable field and `status` | `{ticket, appliedFields, ignoredFields}`. |
| `close_ticket` | `id` | The ticket. Staff only; an already closed ticket is `INVALID_STATE`. |
| `reopen_ticket` | `id` | The ticket back to `open`. Staff, or the customer who created it; an open ticket is `INVALID_STATE`. |
| `delete_ticket` | `id`, `confirm` (must be the boolean `true`) | `{deleted:true, id, ticketNumber}`. Admin only (manager only with `ALLOW_MANAGER_DELETE=true`). Without a literal `true` it is `VALIDATION` and nothing is deleted. |
| `add_comment` | `id`, `content` (1-10000 characters) | The comment. |

A refused status change over MCP is written to the security audit log like the REST one, with the
caller's IP and `channel: "mcp"`.
The MCP page size cap (100) is lower than the REST cap (500).

Example call (placeholders only):

```bash
curl -X POST {{baseUrl}}/api/mcp \
  -H "Authorization: Bearer {{apiKey}}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tickets","arguments":{"status":"open","limit":10}}}'
```

## 16. Rate limits

| Limiter | Scope | Limit |
|---|---|---|
| General `/api` | per IP | `RATE_LIMIT_MAX_REQUESTS` (default 100) per `RATE_LIMIT_WINDOW_MS` (default 15 minutes), in production unless `RATE_LIMITING_ENABLED=false` |
| MCP `/api/mcp` | per API key (per IP without one) | 600 per 15 minutes, wherever the general limit is on (not counted by the general limiter) |
| Login | per IP, failed attempts only | 10 per minute, then `429 too_many_requests` |
| Forgot/reset password, change password | per IP, every request | 10 per minute |
| Login lockout | per account | 5 wrong passwords, then `423 account_locked` for 15 minutes (cleared by a token reset or an admin reset) |
| Bearer failures | per IP | 10 rejected bearers per minute, then 429 |
| Inbound email | per IP | 600 per 15 minutes (not counted by the general limiter) |

The server runs behind one reverse proxy (`trust proxy` = 1), so the limits key on the
address the proxy saw.
