# TicketFlow fix program: release notes for the owner

This covers the 24-task fix program on branch `fix/merge-main-and-gaps` (start f5eb5a9; this
document was built on 076197a, with every task merged, and updated by the final fix dispatch
after the whole-branch review: rulings R32-R35 and minors M1-M8). It is written for the person
who deploys. Sections: 1 deploy order and environment variables, 2 owner actions, 3 behaviour
changes users will notice, 4 rulings, 5 follow-ups.

Related files: `API_ENDPOINTS_REFERENCE.md` (every route),
`TicketFlow_API_Collection.postman_collection.json` (requests),
`docs/dc4-validation-2026-10-01/requirements-status-after-fixes.md` (which test proves which
requirement).

## 1. Deploy order and environment variables

### Why the order changed (R32)

`drizzle-kit push` compares `shared/schema.ts` with the database. When the database holds any
table or column the schema does not declare, push asks a question ("created or renamed?", or
"delete this table with N items?"). In the container there is no terminal to answer it: push
prints the question, **exits 0 and applies nothing**, and the old compose command then started
the app against the old schema, where every login answered 500. This was reproduced on a copy
of the pre-program schema with one leftover table: push stopped at the question, exit 0, and
the users lockout columns, `ticket_number_counters`, `sns_message_dedupe` and the API-key index
were all missing afterwards.

Three things now guard against that:

1. **The hand-written migrations run first.** The compose command is now
   `sh -c "npm run db:migrate-sql && npm run db:push && node dist/index.js"`.
   `npm run db:migrate-sql` (`scripts/apply-sql-migrations.mjs`) applies `migrations/0007_*.sql`
   onwards to `DATABASE_URL`, in file order, each file in its own transaction, every deploy
   (each file is idempotent; see below). Every object this program added is created by these
   files, so even when push stops at a question, nothing the new code needs is missing. A
   brand-new empty database is left alone (the script says so) and push creates everything.
   A failing file is rolled back, named in the log, and stops the deploy (exit 1).
2. **The server refuses to boot on a schema it cannot run on.** Before seeding or serving,
   it checks for `users.failed_login_attempts`, `users.locked_until`,
   `users.must_change_password`, `users.password_changed_at`, the `sessions` table,
   `ticket_number_counters`, `sns_message_dedupe.status` and the
   `api_keys_key_hash_sha256_uniq` index. If any is missing it logs one line naming them,
   `Startup refused: the database schema is missing ...`, and exits 1.
3. **You check for drift before deploying** (below), because push still applies nothing else
   while drift exists, and later schema changes would silently not arrive.

`0008_migrate_ai_settings_to_db.sql` is **not run** by the script: it is not idempotent (three
plain `ADD CONSTRAINT`s, which fail with "already exists" on every database push has built,
including on its first run). Everything it creates is declared in `shared/schema.ts` and created
by push. It was not edited (an applied migration is never changed). Its one other effect,
dropping the legacy `bedrock_usage` table, is left to you (see the drift check).

Idempotency was verified by applying every file 0007+ twice, in order, to three scratch
databases: one pushed from the pre-program schema (f5eb5a9), the same with seeded legacy data
(role `user` accounts, plaintext and duplicated API keys, NULL `is_active`, odd ticket numbers,
legacy `users.department` and `bedrock_settings` columns, a `bedrock_usage` table), and one
pushed from the current schema. Every file except 0008 succeeded on both runs on all three;
0008 failed on every run on all three. The full deploy sequence (script twice, then push with no
terminal, then the startup check) was also run in the built image against a drifted copy.

### Before you deploy: the drift check

Run these two queries against the production database. Both lists must be empty, or contain
only the legacy objects named under them.

```sql
-- 1. Tables in public that shared/schema.ts does not declare.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  AND table_name NOT IN (
    'ai_chat_messages','ai_feedback','ai_usage','api_keys','bedrock_settings','company_policies',
    'company_settings','departments','email_providers','email_templates','escalation_rules',
    'faq_cache','help_documents','knowledge_articles','knowledge_embeddings','learning_queue',
    'notifications','resolution_patterns','sessions','sns_message_dedupe','sso_configuration',
    'task_attachments','task_comments','task_history','tasks','team_admins','team_members',
    'team_task_assignments','teams','teams_integration_settings','ticket_auto_responses',
    'ticket_complexity_scores','ticket_number_counters','user_guide_categories','user_guides',
    'user_invitations','user_preferences','users')
ORDER BY 1;

-- 2. Columns of users that shared/schema.ts does not declare.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name NOT IN (
    'created_at','email','failed_login_attempts','first_name','id','is_active','is_approved',
    'last_name','locked_until','must_change_password','password','password_changed_at',
    'password_reset_expires','password_reset_token','phone','profile_image_url','role',
    'updated_at')
ORDER BY 1;
```

- `users.department` (query 2) is expected on old databases: migration 0007 drops it.
- `bedrock_usage` (query 1) is the legacy AI usage table. 0008 would drop it but is not run.
  Back it up if you want its rows, then `DROP TABLE bedrock_usage;` before deploying, or push
  will stop at "delete bedrock_usage table" on every deploy.
- Anything else: do not deploy until you know what it is. If it is obsolete, back it up and drop
  it; if something still uses it, it has to be added to `shared/schema.ts` first.
  (`bedrock_settings.max_requests_per_day`, `max_requests_per_hour` and `is_free_tier_account`
  are dropped by 0009, so they need nothing.)

