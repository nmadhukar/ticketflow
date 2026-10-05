# TicketFlow fix program: release notes for the owner

This covers the 24-task fix program on branch `fix/merge-main-and-gaps` (start f5eb5a9; this
document was built on 076197a, with every task merged, and updated by the final fix dispatch
after the whole-branch review: rulings R32-R35 and minors M1-M8). It is written for the person
who deploys. Sections: 1 deploy order and environment variables, 2 owner actions, 3 behaviour
changes users will notice, 4 rulings, 5 follow-ups, 6 the follow-ups round of 2026-10-03, 7 the
final follow-ups round of 2026-10-03 (this closes every open line in sections 5 and 6).

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
   `sh -c "npm run db:migrate-sql && npm run db:push && exec node dist/index.js"` (the Dockerfile
   `CMD` runs the same three steps since the final round, R66; `exec` makes node PID 1).
   `npm run db:migrate-sql` (`scripts/apply-sql-migrations.mjs`) applies `migrations/0007_*.sql`
   onwards to `DATABASE_URL`, in file order, each file in its own transaction, every deploy
   (each file is idempotent; see below). Every object this program added is created by these
   files, so even when push stops at a question, nothing the new code needs is missing. A
   brand-new empty database is left alone (the script says so) and push creates everything.
   A failing file is rolled back, named in the log, and stops the deploy (exit 1).
2. **The server refuses to boot on a schema it cannot run on.** Before seeding or serving,
   it checks for `users.failed_login_attempts`, `users.locked_until`,
   `users.must_change_password`, `users.password_changed_at`, `users.last_failed_login_at`, the
   `sessions` table, `ticket_number_counters`, `sns_message_dedupe.status`,
   `ticket_auto_responses.applied_at` and the `api_keys_key_hash_sha256_uniq` index. If any is missing it logs one line naming them,
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

Run these three queries against the production database. Every list must be empty, or contain
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
    'last_failed_login_at','last_name','locked_until','must_change_password','password',
    'password_changed_at','password_reset_expires','password_reset_token','phone',
    'profile_image_url','role','updated_at')
ORDER BY 1;

-- 3. Columns of ticket_auto_responses that shared/schema.ts does not declare.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ticket_auto_responses'
  AND column_name NOT IN (
    'id','ticket_id','ai_response','confidence_score','was_helpful','was_applied','applied_at',
    'responded_by','created_at')
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

1. The container log shows `sql-migrations: done, 12 applied, 1 not run` (on a brand-new
   database: `fresh database ... nothing to apply`) and push's `[✓] Changes applied`. If the push output contains a question ("created or renamed",
   "data-loss statements", "Do you still want to push changes?"), push applied nothing: run the
   drift check again.
2. The log shows `serving on port 5000` and no `Startup refused`.
3. In the database:
   ```sql
   SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name IN ('failed_login_attempts','locked_until','must_change_password','password_changed_at','last_failed_login_at'); -- 5
   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'ticket_auto_responses' AND column_name = 'applied_at';                       -- 1 row
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
0018, 0019, 0020, 0021, 0022) are applied by `npm run db:migrate-sql` on every deploy; 0008 is listed in the
script as not run, with the reason.

### New tables and columns (created by `npm run db:migrate-sql`, and declared for push)

| Change | Where |
|---|---|
| `users.failed_login_attempts`, `users.locked_until` (login lockout) | `users` |
| `users.must_change_password`, `users.password_changed_at` (forced change, session revocation) | `users` |
| `users.is_active` is now `NOT NULL DEFAULT true` (0020). Sign-in, sessions and listings read a NULL as inactive, but the Teams webhook check (`IS NOT FALSE`) and the old last-admin check read it as active. Existing NULL rows become `false` (never `true`), so no account is switched on; the one visible effect is that a NULL user's Teams webhooks stop firing, the safe direction | `users` |
| `users.role` default is now `customer` in the main table (legacy `user` means agent; the invitations table default is `agent`) | `users`, `user_invitations` |
| `ticket_number_counters` (prefix, year, last_number; primary key prefix+year) | new table |
| `sns_message_dedupe` (message_id, status, received_at) for inbound email | new table |
| `api_keys`: unique partial index `api_keys_key_hash_sha256_uniq` on `key_hash` where it starts with `sha256:` (partial on purpose, so legacy plaintext rows do not block the push) | index |
| `ticket_auto_responses.applied_at` (0021, R48): when the draft was applied; NULL for a draft never applied and for a row applied before the column existed | `ticket_auto_responses` |
| `users.last_failed_login_at` (0022, R53): when the last failed login was counted; the failure counter restarts once the lockout window has passed since it | `users` |

### Environment variables

Required (production refuses to start without them):

| Variable | Why |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. |
| `SESSION_SECRET` | Signs sessions. Missing in production is a startup error; there is no fallback. A value that starts like an example placeholder (`your-`, `change-me`, `replace-with`, `dev-only-`, `long-random-string`, `example`, `todo`, ...) or is shorter than 32 characters is refused too. Checked before the seeders run. |
| `JWT_SECRET` | The JWT module refuses to load in production without it, and refuses a placeholder value and a value shorter than 32 characters, like `SESSION_SECRET`. |
| `APP_BASE_URL` | **New (R34).** The public origin, e.g. `https://tickets.example.com` (http or https, no query, a trailing slash is fine). Password-reset and invitation emails, Teams card links and the Microsoft SSO redirect URI are built from it, never from the request's Host header. Production refuses to start without it (`Startup refused: APP_BASE_URL must be set in production ...`); a malformed value is refused in every environment. `MICROSOFT_REDIRECT_URL`, when set, still overrides the SSO redirect URI. In development it may be unset: links then use the origin the request came in on. |
| `NODE_ENV=production` | The Dockerfile sets it; `npm start` does not. **Required for the built server (FU5):** `node dist/index.js` (so `npm start`) refuses to boot with one log line when it is unset; `npm run dev` through tsx still defaults to development. |
| `COOKIE_SECURE` | **Set `true` behind HTTPS.** The session cookie is `Secure` only when this is `true`, not by `NODE_ENV` (Y9). The compose file passes it through, but Coolify must hold a value. Unset or `false` sends the cookie over plain HTTP. |
| `DEFAULT_TRIAGE_TEAM_ID` | **New (R36), optional.** A positive team id. Emailed tickets and customer tickets with no user or team assignee are queued to that team, so its members can see them. Unset or blank: unchanged (admin triage). A value that is not a positive integer or names no team logs one line at startup and is ignored. If the team is deleted later, such tickets are created unassigned (one log line, ids only), never a 500. |

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

Rate limits (M4): `RATE_LIMIT_MAX_REQUESTS` (default 600 since the final round, R52; it was 100)
per `RATE_LIMIT_WINDOW_MS` (default 900000, 15 minutes) is the general per-IP `/api` limit; it applies in production unless `RATE_LIMITING_ENABLED=false`. `/api/mcp`
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