### Order

1. Run the drift check above and resolve what it finds.
2. Set the environment variables below (in Coolify or wherever the container's environment
   comes from) **before** deploying. `APP_BASE_URL` is new and required (R34).
3. Deploy. The container runs `npm run db:migrate-sql`, then `npm run db:push`, then the app.
4. On start the app checks its configuration (`APP_BASE_URL`, R34) and the schema (R32), then
   runs its startup steps in this order (push never runs data SQL): leftover demo accounts that
   still have the published demo password are deactivated (first, M8); legacy role `user`
   becomes `agent`; inconsistent ticket assignee columns are made consistent; legacy API-key
   rows that are not a sha256 hash are deactivated and their stored plaintext is replaced by
   `legacy-revoked:<sha256 hex>` (nothing is deleted, M6); the system user and the AI system
   user `ai-assistant` are created; the default email templates are seeded (best effort); if
   no active admin exists, the first admin is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
   A failure in any of these steps except the templates stops startup with one line:
   `Startup refused: required step "<name>" failed [<error type>]`.
5. A failed build leaves the old container running. Verify the deployed commit through Coolify
   (the deployment's commit and status), not by comparing bundle hashes.

### After the deploy: verify

1. The container log shows `sql-migrations: done, 10 applied, 1 not run` (on a brand-new
   database: `fresh database ... nothing to apply`) and push's `[✓] Changes applied`. If the push output contains a question ("created or renamed",
   "data-loss statements", "Do you still want to push changes?"), push applied nothing: run the
   drift check again.
2. The log shows `serving on port 5000` and no `Startup refused`.
3. In the database:
   ```sql
   SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name IN ('failed_login_attempts','locked_until','must_change_password','password_changed_at'); -- 4
   SELECT to_regclass('public.ticket_number_counters'), to_regclass('public.sns_message_dedupe');   -- both non-null
   SELECT column_name FROM information_schema.columns WHERE table_name = 'sns_message_dedupe' AND column_name = 'status'; -- 1 row
   SELECT indexname FROM pg_indexes WHERE indexname = 'api_keys_key_hash_sha256_uniq';            -- 1 row
   SELECT count(*) FROM users WHERE role = 'user';                                                -- 0
   SELECT count(*) FROM api_keys WHERE key_hash NOT LIKE 'sha256:%'
     AND (is_active IS NOT FALSE OR key_hash NOT LIKE 'legacy-revoked:%');                         -- 0
   SELECT is_active, is_approved, password IS NULL FROM users WHERE id = 'ai-assistant';          -- f, f, t
   ```
4. Request a password reset for a test account: the emailed link starts with `APP_BASE_URL`.
5. An API key gets 200 on `GET /api/tasks` and 403 `session_required` on `GET /api/users` (R33).

The numbered SQL files in `migrations/` from 0007 (0007, 0009, 0010, 0011, 0012, 0013, 0014,
0018, 0019, 0020) are applied by `npm run db:migrate-sql` on every deploy; 0008 is listed in the
script as not run, with the reason.

### New tables and columns (created by `npm run db:migrate-sql`, and declared for push)

| Change | Where |
|---|---|
| `users.failed_login_attempts`, `users.locked_until` (login lockout) | `users` |
| `users.must_change_password`, `users.password_changed_at` (forced change, session revocation) | `users` |
| `users.is_active` is now `NOT NULL DEFAULT true` (0020). A NULL used to read as inactive everywhere; existing NULL rows become `false` (never `true`), so no account is switched on | `users` |
| `users.role` default is now `customer` in the main table (legacy `user` means agent; the invitations table default is `agent`) | `users`, `user_invitations` |
| `ticket_number_counters` (prefix, year, last_number; primary key prefix+year) | new table |
| `sns_message_dedupe` (message_id, status, received_at) for inbound email | new table |
| `api_keys`: unique partial index `api_keys_key_hash_sha256_uniq` on `key_hash` where it starts with `sha256:` (partial on purpose, so legacy plaintext rows do not block the push) | index |

### Environment variables

Required (production refuses to start without them):

| Variable | Why |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. |
| `SESSION_SECRET` | Signs sessions. Missing in production is a startup error; there is no fallback. A value that is still an example placeholder (`your-...`, `change-me`, `dev-only-...`) is refused too. Checked before the seeders run. |
| `JWT_SECRET` | The JWT module refuses to load in production without it, and refuses a placeholder value like `SESSION_SECRET`. |
| `APP_BASE_URL` | **New (R34).** The public origin, e.g. `https://tickets.example.com` (http or https, no query, a trailing slash is fine). Password-reset and invitation emails, Teams card links and the Microsoft SSO redirect URI are built from it, never from the request's Host header. Production refuses to start without it (`Startup refused: APP_BASE_URL must be set in production ...`); a malformed value is refused in every environment. `MICROSOFT_REDIRECT_URL`, when set, still overrides the SSO redirect URI. In development it may be unset: links then use the origin the request came in on. |
| `NODE_ENV=production` | The Dockerfile sets it; `npm start` does not. Unset means development mode, including a permissive Content-Security-Policy. |

Needed for a fresh install, or when no active admin exists:

| Variable | Why |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Create the first admin. With either unset nothing is created and a log line says so. The password is never logged. Demo accounts are no longer seeded in production. |

New and optional:

| Variable | Default | Why |
|---|---|---|
| `SNS_INBOUND_TOPIC_ARN` | unset | Required to use inbound email. Unset makes `POST /api/email/inbound` answer 503 and refuse everything. |
| `INBOUND_EMAIL_CATEGORY` | a default category | Category for tickets created from email, when it is a valid category. |
| `BEARER_JWT_ENABLED` | off | `true` lets a JWT work as a bearer token (on the ticket API only, R33). API-key bearer needs no flag. |
| `ALLOW_MANAGER_DELETE` | `false` | `true` lets managers delete tickets. Admins can always delete. |
| `SEED_DEMO_DATA` | `false` | `true` seeds demo accounts and tickets. Development only. |
| `CORS_ORIGIN` | `*` | Also the extra origins the WebSocket accepts (a `*` is ignored for the socket). |

Unchanged and still used: `PORT`, `DB_DRIVER`, `AWS_*` and `AWS_S3_BUCKET_NAME`/`AWS_S3_REGION`,
`MAILTRAP_TOKEN`, `MICROSOFT_*`, `COOKIE_SECURE`, `CORS_*`, `INPUT_VALIDATION_ENABLED`,
`VALIDATION_STRICT_MODE`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `MAX_*` upload limits.
`AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MS` are honoured only when `NODE_ENV=test`; do
not set them in production. `INBOUND_EMAIL_ALLOW_UNVERIFIED_SENDER` was removed (R26): setting it
does nothing.

Rate limits (M4): `RATE_LIMIT_MAX_REQUESTS` (default 100) per `RATE_LIMIT_WINDOW_MS` (default
900000, 15 minutes) is now really the general per-IP `/api` limit (it was hard-coded at 100 per
15 minutes before); it applies in production unless `RATE_LIMITING_ENABLED=false`. `/api/mcp`
has its own limit of 600 requests per 15 minutes **per API key**, and `POST /api/email/inbound`
its own 600 per 15 minutes per IP; neither counts toward the general limit.

**The variables reach the container (I5).** `docker-compose.yml` forwards only the variables it
lists, and now lists every variable the server reads: in addition to the older ones,
`APP_BASE_URL`, `BEARER_JWT_ENABLED`, `ALLOW_MANAGER_DELETE`, `SNS_INBOUND_TOPIC_ARN`,
`INBOUND_EMAIL_CATEGORY`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
`MICROSOFT_TENANT_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` and
`AWS_CREDENTIALS_CREATED`, each as a `${VAR}` / `${VAR:-default}` pass-through with no value in
the file. If you deploy with a different compose file, copy those lines: a variable that does not
reach the container silently has no effect, and a feature that fails closed on a blank value
looks the same as a broken feature.

### The image (R35)

The Dockerfile now builds on `node:24-alpine` (it was an unpinned `node:20-alpine`;
`sanitize-html` 2.18 needs Node 22.12 or later and fails with `ERR_REQUIRE_ESM` on 20.18) and
installs with `npm ci` from the shipped `package-lock.json` (it was excluded by `.dockerignore`
and installed with `npm install`). `package.json` declares `"engines": { "node": ">=22.12" }`.
The lockfile was missing its entry for the optional `bufferutil` dependency, which the image's
npm (11.19) refuses in `npm ci`; the entry was added (exactly what npm writes). Verified: the
image builds (Node 24.21), runs the migration script and push, refuses to start without
`APP_BASE_URL`, refuses a database missing the new columns, and serves with both in place.
Dev dependencies stay in the image on purpose: `drizzle-kit` and `pg` run the schema steps at
container start.

## 2. Owner actions

Taken from the ledger's owner notes, plus the consequences of rulings that need a person.

1. **Teams webhooks (release).** Legacy `outlook.office.com/webhook` URLs are no longer
   delivered; admins must re-save a `*.webhook.office.com` URL. Non-admin webhook rows saved
   before this release still deliver (the allow-list and address checks apply at send time)
   until they are cleaned up.
2. **Rotate third-party keys (security).** Legacy `api_keys` rows held PLAINTEXT values in
   `key_hash`, including real third-party (Perplexity) keys saved by the removed route. On the
   first start of this release they are deactivated and the stored value is replaced by
   `legacy-revoked:` plus its sha256 (M6), so the plaintext no longer sits in the table; it may
   still be in database backups taken before the deploy. Rotate those third-party keys at the
   provider. The rows are kept, not deleted.
3. **Re-issue TicketFlow API keys, for the ticket API only (R33).** Pre-existing TicketFlow API
   keys stop working after this release; an admin issues new ones (`POST /api/api-keys`, shown
   once, prefix `tfk_`). A key (or a JWT bearer) now works only on `/api/mcp`, `/api/tasks`
   and everything under it, and `/api/auth/user`; anything else answers 403
   `session_required`. An integration that called other REST routes (users, teams, settings,
   invitations, stats, ...) with a key must sign in with a session instead.
4. **Inbound email configuration.** Set `SNS_INBOUND_TOPIC_ARN` in production (503 without it),
   optionally `INBOUND_EMAIL_CATEGORY`, and subscribe the SNS topic to `/api/email/inbound`.
   `docker-compose.yml` now forwards them (section 1). The new table `sns_message_dedupe` is
   created by `npm run db:migrate-sql`.
5. **Set `APP_BASE_URL` (R34).** Required in production: the server will not start without it.
   Use the address people type in the browser (e.g. `https://tickets.example.com`). Check that
   the Microsoft app registration's redirect URI is `APP_BASE_URL` + `/api/auth/microsoft/callback`
   (or keep `MICROSOFT_REDIRECT_URL` set).