1. **Teams webhooks (release; R84 in the final round).** Teams webhooks are now OFF by default:
   nothing is sent until `TEAMS_WEBHOOKS_ENABLED=true` is set in Coolify (section 7). Legacy
   `outlook.office.com/webhook` URLs are no longer
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
9. **SSO sign-ups (R42, final round).** New accounts created through Microsoft SSO are `customer`
   by default and always wait for admin approval. To make new SSO accounts agents instead, set
   `SSO_DEFAULT_ROLE=agent` (the only other accepted value; `admin` or anything else is logged
   once and read as `customer`). The role is set only when the account is created: a later
   sign-in never changes an existing account's role or approval. Promote people by hand as needed.
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
13. **Lockout recovery (R53, final round).** A locked account unlocks after 15 minutes, on a token
    password reset, or on an admin password reset. The failure counter also restarts once 15
    minutes have passed since the last failed attempt (`users.last_failed_login_at`, migration
    0022), so four misses in the morning no longer make one more miss in the afternoon the
    fifth. Five misses inside one window still lock.
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

**Status after the final follow-ups round (2026-10-03, section 7): nothing in this section is
open.** Every line is either RESOLVED (FFn: fixed in that task of the final round, or FUn in the
earlier one), DECIDED (Rnn: closed by that ruling, no code change) or ALREADY FIXED (verified,
with the evidence in the plan's item ledger). The lines keep their original wording as the record;
the verdicts are at the head of each subsection and on every line that used to say "still open".
Items are cited as in the plan's ledger, `docs/superpowers/plans/2026-10-03-ticketflow-followups-final.md`
(N01-N67 follow-up items, C01-C50 requirement caveats).
The only residuals are the known ones listed in section 7 ("Known residuals"): they were found by
the final round and are not ledger items.

### From the final whole-branch review (documented, not fixed)
RESOLVED (FU3): M2 (emailed and unassigned customer tickets visible only to admins) by R36 and
`DEFAULT_TRIAGE_TEAM_ID`, see section 6; M9 (per-row list queries): `listTickets` is now a count
plus one page query and the REST list is one query. RESOLVED (FF4, R52, N01): the per-IP limit
default is now 600 per 15 minutes (it was the 100-per-15-minutes line that stayed open here).
Verdicts for the other lines below: startup fail-fast on a transient database error and the
system-user email clash: DECIDED (R69, N02 and N67). The Dockerfile `CMD` alone running no schema
steps: RESOLVED (FF5, R66, N03): it runs the same three steps as compose. A future non-idempotent
migration failing every deploy: ALREADY FIXED (N04): `schemaSafety.test.ts` runs the real script
over `migrations/` twice, and FF5 derived its file list from the directory.
- Startup now fails fast on required seed steps (M8). FU2: if a row with an id other than
  `system` already holds `system@ticketflow.local`, `seedSystemUser` no longer hits a unique
  violation and restarts the container in a loop; like the AI user it logs one line (ids only),
  creates no `system` row and leaves the other account untouched (rows that need the system
  user then cannot be attributed to it until the clash is resolved; check with
  `SELECT id FROM users WHERE email = 'system@ticketflow.local'`). A transient database error
  during a required step still restarts the container until the database answers.
- RESOLVED (FF5, R66, N03; was: Coolify must deploy with the compose file): the Dockerfile `CMD` alone ran neither
  `db:migrate-sql` nor `db:push`, and the schema check then refuses to boot (fails safe).
- `pg` is needed at run time by `scripts/apply-sql-migrations.mjs`. Fixed (FU5): it is now a
  `dependencies` entry (same version).
- An existing ticket prefix longer than 6 characters keeps numbering tickets. Fixed (FU5): the
  prefix is validated only when a request changes it, so the Tickets settings tab saves the other
  fields (M5).
- RESOLVED (FF4, R52, N01): the general /api limit is now 600 requests per 15 minutes per IP
  (was 100); `RATE_LIMIT_MAX_REQUESTS` still overrides it.
- RESOLVED (FU4): Teams cards for tickets created or updated through MCP now carry the
  APP_BASE_URL link (no link when APP_BASE_URL is unset or unusable).
- README and DEVELOPER_DOCUMENTATION showed the old compose command. Fixed (FU5): both now give
  the current one, the required environment and the Node 24 image. RESOLVED (FF5, R66): the
  Dockerfile `CMD` no longer skips the schema steps, and its comment says so.
- RESOLVED (FU3, R36): M2: tickets created from email, and customer tickets created with no user or team assignee
  (unassigned, or routed to a department only), are visible among staff only to admins (and to
  the customer who opened them) until someone triages them: manager and agent scope reaches a
  ticket only through its assigned user or team, never through its department alone. Admins should watch the
  unassigned queue, or a later change should route emailed tickets (for example to a default
  department or team).
- RESOLVED (FU3): M9: list queries load each row separately: `ticketService.listTickets` (MCP, and the REST
  list after the merge) runs one `storage.getTask` per row (up to 100 per page), and several
  other list paths do per-row lookups. Correct but slow on big pages; replace with one joined
  query per page.
- RESOLVED (FF4, R52, N01): the general per-IP limit default is 600 per 15 minutes, which one
  busy office behind a NAT address does not reach; `RATE_LIMIT_MAX_REQUESTS` raises it further.
- `pg` as a devDependency: done (FU5), see above.
- The migration script re-runs every 0007+ file on each deploy (they are idempotent by
  design); a future non-idempotent file must be added to its `NOT_RUN` list or made idempotent,
  or every deploy fails. This guidance is now in the header of `scripts/apply-sql-migrations.mjs`
  and in README and DEVELOPER_DOCUMENTATION (FU5). ALREADY FIXED (N04): `schemaSafety.test.ts`
  applies every 0007+ file twice, so a non-idempotent file fails the suite before it ships.

### Build, lint and test tooling
RESOLVED (FU1): the Task 1 lines (transform regex, unused mock and utils, `TEST_DATABASE_URL`
duplicate, `createTeam` warning, `isolatedModules`, `generateResponse` coverage), the Task 2 lines
(duplicated casts, redundant tsconfig includes), Task 3 `caughtErrors` (now `all`), the Task 10
`noDuplicateRoutes` health routes and the `FOR UPDATE` test, and the Task 23 CSP listener and 404
matcher. The Playwright trace line: ALREADY FIXED (N07): the gate uses per-run random passwords
on a throwaway database, and `test-results` is gitignored. DECIDED (R37, N05): the CRLF and
whitespace-only churn lines are not changed; changing them changes no behaviour and hurts blame
and merges. DECIDED (R80, N06): the lockfile resync dropped packages that were never declared in
`package.json`, so there is nothing to restore.
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
**Closed in the final round (was "Still open after FU2"):**
- `phone` was visible to every agent: RESOLVED (FF1, R41, N08). Admins, managers and the user
  themself see a phone number; agents and customers never see another user's.
- `invitation.departmentId` was never applied: RESOLVED (FF1, R43, N09). The department is removed
  from the API (a body field is ignored), the form, the card and the email.
- The failure counter did not decay: RESOLVED (FF1, R53, N10). It restarts after the lockout
  window passes since the last failure (`users.last_failed_login_at`, migration 0022).
- The changer's in-flight request can save old stamps (fails closed) and multi-instance clock
  skew: DECIDED (R70, N11 and N12).
- The SMTP adapter is not implemented: RESOLVED (FF1, R58, N13). SMTP, Mailgun, SendGrid and Custom
  cannot be selected (400 `provider_not_supported`); implementing one needs a new dependency.
- `trust proxy 1` assumed one proxy: RESOLVED (FF4, R49, N14): `TRUST_PROXY_HOPS`.
- SSO sign-ups defaulted to customer (owner note): RESOLVED (FF1, R42, N15): `SSO_DEFAULT_ROLE`
  (`customer` default, or `agent`); accounts always wait for approval.
- `--runInBand` stays global: DECIDED (R71, N16). CRLF churn: DECIDED (R37, N05). `generateTokens`'
  7-day JWTs cannot be bearers: DECIDED (R29, N17).
- Also closed here: an `ADMIN_EMAIL` owned by a non-admin is only logged: DECIDED (R72, N18);
  `closeAuth` kept one store reference: RESOLVED (FF1, R55, N19); the audit line and the default
  limiter key read `req.user?.userId`: RESOLVED (FF4, R56, N20); the secrets test's sample list was
  hard-coded: RESOLVED (FF1, R57, N21); a real secret starting with "todo" or "example" is refused:
  DECIDED (R73, N22); the SES stored-secret guard: ALREADY FIXED (N23); per-process lockout and
  limiter counters: DECIDED (R70, N55); duplicate email on register stays 400: DECIDED (binding,
  N53).
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
RESOLVED (FU3): Task 7 (`app.param` list, generic 4xx mapping, string-param test); Task 8 and
Task 20 (double access query, customer routing now in `ticketService`, per-row `getTask`); Task 9a
(null role denied); Task 9b (0-row update is 404, second ticket-number clash is 409 `conflict`,
seeders twice); Task 10 (client em dash); Task 11 (legacy `user` in the parity matrix, `onHold`,
manager stats in SQL, one `highPriority` definition, `listAll` tie order); Task 17 (last-admin
check is now locked, `isActive` NULL counted one way, and `toggle-status` has the same rule),
and the audit user id. RESOLVED (FU4): no Teams link on MCP updates. Closed in the final round
(was "Still open, deliberately"): manager stats now include the manager's own created and assigned
tickets plus a personal block: RESOLVED (FF2, R45, N24); `getTasks` per-row lookups (tests only):
RESOLVED (FF2, R59, N25), the method is deleted; `get_ticket` FORBIDDEN existence disclosure (REST
parity): DECIDED (R74, N26). Also closed here: `lastUpdatedBy` "Support agent" for a missing user:
RESOLVED (FF2, R59, N29); MCP audit `ip='mcp'`: RESOLVED (FF2, R60, N30), the audit line carries the
caller's IP; an anonymous malformed id is 400 before 401: DECIDED (R75, N27); PATCH `assigneeId
""` reads as absent: DECIDED (R76, N28); toggle-status reading `isActive` outside the lock and the
triage team deleted after startup: ALREADY FIXED (N32, N31); the dead unlocked
`storage.toggleUserStatus`: RESOLVED (FF2, R62, N33); the per-create triage lookup: DECIDED (R77,
N34); `updateTask` history logging null/0: ALREADY FIXED (N65).
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
- Task 12: RESOLVED (FU4). On the create path, a comment written and then a failed `setApplied` is retried once and logged as "the comment was posted but marking the draft applied failed" (no longer "comment failed"). If the row stays unapplied, the apply route finds the AI comment with the same response text, marks the draft applied and posts nothing (`alreadyApplied: true`). Test: `ai.routes.test.ts` "comment written but setApplied failing".
- Task 12: RESOLVED (FU4). `ticketsResolvedByAI` now uses the applied time (the AI comment's `created_at`, falling back to the draft's `createdAt` when no comment is found) and the LATEST resolution (`GREATEST(resolvedAt, closedAt)`). `knowledgeBaseLearning` no longer logs the ticket category; the remaining raw error logs (ticket knowledge learning, attachments, S3 delete) log the error type only (`logRouteError`). The non-AI knowledge routes already used `logRouteError`.
- Task 12: DECIDED (R23, N36): `ESCALATION_ACTIVE` is client-only. RESOLVED (FF3, R48, N37 and N40): "tickets resolved by AI" counts from `ticket_auto_responses.applied_at` (migration 0021; legacy NULL rows keep the old rule), so a second draft applied after the resolve is not over-counted. RESOLVED (FF3, R64, N39): the apply route's comment check filters in SQL with bound parameters.
- Task 12 (out-of-scope review note): RESOLVED (FU4). The tests README describes the real layout, the SDK-boundary Bedrock mock and the run commands.

### Realtime, Teams webhooks and inbound email
- Task 14: RESOLVED (FU4). `acceptInvitationForUser` (after the commit) and `approveUser` now call `disconnectUser(userId, 1012)`. `originAllowed` no longer trusts `x-forwarded-host` unless the app's Express `trust proxy` is on (`server/index.ts` sets it to 1 for the deployed reverse proxy, so behind the proxy it is trusted, and then only the LAST entry, the one the proxy wrote, is read); `attachRealtime(server, { trustProxy })` carries the setting. RESOLVED (FF4, R51, N41): was "still open: a per-event users read and a UNION per 200 sockets": eligible users are cached for at most 1 s and one visibility query runs per event. ALREADY FIXED (N42): `secureAuth.ts` was deleted in FU2.
- Task 15: RESOLVED (FF4, R44, N43; was NOT FIXED, by decision): the DNS-rebinding window. The webhook connection is now pinned to the checked address (`https.request` with a custom lookup that validates every resolved address; no new dependency), and Teams webhooks are off by default (R84). Was: the host allow-list (`*.webhook.office.com`) is the control; pinning the checked address needs an undici dispatcher, i.e. a new dependency, which this plan does not add (R44 pins it with `https.request` and no dependency). RESOLVED (FU4, then FF4 R51): fan-out resolves access for all candidate owners in one set-based query and posts at most 5 webhooks at a time (`WEBHOOK_CONCURRENCY`, an in-house limiter). RESOLVED (FF2, R61, N44; was still open): `storage.createTeam` inserts only the team and `POST /api/teams` adds the creator as team admin in the same transaction. ALREADY FIXED (N45; was still open): team routes answer through `fail()` with an `error` code.
- Task 16: RESOLVED (FF3, R65, N46): an inbound `From` whose display name is exactly its address is accepted; every other `@` in a display name and every backslash is still refused. RESOLVED (FF3, R46, N47 and N48): the done mark is written in the same transaction as the ticket or comment, and a fenced-out holder rolls back and answers 503 `in_progress`. Was: display names containing `@` or a backslash are refused (safe direction); a fenced-out late holder only logs. Was: NOT FIXED, by decision: the done mark stays a separate statement from the create; sharing a transaction means threading `tx` through the ticket-number counter and the one-retry-on-number-clash in `createTask` (a unique violation aborts a transaction, so the retry needs savepoints). That is exactly what R46 did: `tx` is threaded through numbering, history and comments, the retry runs on a SAVEPOINT, and the claim fence stays as the guard against a second holder. RESOLVED (FF3, R52, N49): the header cap is `INBOUND_EMAIL_MAX_HEADER_BYTES` (default 65536, maximum 262144); check real Received or ARC sizes after deploy. Was: the 64 KB header cap stays as a documented limit.

### Security hardening and deployment
RESOLVED (FU2): `sanitizeForSQL` and `sanitizeText` are deleted. 404s without an error code were
handled with the Task 7 and Task 17 contract work.
- FU5: the built server (`node dist/index.js`, so `npm start`) now refuses to boot with one log line when `NODE_ENV` is unset (`npm run dev` through tsx still defaults to development; `npm start` needs `NODE_ENV=production`); the request sanitiser now walks iteratively with no depth limit (still linear).
- Task 13: ALREADY FIXED (N50): the built server refuses to boot with `NODE_ENV` unset (`bootGuard.ts`, now deciding by its own module path, FF5 R54, and proven on the built bundle by a gate step, R67); `npm run dev` is development by design. Was: `NODE_ENV` unset in other entry points means development mode; a subtree deeper than 20 (fixed by FU5, above); `sanitizeForSQL` and `sanitizeText` are dead; existing 404s lack an error code (to Task 17).

### MCP
- Tasks 21 and 22: the MCP list limit stays at 100 versus REST 500, on purpose (FU4): the caller is a model, 500 full tickets in one tool result fills its context, each row costs a `getTask`, and `hasMore`/`offset` make paging cheap (reason in `ticketService.ts`). RESOLVED (FU4): the invented-status test asserts exactly `VALIDATION`; the isolation suite's secret-scan test makes its own calls and no longer depends on test order; a non-numeric id (`"abc"`, `1.5`) gives a coded `VALIDATION` with `fieldErrors.id`. Closed in the final round: `"12"` (a numeric string) is accepted as the number 12, and a non-numeric `limit` or `offset` gives the coded `VALIDATION` instead of an SDK plain-text error: RESOLVED (FF2, R47, N38 and N52); the `id`, `limit` and `offset` schemas are `z.unknown()` so every bad value (null, true, an array, an object, a number above int4) reaches the handler and gets the same coded error (FFZ). DECIDED (R74, N26): `get_ticket` FORBIDDEN discloses existence (REST parity). DECIDED (R52, N51): the MCP list limit stays 100.

## 6. Follow-ups round (2026-10-03)

The queued follow-ups from section 5 were worked in seven tasks (FU0 to FU7) and merged on top of
the fix program. Tests: about 1,590 Jest tests (FU6 counted 1,586 passed, 6 skipped); the Playwright
suite (7 specs) runs in the gate and makes no outbound calls.

### The DC4 gate

`scripts/ai/verify.sh` (documented in `docs/gate.md`) is the acceptance gate: in throwaway
containers it builds the production bundle, applies the migrations, runs the full Jest suite and
the Playwright suite against their own databases, probes a running app (login, ticket workflow,
error contract) and prints `TESTS[<nonce>]: <n> passed, <m> skipped` then `RESULT: PASS` or `FAIL`.
Allow **about 20 minutes** (image build, two `npm ci`, Jest in a container, Playwright). It must see
a valid Jest JSON report with `numPassedTests > 0` and `numFailedTests === 0`; secrets are
generated per run, and `.env*` files are not copied into the test tree (FU7). Its Docker files live
in `docker/gate/` and never replace the production `Dockerfile` and `docker-compose.yml` (R39).

### Rulings

- **R36:** emailed tickets and unassigned customer tickets (no user or team assignee, department
  only included) are queued to `DEFAULT_TRIAGE_TEAM_ID`; unset keeps admin triage; a deleted team
  means the ticket is created unassigned.
- **R37:** whitespace and line-ending churn items are not changed.
- **R38:** a requirement whose endpoint was deliberately not ported or has no client (I8, K8, G3)
  is closed as superseded with the reason; the real replacement path is tested; no dead endpoint is
  re-added.
- **R39:** the gate's Docker files stay under `docker/gate/`; `scripts/ai/verify.sh` stays at its
  path and is adapted to Node 24, `APP_BASE_URL`, `db:migrate-sql` and Playwright 1.63.
- **R40:** `GET /api/departments` answers every signed-in user: admins full rows, managers their
  active departments, agents and customers `[{id, name}]` of active departments only (the G5
  requirement); anonymous is 401.

### Behaviour changes users and admins will notice

Accounts and sign-in
- Change-password counts wrong current passwords toward the lockout (423 `account_locked` when
  locked); forgot, reset and change-password each have their own rate-limit budget.
- A revoked session's cookie is cleared; a password change revokes sessions that verified an older
  row, including a login racing the change. Sessions created before the deploy keep the old rule.
- The forced password-change screen signs out and returns to the home page like the header menu.
- `POST /api/admin/users/:id/toggle-status` now keeps at least one active administrator and
  refuses self-deactivation (409 `last_admin`, `self_demotion`); it had no check. The flip is
  decided inside the locked transaction, so two simultaneous toggles flip twice.
- Admin password resets are logged with the admin's user id, not "anonymous".
- AWS SES: a blank secret for a key id that is not the server's own is refused with `fieldErrors`,
  and at send time a stored key id without a secret, or a stored secret without a key id, is never
  paired with the server's own credentials (the send is refused with one log line).

Tickets, lists and stats
- Customer tickets with no assignee are queued to the triage team when `DEFAULT_TRIAGE_TEAM_ID` is
  set, so its members can open them; staff-created tickets are not triaged.
- An invalid routing choice on a customer ticket is refused before any attachment is uploaded.
- Ticket lists are much faster (REST 79 to 3 statements per page of 25, MCP 27 to 2). A second
  ticket-number clash answers 409 `conflict` ("please try again") instead of a raw 500.
- Team and department stats: `highPriority` counts `high` only, with a new `urgent` field and an
  `onHold` count; legacy `user` role gets agent stats.
- `GET /api/teams/:id` is 403 for customers. `GET /api/faq-cache` clamps `limit` to 1..100.
- Duplicate department name is 409, deleting a department with teams is 409
  `department_has_teams`, an unknown id is 404 (were 500s).
- Knowledge ratings map a 1-5 rating onto a 0..1 score (a thumbs-up had scored 275%); a missing
  rating or `wasHelpful` is 400. The AI connection test no longer reports success when it failed.
- Company branding validates name and colour, and a logo replace uploads before deleting the old
  object. Escalation rule bodies are validated (an incomplete body was a 500).
- AI: a comment written but not marked applied is retried and not duplicated on a later apply;
  `ticketsResolvedByAI` counts from the time the response was applied.

Realtime, integrations
- Approving a user or accepting an invitation reconnects open sockets with the new rights.
  WebSocket `x-forwarded-host` is trusted only behind `trust proxy` (the deployed proxy), last
  entry only. **The reverse proxy must forward the host** (nginx: `X-Forwarded-Host $http_host`)
  or the browser's `/ws` origin check refuses the socket.
- Teams webhooks fan out at most 5 at a time; MCP-created and updated tickets carry the
  `APP_BASE_URL` link in Teams cards.
- MCP tools answer a non-numeric id with a coded VALIDATION error.

Deployment
- The built server refuses to start with `NODE_ENV` unset; production refuses placeholder or
  short (under 32 characters) `SESSION_SECRET` and `JWT_SECRET`.
- The ticket prefix is validated only when a request changes it; a legacy prefix over 6
  characters no longer blocks saving the other Tickets settings.
- A deeply nested request body is sanitised iteratively (no depth cutoff).
- `pg` is a runtime dependency.

### New and changed environment

| Variable | Change |
|---|---|
| `DEFAULT_TRIAGE_TEAM_ID` | New, optional (R36). Compose passes it through. |
| `SESSION_SECRET`, `JWT_SECRET` | At least 32 characters and not a placeholder, or production refuses to start. |
| `COOKIE_SECURE` | Set `true` behind HTTPS; the cookie is `Secure` only then. |
| `NODE_ENV` | Required for the built server (`node dist/index.js`, `npm start`); the Dockerfile sets `production`. |

### Migration

`0020_users_is_active_not_null.sql` makes `users.is_active` `NOT NULL DEFAULT true`. Existing NULL
rows become `false` (inactive, as they already behaved), never `true`. It runs in
`npm run db:migrate-sql`, is idempotent, and takes a brief lock on `users`.

### Deploy checks

1. **Secrets in Coolify.** `SESSION_SECRET` and `JWT_SECRET` must each be at least 32 characters
   and not an example value (`your-...`, `change-me`, `dev-only-...`). A shorter or placeholder
   secret stops the container at boot. Check before deploying.
2. **`is_active` NULL rows.** Before deploying, `SELECT id, email FROM users WHERE is_active IS
   NULL;` lists the accounts that become inactive. Re-activate any that should work after the
   deploy (or set them `true` first).
3. `COOKIE_SECURE=true` and `NODE_ENV=production` are present; the proxy forwards
   `X-Forwarded-Host` for `/ws`.
4. Optionally set `DEFAULT_TRIAGE_TEAM_ID` to the intake team.
5. Verify the deployed commit (Coolify's deployment record), not a bundle hash.

### Closed in the final round

Every entry of the former "Left open on purpose" list, with its verdict (section 7 has the detail):

- DNS-rebinding window on Teams webhooks: RESOLVED (FF4, R44). The connection is pinned to the
  address that was checked, with `https.request` and a custom lookup; no new dependency. Teams
  webhooks are also off by default (R84).
- The 64 KB inbound header cap: RESOLVED (FF3, R52). `INBOUND_EMAIL_MAX_HEADER_BYTES`, default
  65536, maximum 262144.
- The inbound done mark as a separate statement from the ticket create: RESOLVED (FF3, R46). One
  transaction, the number retry on a SAVEPOINT.
- Manager stats exclude the manager's own created or assigned tickets: RESOLVED (FF2, R45).
- `phone` visible to every agent: RESOLVED (FF1, R41). SSO sign-ups default to the customer role:
  RESOLVED (FF1, R42), configurable with `SSO_DEFAULT_ROLE`.
- `invitation.departmentId` never applied: RESOLVED (FF1, R43). The department is removed.
- Duplicate email on register stays 400 `email_registered`: DECIDED (binding contract).
- Team detail for staff does not apply the `/members` agent and manager-department rules:
  DECIDED (R78). It is directory data; the member list keeps the narrower rule.
- Per-instance lockout counters, clock skew across instances, and the changer's in-flight request
  (fails closed): DECIDED (R70). One container runs in production; a shared store needs Redis.
  The lockout counter itself now decays: RESOLVED (FF1, R53).
- MCP list limit 100 versus REST 500: DECIDED (R52), on purpose.

## 7. Final follow-ups round (2026-10-03)

The last round closed every open line of sections 5 and 6 (117 items: 58 fixed, 45 decided by a
ruling, 14 already fixed and verified; the plan's item ledger,
`docs/superpowers/plans/2026-10-03-ticketflow-followups-final.md`, lists each with its verdict).
It was worked in six parallel tasks (FF1 accounts, SSO and email providers; FF2 tickets, stats,
MCP, teams and error logging; FF3 AI analytics and inbound email; FF4 realtime, Teams webhooks,
proxy and limits; FF5 schema push, deploy image and gate; FF6 requirement-caveat coverage), merged
and then finished by one batch of review minors (FFZ). Migrations 0021 and 0022 are new; there is
no 0023 (FF5 fixed the push loop in `shared/schema.ts` alone).

### Rulings R41 to R84

| Ruling | One line |
|---|---|
| R41 | Phone is visible to admins, managers and the user themself; agents and customers never see another user's phone. |
| R42 | SSO sign-ups take `SSO_DEFAULT_ROLE` (`customer` or `agent`, default `customer`), set only when the account is created and still pending approval; an invalid value is logged and reads as `customer`. |
| R43 | The invitation department is removed from the API (a body field is ignored), the UI and the email; the column stays unwritten. |
| R44 | Teams webhooks are sent through `https.request` with a custom lookup that validates every resolved address and pins the connection; no new dependency. |
| R45 | Manager stats include the tickets the manager created or is assigned (the `/api/stats` visibility), plus a personal block. |
| R46 | The inbound done mark is written in the same transaction as the ticket or comment; the ticket-number retry uses a SAVEPOINT. |
| R47 | MCP ids accept numeric strings; non-numeric values stay a coded VALIDATION; `limit` and `offset` coerce numeric strings or answer VALIDATION. |
| R48 | `ticket_auto_responses.applied_at` (migration 0021) is set on apply; analytics use it and fall back to the old rule for legacy rows. |
| R49 | `TRUST_PROXY_HOPS` (integer 0 to 10, default 1; anything else logs one line and uses 1) sets Express `trust proxy` in one place (2 only with Traefik AND nginx in front, 1 for nginx alone or Traefik alone, 0 with nothing in front). |
| R50 | `drizzle-kit push` is idempotent (`unique_team_admin` in table column order, the `'{}'` array defaults removed); proven by two pushes in a scratch database. |
| R51 | Realtime caches eligible users for at most 1 s and runs one visibility query per event; correctness tests stay. |
| R52 | The general `/api` limit default is 600 per 15 minutes; `INBOUND_EMAIL_MAX_HEADER_BYTES` (default 65536, max 262144); the MCP list limit stays 100 (decided). |
| R53 | The login failure counter restarts once the lockout window has passed since the last failure (`users.last_failed_login_at`, migration 0022). |
| R54 | The gate gets generated JWT and session secrets; the no-egress bracket-strip regex and its empty, unparsable, portless and IPv6 tests; the `split2` dev flag verified; `bootGuard` decides by its module path. |
| R55 | `setupAuth` tracks every session store and `closeAuth` closes them all. |
| R56 | The security access log and the default custom-limiter key read the session user's id. **Latent only:** `securityAuditLog` and `createCustomRateLimit` are not mounted in production, so no deployment's behaviour changes (see below). |
| R57 | The placeholder-secret test derives its samples from the repository's tracked files. |
| R58 | Unimplemented email providers (SMTP, Mailgun, SendGrid, Custom) cannot be selected (400 `provider_not_supported`, UI unavailable); implementing one needs a new dependency. |
| R59 | `storage.getTasks` is deleted (tests only); the detail query's `lastUpdatedBy` matches the list for missing users. |
| R60 | MCP write audits record the request IP; the channel stays `mcp`. |
| R61 | `storage.createTeam` inserts only the team; `POST /api/teams` adds the creator's membership in the same transaction. |
| R62 | The dead, unlocked `storage.toggleUserStatus` is deleted. |
| R63 | Service and storage code logs a caught error by type and code only; a sweep test enforces it outside seeders and the startup handler. |
| R64 | `autoResponseCommentExists` filters in SQL with bound parameters. |
| R65 | An inbound `From` whose display name equals its address is accepted; every other `@` and every backslash is still refused. |
| R66 | The production Dockerfile `CMD` runs `db:migrate-sql`, `db:push`, then the server, like compose; a test keeps them identical. |
| R67 | The `bootGuard` wiring is proven on the built bundle by a gate step (`NODE_ENV` empty, cwd `/`). |
| R68 | Every requirement caveat with an API subject gets a test; approve of an unknown id becomes 404; `/api-docs` gains get, comment and delete. |
| R69 | Startup stays fail-fast (transient database errors restart the container); a system-user email clash is left to the owner. |
| R70 | Session residuals stay (in-flight request and pre-`pwdAt` clock skew fail closed; counters are per process, single container, a shared store needs Redis). |
| R71 | `--runInBand` stays global (shared test database). |
| R72 | An `ADMIN_EMAIL` owned by a non-admin is only logged; startup never promotes an account. |
| R73 | Refusing a real secret that starts with `todo` or `example` is accepted (safe direction). |
| R74 | 403 outside scope and 404 for a missing ticket stay (documented contract, REST and MCP). |
| R75 | A malformed id is 400 before 401. |
| R76 | PATCH `assigneeId: ""` stays absent and `null` clears (the modal sends `""` for untouched fields). |
| R77 | The triaged create keeps its one primary-key lookup of the triage team. |
| R78 | `GET /api/teams/:id` stays readable by all staff; the member list keeps the narrower rule. |
| R79 | Legacy non-admin Teams webhook rows keep delivering by ticket access; cleanup is an owner action with the query below. |
| R80 | The lockfile resync dropped never-declared packages; nothing to restore. |
| R81 | Requirement caveats about UI page renders are closed (owner decision 2026-10-02: e2e covers core flows only). |
| R82 | Requirement caveats about live SES, Entra, Bedrock, S3 and Teams are closed as external; the application side is tested with fakes. |
| R83 | Requirement caveats that restate a binding contract stay (bare-array list, M4 429, no `requestId`, key-only MCP, inert rules, `COOKIE_SECURE`, ratings without a client). |
| R84 | **Owner decision 2026-10-03: Teams webhooks are disabled by default.** Set `TEAMS_WEBHOOKS_ENABLED=true` to keep them. While off, ticket events send nothing, the test route answers 503 and saving the settings answers 409 `teams_webhooks_disabled`. The code, including the R44 DNS pin, is kept. |

### Behaviour changes users and admins will notice

Accounts, sign-in and invitations (FF1)
- Agents no longer see another user's phone number anywhere (lists, team members and admins,
  assignments, comments, history, MCP comments). Admins, managers and the user themself still do;
  customers never do.
- Invitations have no department: the field is gone from the form, the card, the API (a body
  field is ignored, 201 not 400), the responses and both emails. The default `user_invitation`
  email no longer prints a "Department:" line. A stored template that still equals the OLD default
  exactly is rewritten to the new default at startup (best effort, idempotent); an admin-edited
  template is never touched, and an edited one that still has `{{department}}` renders it empty.
- The login failure counter restarts after 15 minutes without a failure (migration 0022).
- New SSO accounts take `SSO_DEFAULT_ROLE` and wait for approval; a later sign-in never changes an
  existing account's role or approval.
- SMTP, Mailgun, SendGrid and Custom cannot be saved as the email provider (400
  `provider_not_supported`); the settings page shows them disabled. A row already stored still
  reads back and logs "not implemented" when used. Invitation emails sent through such a provider
  log one line instead of failing silently.
- `POST /api/admin/users/:id/approve` for an unknown id is 404 `user_not_found` (it was 200 with an
  empty body).
- `closeAuth` closes every session store (no pool leak on shutdown or in tests).

Tickets, stats, MCP and teams (FF2)
- `GET /api/stats/manager` returns `totalTickets` and a `personal` block (`assignedToMe`,
  `createdByMe`), and its priority and category blocks cover the manager's `/api/stats` scope
  (created, assigned, department). `department` and `teamPerformance` are unchanged.
- A ticket detail's `lastUpdatedBy` agrees with the list for a deleted user (no "Support agent").
- MCP: `"12"` is accepted as the id 12 and `"10"` as a `limit`; every other bad `id`, `limit` or
  `offset` (null, true, an array, an object, "abc", 0, a number above 2147483647) answers the coded
  `VALIDATION` with the field in `fieldErrors`, never an SDK plain-text error. MCP audit lines
  carry the caller's IP.
- `POST /api/teams` enrols the creator as team admin in the same transaction as the team (R61).
  `storage.createTeam` alone no longer enrols anyone.
- Error logs for S3, logo, AI settings, auth, system-user failures and the WebSocket
  (`WS send error`, `WS notify ticket error`, `WS notify staff error`, `WebSocket auth error`) show
  the error type only, never its text. The sweep test that enforces this now also catches callback
  parameters of any name (`arg0`), `.message` and `.stack` in a ternary or template literal,
  shorthand objects and `const` or `let` shortcut variables.
- A numeric route id above 2147483647 (the int4 range) is 400 `invalid_id` instead of a database
  error and a 500.

AI analytics and inbound email (FF3)
- "Tickets resolved by AI" no longer over-counts a draft that was applied after the ticket was
  resolved: it counts from `ticket_auto_responses.applied_at` (migration 0021). Rows applied before
  the column existed keep the old rule.
- An emailed ticket or reply and its done mark are one transaction: a crash between them no longer
  leaves a ticket that is mailed again as a duplicate. A fenced-out attempt rolls back and answers
  503 `in_progress` (Retry-After 20) instead of 200.
- A sender whose display name is its own address (`"a@b.com" <a@b.com>`) is accepted.
- The inbound header cap is `INBOUND_EMAIL_MAX_HEADER_BYTES` (default 65536).
- The database pool has a 10 s connection timeout and an optional `PG_POOL_MAX` (default 10), so a
  starved pool fails loudly instead of hanging.

Realtime, Teams, proxy and limits (FF4)
- **Teams webhooks send nothing after this deploy until `TEAMS_WEBHOOKS_ENABLED=true` is set** (R84).
  The admin screen shows an "off" notice and disables Save and Send Test.
- Webhook delivery is pinned to the address that was checked (no DNS-rebinding window).
- The general `/api` limit default is 600 per 15 minutes (was 100).
- The realtime layer caches eligible users for at most 1 s (a raw database change to a role or
  state can lag a socket by up to 1 s; changes made through the app disconnect at once) and runs one
  visibility query per event instead of one per user.
- The proxy depth is configurable (`TRUST_PROXY_HOPS`).
- R56 is a latent fix, not a live behaviour change: `securityAuditLog` (the SECURITY_ACCESS and
  SECURITY_RESPONSE lines) and `createCustomRateLimit` are exported but not mounted by
  `applySecurity`, so no deployment writes those lines or uses that limiter. They now read the
  session user's id (`id`, falling back to `userId`), and a unit test pins it. If either is ever
  mounted, mount it after passport (a request-start line has no user before passport runs) and
  test it through `createTestApp`.

Schema push, image and gate (FF5, FFZ)
- **The first `drizzle-kit push` after this deploy drops the database DEFAULT on three array
  columns** (`api_keys.permissions`, `email_templates.variables`,
  `teams_integration_settings.notification_types`). Existing data is untouched and application
  inserts still write `[]`; only raw SQL inserts that omit those columns now get NULL, which every
  reader treats as empty (a key with NULL permissions is refused by MCP with 403 and listed with
  `[]`). The second push reports no changes.
- The Dockerfile `CMD` runs `db:migrate-sql`, `db:push`, then `exec node dist/index.js` (node is
  PID 1 and receives `docker stop`'s SIGTERM), the same as compose. The server now handles SIGTERM
  and SIGINT (`server/shutdown.ts`): it closes the WebSockets, stops the HTTP server, closes the
  session stores and the database pool, and exits 0; a step that fails is logged by type and the
  exit code is 1; a hard timer exits 1 after 10 s if anything hangs. Without a handler a PID-1
  node ignores the signal and the container is killed after the grace period.
- The gate no longer warns about an insecure development JWT secret, and a gate step proves the
  built bundle refuses to start with `NODE_ENV` empty from any working directory.
- The R50 push-idempotence test builds its own database state, so it passes alone or in order.

Requirement-caveat defects found and fixed (FF6)
- An upload over `MAX_FILE_UPLOAD_SIZE_MB` (default 50) is 413 `payload_too_large` (it was a 500).
- Deleting an unknown knowledge article is 404 `not_found` (it was 200).
- Resending a cancelled invitation is 400 (it mailed a dead link).
- The daily AI usage window is a UTC calendar day (west of UTC, today's usage read as 0 and the
  daily cap never counted it; a regression test now runs `getDailyUsage` in a Los Angeles
  time zone).
- `/api-docs` lists get, add comment and delete as well as list, create and update.
- New tests cover A1, A5, A9, S1, Y1, Y5, Y7, Y8, T15 (size), I1, I7, I9, K1, K5, K6, E2, E3, G1,
  G4, G7, D2 and P2; `docs/dc4-validation-2026-10-01/requirements-status-after-fixes.md` names them.

### Known residuals (open, deliberately not fixed in this round)

- `PUT /api/admin/help/:id`, `DELETE /api/admin/help/:id` and the company-policy toggle still answer
  200 (or a 500 from the update) for an unknown id, and the help-document update passes the request
  body straight to `updateHelpDocument`. FF6 found it while covering K5 and K6; it was not in any
  ledger item. The knowledge-article delete (K1) was fixed; these were not.
- C15 (requirement I7): the ledger named `/api/bedrock/usage/summary`, which does not exist (no
  route, no client). FF6 tested the routes that do exist, `/api/bedrock/cost-statistics` and
  `/api/bedrock/usage`, and found and fixed the UTC-window defect through them. Aliasing the old
  path is an owner decision.
- No red-first evidence exists for two tests because the sandbox classifier refused the mutation
  runs: the R84 off-by-default tests (`teamsWebhook.test.ts`) and the R51 epoch-invalidation test
  (`realtime.cache.test.ts`, the guard for a demoted user reconnecting within the 1 s cache window).
  Both pass against the real code and read correctly; neither was shown to fail with its guard
  removed.
- Runtime signals: the SIGTERM handler is proven by a unit test of the shutdown function with
  fakes; no test sends a real signal to a built container (a Windows host cannot deliver one).

### New and changed environment

| Variable | Default | Change |
|---|---|---|
| `SSO_DEFAULT_ROLE` | `customer` | New (R42). `customer` or `agent`; anything else (`admin` included) is logged once and reads as `customer`. Compose passes it through with no value. |
| `TRUST_PROXY_HOPS` | `1` | New (R49). Integer 0 to 10; a value above 10, junk or a negative number logs one line and uses 1. Set it to the number of proxies actually in front: **`2` only with Traefik AND nginx**, `1` with nginx alone (the compose file's nginx) or Traefik alone (a Dockerfile-only deploy on Coolify), `0` with nothing in front. |
| `INBOUND_EMAIL_MAX_HEADER_BYTES` | `65536` | New (R52). 1 to 262144; junk or out of range logs one line and uses the default. |
| `PG_POOL_MAX` | `10` | New. Database pool size; a wait for a connection fails after 10 s. |
| `RATE_LIMIT_MAX_REQUESTS` | `600` | Default raised from 100 (R52). |
| `TEAMS_WEBHOOKS_ENABLED` | off | New (R84). Must be exactly `true`; **set it in Coolify to keep Teams webhooks.** |

All six are passed through by `docker-compose.yml` and listed in `.env.example` and `env.example`;
README and DEVELOPER_DOCUMENTATION have the table. A variable that does not reach the container
has no effect, so check Coolify holds each one you want.

### Migrations

- `0021_ticket_auto_responses_applied_at.sql`: `ticket_auto_responses.applied_at timestamp`, no
  backfill (R48).
- `0022_users_last_failed_login.sql`: `users.last_failed_login_at timestamp` (R53).
- There is no 0023: the push loop (R50) is fixed in `shared/schema.ts` alone.

Both are idempotent, run in `npm run db:migrate-sql`, and are in the startup schema check, so the
server refuses to boot if either column is missing. R50 re-proof on a scratch database with the
merged schema: `db:migrate-sql` on the empty database (`fresh database ... nothing to apply`),
`drizzle-kit push` (`[✓] Changes applied`), `db:migrate-sql` again (`applied 0021_...`, `applied
0022_...`, `done, 12 applied, 1 not run`), then two pushes: both `[i] No changes detected`.

### Deploy checks

1. Set the new environment in Coolify. **`TRUST_PROXY_HOPS` must equal the number of proxies in
   front of the app:** `2` only when Traefik AND nginx are both in front (the compose file's nginx
   behind Coolify/Traefik); `1` for nginx alone, or for a Dockerfile-only deploy where only Traefik
   is in front; `0` for a Dockerfile-only deploy with nothing in front. Too high a number lets a
   client choose its own address through `X-Forwarded-For` (the per-IP limits and the audit IP can
   then be spoofed); too low makes every client look like the proxy. Also set
   **`TEAMS_WEBHOOKS_ENABLED=true`** if Teams webhooks must keep working. Optionally `SSO_DEFAULT_ROLE`, `INBOUND_EMAIL_MAX_HEADER_BYTES`
   and `PG_POOL_MAX`.
2. The drift check (section 1) now has `last_failed_login_at` in its users column list and a third
   query for `ticket_auto_responses` (with `applied_at`). All three lists must be empty.
3. The Dockerfile `CMD` now runs the schema steps itself, so a Dockerfile-only deploy migrates.
   After the deploy the log shows `sql-migrations: done, 12 applied, 1 not run` and push's
   `[✓] Changes applied` (the first push after this deploy drops the three array defaults, see
   above), and no `Startup refused`.
4. R79: list the legacy Teams webhook rows owned by non-admins (they still deliver by ticket
   access, and with `TEAMS_WEBHOOKS_ENABLED=true` they keep doing so until cleaned up):

   ```sql
   SELECT s.user_id, u.role, s.enabled
   FROM teams_integration_settings s JOIN users u ON u.id = s.user_id
   WHERE u.role <> 'admin' AND s.webhook_url IS NOT NULL;
   ```

   To switch them off (keeps the rows):

   ```sql
   UPDATE teams_integration_settings SET enabled = false WHERE user_id IN (...);
   ```
5. `server/__tests__/fixtures/webhook/key.pem` (and `cert.pem`) is a throwaway self-signed key and
   certificate for the local HTTPS test server. It is not a secret and protects nothing; a secret
   scanner may flag it, and it is safe to allow-list.
6. Check the hop count from the outside: send a request with a made-up `X-Forwarded-For: 203.0.113.9`
   and confirm the app does not log that address as the client (with the right count it logs the
   address your proxies saw). With the default of 1 behind two proxies every client appears as the
   inner proxy.
7. Verify the deployed commit through Coolify's deployment record, not a bundle hash.

## 8. MCP documents (2026-10-05)

An uploaded help document (the DoseSpot configuration `.docx`) was invisible to MCP: its text was
only in `file_data` (base64), nothing extracted it, and no MCP tool read help documents, policies
or guidelines. Task MCP4 adds document search, reading and writing on MCP (rulings R89 to R92,
`DEVELOPER_DOCUMENTATION.md`, MCP Server).

- **Migration 0030** (`0030_document_extracted_text.sql`) adds a nullable `extracted_text` text
  column to `help_documents` and `company_policies`. Idempotent (`ADD COLUMN IF NOT EXISTS`), it
  never aborts (a missing table is a NOTICE), and both columns are in the startup schema check, so
  the server refuses to boot without them. Numbered 0030 because 0023 is held by an open branch;
  the SQL runner applies files in name order and tolerates the gap (0014 is already followed by 0018).
- **Two new runtime dependencies**, pinned: `mammoth` 1.13.0 (`.docx` text) and `unpdf` 1.8.1
  (`.pdf` text; the serverless PDF.js build, pure JavaScript, no dependencies and no native code).
  `.txt` and `.md` are read as UTF-8. Anything else, or a file that does not parse, stores `''`
  ("tried, nothing extractable"; NULL means "never tried") and logs the error type only. Text is
  capped at 1,000,000 characters.
- **Extraction runs in a bounded worker thread** (fix round 1, review I1: before it, a 388 KB
  `.docx` could abort the whole server out of memory). `npm run build` now also writes
  `dist/documentExtractWorker.mjs`, which the server loads from next to `dist/index.js`. Limits:
  256 MB of worker heap (`DOCUMENT_EXTRACT_MAX_MB` to change it), 20 s, two parses at a time; a
  `.docx` declaring more than 50 MB (or more than 10 MB at a compression ratio above 100) and a
  `.pdf` over 500 pages are refused. An out-of-memory or timeout ends only the worker. Nothing a
  parser prints reaches the log.
- **Extraction on write.** REST `POST`/`PUT /api/admin/help` and `POST`/`PUT
  /api/admin/company-policies` and the MCP write tools fill `extracted_text` through one helper;
  `extracted_text` in a request body is ignored. `GET /api/help/search` now also matches the file
  text.
- **Backfill after start.** Rows with `extracted_text` NULL and a file get their text once the
  server is listening (after `serving on port`), one row at a time, not awaited: it never delays
  or fails boot. Each row is marked (its text, or `''`), so a bad file is tried once, not at every
  start. One log line: `Document text backfill: help documents N filled, N unsupported, N
  unreadable; policies ...`. The local DoseSpot `.docx` (2 MB) extracts in about 0.2 s. Proven on
  the built server with a zip-bomb `.docx` and an inflating `.pdf` row under `--max-old-space-size=768`:
  it served, marked both rows, filled the real ones, and the next boot read none of them again.
- **Search by keywords** (fix round 1, review I2): `search_documents` matches the query's key
  words separately (any of them), so "How do I set the DoseSpot clinic key?" finds the document;
  results matching more words come first.
- **Policy downloads** answer any file name (an ASCII `filename` plus an RFC 5987 `filename*`);
  a name outside Latin-1 used to answer 500.
- **R94:** MCP may create a policy from text alone (REST requires a file).
- **New MCP tools (31 in all):** `search_documents`, `get_document`, `list_guideline_categories`,
  and `create_`/`update_` for help documents, policies, guidelines and knowledge articles
  (`update_*` also publishes and unpublishes). Writes are admin only, as REST; delete stays UI-only.
  Every tool still rides on the key's `mcp:tickets` permission.
- **Server instructions:** `initialize` now returns `instructions` asking the model to search the
  documents before answering how-to, setup and policy questions, quote the title, and say when
  nothing is found.

### Deploy checks

1. After the deploy the log shows `applied 0030_document_extracted_text.sql`, `serving on port`,
   then the backfill line. For the local stack the DoseSpot document should count as `1 filled`.
   A line `Document text backfill skipped: the extraction worker file was not found` means the
   image lacks `dist/documentExtractWorker.mjs` (an old build command): rebuild.
2. Ask an agent connected over MCP a DoseSpot setup question and check that it calls
   `search_documents`, cites "Dosespot Configuration Document" and answers from it (an MCP tool
   change is verified by asking the agent, not by a connection test).