6. **Run the drift check before the first deploy (R32).** Section 1, "Before you deploy". In
   particular drop (after a backup) a leftover `bedrock_usage` table.
7. **Inbound email go-live.** Customers whose domain has no DMARC policy (SES verdict GRAY or
   NONE) are refused: they must use the portal. Emailed-ticket side effects (AI, realtime,
   Teams) run after SNS is answered; a crash in the middle of one loses that side effect.
8. **Guide embeds (product).** Embeds (scribehow or video iframes) are removed when a guide is
   saved. To support them later, allow-list specific hosts in both the HTML sanitiser and the
   CSP `frame-src`.
9. **SSO sign-ups.** New accounts created through Microsoft SSO now default to `customer`. Promote people as needed.
10. **Demo accounts.** On start, known demo accounts whose password still verifies against the
    published demo password are deactivated (R11), before anything else runs (M8). If one
    cannot be checked because the database fails, startup stops. If someone really was using
    one in production, an admin has to reactivate it (and change the password).
11. **First admin.** On a database with no active admin, set `ADMIN_EMAIL` and `ADMIN_PASSWORD`
    before the first start. If `ADMIN_EMAIL` already belongs to a non-admin account, nothing is
    changed and the log says to promote it by hand.
12. **Pending resets and invitations.** Password-reset tokens issued before the deploy stop
    working (they were stored in plaintext; now only a hash is). Invitation tokens issued before
    the deploy still work until they expire (they were weaker random tokens): consider resending
    important ones. The admin invitations screen and API no longer show an invitation's token
    (R33): the link is only in the invitation email, so the email provider must be configured to
    invite anyone.
13. **Lockout recovery.** A locked account unlocks after 15 minutes, on a token password reset,
    or on an admin password reset.
14. **Dependency note.** The lockfile resync in Task 1 dropped packages that were never in
    `package.json` (for example `passport-azure-ad`). They were never declared dependencies.
15. **Hand-off.** Per the owner's instruction, the finished work goes to origin as a new
    branch with a PR into `main`, merged by the DeepSeek Harness autopilot identity.

## 3. Behaviour changes users will notice

Accounts and sign-in
- Five wrong passwords lock an account for 15 minutes (423 `account_locked`). Sign-in attempts
  are limited to 10 per minute per IP.
- Roles are admin, manager, agent, customer. The old `user` role is now `agent`. Self-registered
  accounts are customers and wait for approval unless invited.
- An admin password reset returns a one-time temporary password; the user must choose their own
  at next sign-in (a forced screen, with a sign-out button), and the user's other sessions end.
  Changing your own password ends your other devices. Deactivated or un-approved users lose
  their sessions on the next request.
- Registering an existing email now answers 400 `email_registered`. The `check-email` endpoint
  is gone.
- Invitations: an anonymous "accept" asks the person to register first; invitations can only
  carry known roles; the expiry is within 30 days (default 7); claiming is atomic.

Tickets
- Customers see only tickets they created. Agents see their own, those queued to their teams,
  and their teammates'. Managers see their departments'. Staff can no longer open any ticket by
  id. A ticket outside your scope is 403; a missing one is 404.
- The status workflow is enforced: staff may close from any open state and reopen resolved or
  closed tickets; resolved cannot go to on_hold (409). A customer can reopen their own resolved
  or closed ticket (the UI shows a Reopen button) and cannot close.
- Deleting a ticket is admin only (managers only with `ALLOW_MANAGER_DELETE=true`) and returns
  204. The ticket detail page has an activity history showing "field: old -> new".
- Lists accept and validate `status`, `priority`, `category`, `assigneeId`, `limit` (up to 500)
  and `offset`; a bad value is an error, not an empty list. `GET /api/tasks/my` is only tickets
  assigned to you.
- Create and update validate input strictly (bad enums, blank titles, unknown fields are 400);
  hours are staff only; ticket numbers come from a counter that never collides.
- Customers see staff as a name and picture only (no email or phone). The "assign to" list a
  customer gets when creating a ticket is now active, approved managers and agents as a name
  only (I2): no emails, no roles, no deactivated accounts.
- An emailed reply and an applied AI draft now update open ticket pages in real time, like any
  other comment (M1).
- The ticket number prefix (company settings) must be 1 to 6 letters or digits; anything else
  is refused (400) and the old prefix kept (M5).

AI
- AI routes take `{ticketId}` and read the ticket from the database. Customers never see
  unapplied AI drafts. Staff get a working Apply button (posts the draft as the AI Assistant).
  Auto-responses are authored by an "AI Assistant" system account, not the customer; settings
  (enabled, threshold, length) are honoured at ticket creation. The AI system account is hidden
  everywhere and cannot sign in. The escalation controls in AI settings are hidden (they never
  did anything). The AI knowledge search is staff only. A cost-limit block is a clear 429.

Security and content
- Help documents, company policies and guides need sign-in; customers see only published guides
  and active policies. Guide HTML is sanitised and embeds are dropped.
- Ticket and comment text is stored exactly as typed. The app now sends a strict
  Content-Security-Policy (no inline scripts) and relies on escaping for plain text.
- Team creation and membership changes are limited to admins and the department's manager.
  The last active admin cannot be demoted or deactivated, and an admin cannot demote themselves.
- SSO and email secrets are masked in settings screens: the form shows whether a secret is
  stored and a blank field keeps it.
- Teams webhooks are admin only and must be `*.webhook.office.com`.
- API keys are issued by an admin, shown once, stored hashed, and scoped by the server.
- **API keys and JWT bearers work only on the ticket API (R33).** Accepted on `/api/mcp`,
  `/api/tasks` and everything under it, and `/api/auth/user`. Every other route answers a
  bearer with 403 `{ "error": "session_required" }`, even for an admin's key: a leaked key
  cannot invite an admin, change a role, rewrite webhook settings, read or end sessions, or
  touch any other setting. Before, only a list of credential routes was refused (R28).
- Invitation responses (`POST` and `GET /api/admin/invitations`) no longer include the
  invitation token (R33); it is only in the emailed link.
- Emailed links (password reset, invitations), Teams card links and the SSO redirect use
  `APP_BASE_URL`, never the Host header of the request (R34).
- Every rate-limit answer is `429 { "error": "too_many_requests", "message" }` (M4), the MCP
  endpoint's included (the limiter answers before the MCP transport, so it is this JSON body,
  not a JSON-RPC error). The AI cost-limit answer keeps its own code, `429 quota_exceeded`.
- The MCP `create_ticket` and `update_ticket` tools now say that `notes` are visible to the
  customer; they were described as internal and are not (M3).

New features
- Inbound email: customers with a DMARC-passing domain can open tickets and reply to them by
  email.
- Real-time updates over an authenticated WebSocket; events carry ticket ids only.
- An MCP server at `POST /api/mcp` (API key with `mcp:tickets`) exposes eight ticket tools.
- Every API failure is JSON `{error, message, details?}` with a stable code, never HTML or a
  stack trace.

## 4. Rulings

| ID | Ruling |
|---|---|
| R1 | No `cross-env`; a small `scripts/test-db.mjs` sets `DATABASE_URL` and runs `drizzle-kit push --force` for the test database. |
| R2 | The T8 isolation matrix covers routes that exist at T8; T10 adds `GET /api/tasks/:id/history` to the same matrix file. |
| R3 | `estimatedHours` and `actualHours` are staff only on create and update (dropped for customers, reported in `ignoredFields`); `dueDate` and `tags` are allowed for the creator. |
| R4 | Dev dependencies `jest-environment-jsdom`, `@testing-library/react` and `@testing-library/jest-dom` are allowed (pinned) so the client Jest project can run. |
| R5 | Main's dead duplicates are deleted; main's knowledge-base admin sync endpoints are not ported (the code stays on `origin/main`). |
| R6 | `npm run check` type-checks product code and test code (`tsconfig.test.json`). |
| R7 | Lint uses only the allowed deps (eslint, typescript-eslint, @eslint/js, globals); no react or react-hooks plugins. |
| R8 | SSO password-less accounts never get a local password: forgot-password gives the generic answer but issues no reset for them. |
| R9 | Task 6 is split into 6a (lockout, rate limits, secrets fail closed, seeding gate, log redaction) and 6b (role vocabulary, hashed reset tokens, admin reset, SSO refusal, atomic invitation claim, expiry cap). |
| R10 | Production applies the schema with `drizzle-kit push`; schema changes go in `shared/schema.ts` plus an idempotent hand-written SQL file; data changes run as idempotent logged startup fix-ups. |
| R11 | Startup deactivates (never deletes) known demo users whose hash still verifies against the published password; skipped when `SEED_DEMO_DATA=true`; bootstrap counts only active admins. |
| R12 | Only admins or the manager of the team's department may add members to a team or create teams in that department. |
| R13 | Managers may reassign or transfer a ticket to another department's team or user; they lose visibility afterwards (no restriction added). |
| R14 | Task 9 is split into 9a (create/update validation, assignee normalization and fix-up) and 9b (workflow table, meta route, ticket-number counter, case-insensitive search). |
| R15 | Staff create with both `assigneeId` and `assigneeTeamId` and no `assigneeType` is 400, never silently normalised. |
| R16 | On create an agent may assign only to themself or to a team they belong to (403 otherwise); admin and manager are unrestricted. |
| R17 | Customers get a "Reopen" action in the UI for their own resolved or closed tickets, driven by the meta `allowedStatuses`. |
| R18 | History stays structured (field, oldValue, newValue); the client formats "field: old -> new". |
| R19 | Customers see staff in comments and history as a narrower projection (id, name, avatar), no email or phone. |
| R20 | `/api/ai/knowledge-search` is staff only (only the staff analytics page calls it), with a validated query, quota 429 and safe logging. |
| R21 | Customers never see unapplied AI drafts; a staff-only `POST /api/tasks/:id/auto-response/apply` posts the draft as the AI user and marks it applied. |
| R22 | One auto-response row is stored per analysis (the service owns the write). |
| R23 | The escalation controls in the admin AI settings UI are hidden; the stored fields stay. |
| R24 | Independent tasks run in parallel git worktrees (waves A, B, C), each with its own test database; the controller merges after review and re-runs the full suite; out-of-scope findings are parked. |
| R25 | Inbound email is accepted only from customer accounts (new tickets and replies on their own tickets); staff, AI and system accounts are never inbound senders. |
| R26 | `INBOUND_EMAIL_ALLOW_UNVERIFIED_SENDER` is removed; SES `dmarcVerdict` PASS is required (no bare-DKIM branch). |
| R27 | The global request sanitiser is lossless (drops `__proto__`/`constructor`/`prototype` keys and NUL bytes only); HTML allow-list sanitising applies only to fields rendered as HTML (guides). |
| R28 | Credential-management routes are session only: a bearer (API key or JWT) gets 403 `session_required`. Superseded by R33 (a deny-list missed credential-minting paths). |
| R29 | The JWT bearer path is enabled only with `BEARER_JWT_ENABLED=true`, and then needs the same iss/aud, a numeric `iat` not in the future, and `exp - iat <= 24h`. |
| R30 | Task 20 (ticketService extraction) would start only after Tasks 17 and 19 merged. Superseded in timing by R31. |
| R31 | Task 20 starts from dd16ec6 in parallel with Task 17: REST create/get/update/delete/comment become adapters over `ticketService`; the REST list handlers stay untouched in Task 20 and switch at merge. |
| R32 | Schema safety on deploy: (a) the server refuses to boot (one log line, exit 1) when a required schema object is missing (the users lockout and password columns, `sessions`, `ticket_number_counters`, `sns_message_dedupe.status`, the `api_keys` hash index); (b) `npm run db:migrate-sql` applies the idempotent hand-written migrations 0007+ before `drizzle-kit push` in the compose command (0008 is not run: not idempotent, and push owns its objects); (c) the owner runs a drift check before deploying. |
| R33 | API keys and JWT bearers are accepted only on `/api/mcp`, `/api/tasks` and `/api/tasks/**`, and `/api/auth/user`; every other route answers a bearer with 403 `session_required` (an allow-list, superseding R28). Invitation responses never include the invitation token. |
| R34 | Outbound links (password reset, invitations, Teams cards, the SSO redirect) are built only from `APP_BASE_URL`; production refuses to boot without it; development and test fall back to the request host. |
| R35 | The production image runs Node 24 (`node:24-alpine`), ships `package-lock.json` and installs with `npm ci`; `package.json` engines `node >=22.12`. |

## 5. Follow-ups

The owner chose to defer the minors below instead of running a cleanup pass. One line per
ledger entry ("Task N" is the plan task). Nothing here blocks the release.

### From the final whole-branch review (documented, not fixed)
- Startup now fails fast on required seed steps (M8). FU2: if a row with an id other than
  `system` already holds `system@ticketflow.local`, `seedSystemUser` no longer hits a unique
  violation and restarts the container in a loop; like the AI user it logs one line (ids only),
  creates no `system` row and leaves the other account untouched (rows that need the system
  user then cannot be attributed to it until the clash is resolved; check with
  `SELECT id FROM users WHERE email = 'system@ticketflow.local'`). A transient database error
  during a required step still restarts the container until the database answers.
- Coolify must deploy with the compose file: the Dockerfile `CMD` alone runs neither
  `db:migrate-sql` nor `db:push`, and the schema check then refuses to boot (fails safe).
- `pg` is needed at run time by `scripts/apply-sql-migrations.mjs` but is a devDependency; it
  works because the image keeps dev dependencies (drizzle-kit needs them too).
- An existing ticket prefix longer than 6 characters keeps numbering tickets, but the Tickets
  settings tab cannot be saved until the prefix is shortened (M5).
- The general /api limit stays 100 requests per 15 minutes per IP; `RATE_LIMIT_MAX_REQUESTS`
  now takes effect, so raise it if staff share one NAT address.
- Teams cards for tickets created or updated through MCP carry no link (the service could use
  the APP_BASE_URL helper).
- README and DEVELOPER_DOCUMENTATION still show the old compose command.
- M2: tickets created from email, and customer tickets created with no user or team assignee
  (unassigned, or routed to a department only), are visible among staff only to admins (and to
  the customer who opened them) until someone triages them: manager and agent scope reaches a
  ticket only through its assigned user or team, never through its department alone. Admins should watch the
  unassigned queue, or a later change should route emailed tickets (for example to a default
  department or team).
- M9: list queries load each row separately: `ticketService.listTickets` (MCP, and the REST
  list after the merge) runs one `storage.getTask` per row (up to 100 per page), and several
  other list paths do per-row lookups. Correct but slow on big pages; replace with one joined
  query per page.
- The general per-IP limit (100 per 15 minutes) is low for one busy office behind a single NAT
  address; raise `RATE_LIMIT_MAX_REQUESTS` if staff see 429s.
- `pg` is a devDependency but the server bundle needs it at run time; it is present because the
  image installs dev dependencies (needed for `drizzle-kit`). Move it to `dependencies` when the
  image is slimmed to production dependencies.
- The migration script re-runs every 0007+ file on each deploy (they are idempotent by
  design); a future non-idempotent file must be added to its `NOT_RUN` list or made idempotent,
  or every deploy fails.

### Build, lint and test tooling
- Task 1: `jest.config.mjs` tsJest transform regex `'^.+\.tsx?$'` is unescaped (`\.`).
- Task 1: `server/__tests__/mocks/aws-bedrock.mock.ts` and `utils/*` are unused.
- Task 1: the `package-lock` resync removed `passport-azure-ad` and others that were never in `package.json` (also noted in section 2).
- Task 1: `scripts/test-db.mjs` `TEST_DATABASE_URL` is unused; `env.ts` duplicates the default URL literal.
- Task 1: `fixtures.createTeam` writes through the DB, not the API; permission tests must not rely on it to prove API behaviour.
- Task 1: ts-jest `isolatedModules` hides test type errors from Jest; `npm run check` must keep covering tests (done in Task 2).
- Task 1: `bedrockIntegration.generateResponse` is covered only through `analyzeTicket`.
- Task 2: `companySettings.email.test.ts` has a duplicated cast `as unknown as unknown as AsyncMock`; repeated double casts (needs a helper) and pre-existing `as any` on mocks.
- Task 2: `tsconfig.test.json` include list has redundant entries; `jest.setup*` may match nothing.
- Task 3: eslint `caughtErrors: "none"` is weaker than the default; `varsIgnorePattern ^_` makes renames permanent suppressions.
- Task 3: CRLF to LF whole-file churn in `BrandingTab.tsx`, `PreferencesTab.tsx`, `CompanyConsole/index.tsx`, `s3Service.ts`.
- Task 3: `seed-knowledge-learning.ts` and `seedTickets.ts` have whitespace-only lines; `shared/schema.ts` has a bare `import "./constants"`.
- Task 10 (parked): `noDuplicateRoutes` does not see `/health` and `/api/security/health` registered in `server/index.ts`.
- Task 10: the `tickets.delete.test.ts` "row is locked first" test passes without `FOR UPDATE`; make it discriminating (a holder inserts a comment in an open transaction, `deleteTask` must resolve and the comment count be 0).
- Task 23: Playwright trace retain-on-failure records test passwords in the gitignored `test-results` (do not upload in CI); the CSP listener attaches after login in later tests; the 404 matcher is loose.

### Authentication, sessions and accounts
**FU2 status:** every line below was handled in the `fix(auth): follow-ups` commit except the
items under "Still open after FU2". The original lines are kept as the record. Fixed: change-password
spends the lockout budget; forgot, reset and change-password have separate rate-limit budgets;
the revoked cookie is cleared; the session stores the verified row's change stamp (`pwdAt`,
closes the `authAt` race); the `bearerFailures` table is capped; `/apixyz` is no bearer path;
a blank SES secret is refused for a key id that is not the server's own, with `fieldErrors`;
`secureAuth.ts`, `sanitizeForSQL` and `sanitizeText` are deleted; placeholder secrets are refused
in production and `SESSION_SECRET` is checked before the seeders; `users.is_active` is NOT NULL
(0020); the audit line names the signed-in actor; the second session stack and the logged
authorize URL / MSAL error object are gone; the forced screen signs out like the header menu.
**Still open after FU2:** `phone` stays visible to every agent (owner question);
`invitation.departmentId` is never applied (users have no department link); the failure counter
does not decay (documented in `lockout.ts`); the changer's in-flight request can save old stamps
(fails closed) and multi-instance clock skew (documented in `isSessionRevoked`); the SMTP adapter
is not implemented, so a blank SMTP password simply stores none; `trust proxy 1` assumes one proxy
(commented at the setting); SSO sign-ups still default to customer (owner note); `--runInBand` stays
global; CRLF churn items are not touched (R37); `generateTokens`' 7-day JWTs cannot be bearers
(R29, accepted).
- Task 4: `/api/users` 403 body lacks an error code; duplicate requester lookup routes (`:371`/`:190`); `toPublicUser` unused in production; the staff-role test lacks legacy `user` and `forTeamMemberSelection` for manager and agent; the secrets hook covers only `createTestApp` apps; `--runInBand` is global; `phone` is visible to all agents (an owner question).
- Task 5: legacy error shapes in register/create handlers; a duplicate email should be 409 (deferred to Task 7).
- Task 5: tests assert status, not error codes; no test for role or `isApproved` in the register body; `invitation.departmentId` is never applied (pre-existing).
- Task 6a: the `runSeeders` comment and test claim startup stops, but `server/index.ts` catches (fixed by the final dispatch, M8); deploy order (columns before code; fixed by R32); an `ADMIN_EMAIL` collision is only logged; the failure counter never decays; forgot and reset share one limiter budget; no placeholder-secret rejection; `trust proxy 1` assumes a single proxy; `SESSION_SECRET` fails after the seeders; `as any` at `auth:197`.
- Task 6a: stale "read per request" comment at `rateLimiting.ts:35-37`; the broad log mask hides `totalTokens`, `keywords` and similar in log lines; CRLF churn in `seedUsers.ts` and `storage.inteface.ts`; `login.lockout.test.ts:150` stores a plaintext reset token (6b was to update it); `users.isActive` is nullable (NULL is treated as inactive; consider NOT NULL).
- Task 6a: `deactivateDemoAccounts` uses `lower(email) limit 1`, so it checks only one of case-variant duplicate emails.
- Task 6b: the `invitations.claim.test` "claim that fails creates no user" exercises the pre-check, not the transactional claim; legacy error bodies in touched handlers; a seeder failure is swallowed (a failed fix-up leaves raw role queries missing `user` rows; fixed by the final dispatch, M8); SSO sign-ups now default to customer (owner note); `(db as any).transaction` is untyped.
- Task 6b: change-password shares the `authRequestRateLimit` budget; wrong current passwords do not count toward lockout; the `passwordChange` test's `String(arg)` hides nested objects; the SES error test lacks a positive assertion; `safeErrorSummary` drops non-Error or AWS names; `client/src/types/user.ts` CRLF churn; `rbac.logSecurityEvent` reads `req.user?.userId` (sessions carry `id`), so the audit userId is "anonymous"; `setupMicrosoftAuth` mounts a second session/passport stack.
- Task 6b: the changer's own in-flight request can revert `authAt` (fails closed); multi-instance clock skew; the revoked cookie is not cleared.
- Task 6b: the forced-screen sign-out does not navigate (a deep path lands on NotFound) and duplicates `useAuth.logout`; the `authAt` residual race (`setTemporaryPassword` stamps before commit; the exact fix is to store the verified row's `passwordChangedAt` in the session) has no race test; `passwordChange.test.ts:240-242` final 401 is not from revocation; the client test "does not reject unhandled" asserts nothing; `microsoftAuth.ts:136` logs the authorize URL with state, `:194` logs the MSAL error object.
- Task 19: the `bearerFailures` map has no hard size cap (O(n) prune per failure); `extractBearer` `startsWith('/api')` also matches `/apixyz`; `generateTokens`' 7-day JWTs cannot be bearers (R29).
- Task 18: a blank SMTP or SES secret with nothing stored falls back to env credentials even for a new host (pre-existing, admin only); `secureAuth.ts` is an unimported module (delete it); a 400 `details.required` is returned instead of `fieldErrors` for secret fields.

### Ticket access, workflow and API contract
- Task 7: the numeric `app.param` list is hard-coded (`install.ts:360`), so a future `:articleId` is silently unvalidated; the generic 4xx branch maps other middleware's 401/403/404 message to `bad_request` (`errors.ts:339`); the string-param test asserts only "not invalid_id"; an anonymous bad id is 400 before 401 (accepted).
- Task 8: PATCH checks access twice (harmless).
- Task 9a: `assertAgentMayAssign` returns early on a null role (unreachable; deny-by-default would be tidier); PATCH `assigneeId ""` now reads as absent (only null clears); other route catches still return ad-hoc `{message}` 500s (meta route went to 9b, the rest to Task 17).
- Task 9b: `updateTask` with 0 rows and no `expectedStatus` is 409 `invalid_transition` and should be 404 (to Task 10); no test runs the demo seeders twice then creates; `createTask`'s second 23505 failure gives a raw pg error to the generic 500; the `updateTask` history loop logs null/0 oddly via `||`.
- Task 10: client `ticketHistory.ts` renders `""` as blank and should render an em dash; `deleteTask` logs S3 error text verbatim (log injection negligible).
- Task 11: legacy role `user` is missing from the stats parity matrix (fixtures `TestRole` excludes it); `getAgentStats` and `getManagerStats` lack `onHold`; manager stats loads rows in JS; department `highPriority` is high+urgent versus `/api/stats` high only; manager stats exclude own created or assigned tickets; `listAll` paging orders by `createdAt` only (ties).
- Task 17 (parked): the last-admin check is raceable (no row lock); `isActive` NULL is counted inconsistently.
- Task 17: the last-admin check has no row lock; `isActive` NULL counting is inconsistent; `getTasks` `lastUpdatedBy` is now "Support agent" for missing user rows.
- Task 20 (parked): customer routing rewrite stays in the REST create handler (no visibility difference); `listTickets` runs `getTask` per row (up to 100); a double access query on REST by-id; no Teams link on MCP updates.
- Task 20: REST `change_status` audit logs userId "anonymous" (reads `req.user.userId`; pre-existing); MCP audit `ip='mcp'`; customer routing rewrite still in the REST create handler; `listTickets` per-row `getTask`; double access query on REST by-id; no Teams link on MCP updates.

### AI
- Task 12: on the create path, a comment written and then a failed `setApplied` leaves the row unapplied (a later apply duplicates; the log says "comment failed").
- Task 12: `ticketsResolvedByAI` compares the draft `createdAt`, not the applied time, and `COALESCE(resolvedAt, closedAt)` is stale after a reopen; `knowledgeBaseLearning` logs the ticket category; raw `console.error(error)` in non-AI knowledge routes (about `:4352` and `:5612`); `ESCALATION_ACTIVE` is client-only.
- Task 12 (out-of-scope review note): the tests README still describes the old mock.

### Realtime, Teams webhooks and inbound email
- Task 14: `acceptInvitationForUser` and `approveUser` do not call `disconnectUser` (the lazy re-check covers it); a per-event users read and a UNION per 200 sockets; `originAllowed` trusts `x-forwarded-host`; `secureAuth.ts` is a dead module.
- Task 15: the DNS-rebinding window (the allow-list is the control; pinning through an undici dispatcher would need a dependency); fan-out runs one `canAccessTask` per webhook row per event with no concurrency cap (disable legacy non-admin webhook rows after deploy); `createTeam` still inserts the creator as team admin (latent if a new caller appears); team routes still return `{message}` without `error` (to Task 17).
- Task 16: display names containing `@` or a backslash are refused (safe direction); a fenced-out late holder only logs; the done mark is not in the same transaction as the create (`createTask` has no transaction); the 64 KB header cap may refuse long Received or ARC chains (check real sizes after deploy).

### Security hardening and deployment
- Task 13: `NODE_ENV` unset means development mode including a permissive CSP (the Dockerfile sets production, `npm start` does not); consider failing loudly when it is unset and `dist` exists; a subtree deeper than 20 is not walked; `sanitizeForSQL` and `sanitizeText` are dead; existing 404s lack an error code (to Task 17).

### MCP
- Tasks 21 and 22: the MCP list limit is capped at 100 versus REST 500; the invented-status test accepts `VALIDATION` or `INVALID_STATE`; the isolation suite's last test is order-dependent; a non-numeric id gives the SDK's plain-text error; `get_ticket` FORBIDDEN discloses existence (REST parity).
