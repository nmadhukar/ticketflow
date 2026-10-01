# TicketFlow validate: merged gap list, 2026-10-01

**Role:** synthesis. **Design:** [ticketflow-requirements.md](ticketflow-requirements.md) (87 IDs).
**Inputs:** [map](ticketflow-validate-map-2026-10-01.md) (static, untrusted), [runtime](ticketflow-validate-runtime-2026-10-01.md) with its saved [probe transcript](ticketflow-runtime-probe-output-2026-10-01.txt) and [builder gate transcript](ticketflow-verify-output-2026-10-01.txt), [cold review](ticketflow-validate-review-2026-10-01.md), [challenger](ticketflow-validate-challenge-2026-10-01.md), and the independent gate run `/home/agent/evidence/nmadhukar/ticketflow/20261001T193507Z-4773e8.{json,log,diff}`.
**Repository state:** `nmadhukar/ticketflow`, branch `dc4/gate` @ `e1de508`. This branch adds 4 harness files to `main` @ `15621d1` (`Dockerfile`, `docker-compose.yml`, `docker/db.ts`, `scripts/ai/verify.sh`), so the product code is the same as `main`.

## Gate verdict today: FAIL

Run `20261001T193507Z-4773e8` (runner `gates/5`): exit 1, `PASS: 8 / FAIL: 7`, `TESTS[515db053…]: 0 passed, 0 skipped`, `RESULT: FAIL`. Locks: "all locked files match their approved hashes".

| Gate step | Result | Cause (gate log line) | Kind |
|---|---|---|---|
| Stack, Postgres, schema push, health, UI | PASS | 819-839 | — |
| Workflow probe | FAIL | 849: documented create returns `400 ticketNumber Required` (T1). 850: `resolvedAt not stamped` (T12). The steps before it passed: assign, My Tasks, comment 201, `in_progress`, `on_hold`. | product |
| Auth/anonymous probe | PASS | 852-853 | — |
| `npm ci`, lint, typecheck, all Jest suites, Jest JSON | FAIL, **never executed** | 855-874: `run_node` mounts the `_deps` volume inside the `:ro` source bind, so Docker cannot create `node_modules` in the clean tree (read-only file system) | harness (`verify.sh:50-55`) |
| Browser e2e | FAIL | 891-906: `no e2e script in package.json` | repository |

The builder's own run of the same commit got past `npm ci` and showed the repository failures behind the harness defect: `Missing script: "lint"`, 353 `error TS` lines (301 outside test files), and `module is not defined in ES module scope` at `jest.config.js:1` (`package.json` has `"type":"module"`). The reviewer and challenger both say the gate FAIL is genuine. They also both say that the gate cannot pass, even with a perfect product, until the harness and the repository's own test setup are fixed. **So Work package 1 is the repository's own failing tests.**

## Evidence rules used in this synthesis

- **CONFIRMED** means one of the following:
  - (a) the challenger re-checked the reviewer's verdict and agreed;
  - (b) the saved runtime artefacts are unambiguous (probe transcript or gate log);
  - (c) every phase that looked at the item agrees;
  - (d) the reviewer gave a code-cited finding that no phase contradicts. The challenger's verdict covers these generally ("the cold review is accurate… slightly conservative").
  
  For key items in (d), I spot-checked the code myself (read-only). These are marked *spot-checked*.
- **DISPUTED** means two phases disagree and no saved artefact settles it, or only one source makes the claim.
- **Runtime evidence labels:** *saved* = present in the probe transcript or gate log. *report-only* = claimed in the runtime report but not in any saved artefact. The reviewer showed that the saved transcript's staff probes all returned 401, because the staff account had not been approved, and I re-confirmed this. So staff-dependent runtime claims are report-only.
- Items marked "(external: X)" in the design, where the code is present but the service is absent, are **NOT-RUNNABLE**, not failures.
- The map's statuses are superseded wherever the review differs (28 IDs). The challenger endorsed the review, and the runtime evidence agrees with it wherever runtime evidence exists.

---

## Final status per requirement

Status: IMPLEMENTED / PARTIAL / STUB / MISSING / DISPUTED. Runtime: RV = verified, RF = failed, NR = not runnable.

| ID | Final status | Runtime | Gap | Evidence the reports agree on |
|---|---|---|---|---|
| A1 | IMPLEMENTED | RV saved | — (security defect F3 filed under G6) | Register 201 `isApproved:false`, pending login 401, duplicate 400 (transcript). `auth.ts:185-305`. |
| A2 | IMPLEMENTED | RV saved | — | Login 200 with httpOnly `connect.sid`, `/api/auth/user` 200 (transcript; gate auth probe PASS). |
| A3 | IMPLEMENTED | RV saved | — | Wrong password 401, anonymous `/api/auth/user` 401 (transcript; gate log 852). |
| A4 | IMPLEMENTED | RV saved | — | Logout 200, old cookie 401 (transcript; gate). The old cookie on `/api/tasks` was not probed separately. |
| A5 | IMPLEMENTED | NR | minor | Toggle/approve `routes.ts:608-638`, login checks `auth.ts:153-159`. Existing sessions are not re-checked for `isActive` (review). |
| A6 | IMPLEMENTED (ext. SES) | NR | hardening (F6) | `auth.ts:386-449`, generic reply, 400 on bad token. The reset token is logged in plain text (`auth.ts:405`) and stored unhashed. |
| A7 | IMPLEMENTED | NR | — | Self-register defaults to `customer` (`auth.ts:266`). Admin can PATCH the role. Login with the manager role was not walked. |
| A8 | **STUB** | NR (code) | **CONFIRMED** | Lockout exists only in the disconnected `security/secureAuth.ts` (`const user = null` at 205). The live LocalStrategy `auth.ts:131-167` does no attempt tracking. Map, review and challenger agree. |
| A9 | **DISPUTED** (ext. Entra) | NR | DISPUTED | `/api/sso/status` 200 `configured:false` (saved). See Disputed D-2. |
| T1 | **PARTIAL (broken)** | RF saved | **CONFIRMED** | 400 `ticketNumber Required` (transcript and gate log 849). `schema.ts:110,321-329`, parsed before storage generates the number (`routes.ts:224-228`). The client form never sends it. Challenger agrees. |
| T2 | **PARTIAL** | RF saved | **CONFIRMED** | An empty title is stored with 201 (transcript, id 3). No `.min(1)` and no enums in `schema.ts:321-329`. A missing title correctly returns 400. |
| T3 | IMPLEMENTED | RV report | minor (F22) | `TKT-2026-0001…3` then `HD-2026-0001`. Concurrent creates race, and the max number is picked lexicographically (`storage.ts:439-467`). |
| T4 | IMPLEMENTED | RV saved | — | Invalid id 400, unknown id 404, own ticket 200. |
| T5 | IMPLEMENTED | API RV, UI NR | — | Bare array 200. Table at `tasks.tsx:325-341` (the map's card/table toggle claim is wrong). Staff scope is filed under Y4. |
| T6 | IMPLEMENTED | API RV saved, UI NR | — | Filters returned matching JSON. `storage.ts:549-559`. |
| T7 | IMPLEMENTED | RV saved | minor | A match is returned and an unmatched word returns `[]`. The match is case-sensitive (`like`, not `ilike`). |
| T8 | IMPLEMENTED | RV report | — | `limit=2`: offset 0 `[4,3]`, offset 2 `[2,1]`. |
| T9 | IMPLEMENTED | RV (gate log) | — | The gate probe's My Tasks assertion passed before it failed at `resolvedAt`. `routes.ts:175-192`. Page not rendered. |
| T10 | **PARTIAL** | RF saved | **CONFIRMED** | Priority `not-valid` accepted with 200 (transcript). A non-numeric id goes to the DB as NaN and returns 500 (`routes.ts:307`). |
| T11 | **PARTIAL** | user RV (gate), team NR | **CONFIRMED** (code) | User assignment works. `assigneeTeamId` is stored but not returned, and teams are joined on `assigneeId` (`storage.ts:495-533`). |
| T12 | **PARTIAL** | RF (gate log 850) | **CONFIRMED** | `updateTask` never stamps `resolvedAt`/`closedAt` (`storage.ts:653-687`). There is no status enum (`schema.ts:114`). Challenger verified. |
| T13 | IMPLEMENTED | report-only | — (gap is T17) | Close and reopen work through the same PATCH, and history rows are written. Review and challenger agree. Runtime marked it FAIL only because there is no history read route. |
| T14 | **DISPUTED** (lean PARTIAL) | create RV (gate) | DISPUTED | Create 201 and list work (gate). Whether empty content is rejected is disputed. See D-1. |
| T15 | **PARTIAL** | RF report-only | **CONFIRMED** (code) | Metadata only. The multer 10 MB limit is not attached to the route (`routes.ts:79-84,801-829`). The client posts a fake `storage.example.com` URL. `DELETE /api/attachments/:id` has no authorisation (`routes.ts:831-840`, spot-checked). |
| T16 | **PARTIAL (broken)** | customer 403 RV saved; admin 500 report-only | **CONFIRMED** | No `onDelete` on `task_history`/`task_comments`/`task_attachments` (`schema.ts:135,144,156`), and every task has a history row, so every delete returns 500. Only customers are blocked (`routes.ts:384-386`). Challenger verified. |
| T17 | **PARTIAL** | RF saved | **CONFIRMED** | `/api/tasks/2/history` returns the Vite HTML fallback (transcript). History is written (`storage.ts:483-488,673-684`) but there is no read route. All phases agree. |
| T18 | IMPLEMENTED | RV saved (partial) | minor | Tags, estimatedHours and dueDate survive create, update and re-read. `actualHours` was not probed. `dueDate:null` cannot clear a date. |
| I1 | IMPLEMENTED (ext. Bedrock) | auto-response `null` RV saved | — | `routes.ts:230-268`: creation survives an AI failure. Scoring needs Bedrock. |
| I2 | **PARTIAL (broken, latent)** | NR | **CONFIRMED** defect; severity DISPUTED (D-3) | The AI comment is inserted with `userId:'system'`, which is a foreign key to `users.id` with no such row (`routes.ts:253-257`, `schema.ts:136`). The error is swallowed. Threshold is hard-coded at 0.7. |
| I3 | **PARTIAL** (ext. Bedrock) | NR | **CONFIRMED** (code); role gate DISPUTED (D-4) | `routes.ts:3553-3603` takes free text, not a ticket id, so "4xx for a missing ticket" cannot happen. |
| I4 | IMPLEMENTED | generic feedback RV report | minor | `/api/ai-feedback` persists and reads back. Task feedback with no auto-response returns 500. |
| I5 | IMPLEMENTED (ext. Bedrock) | NR | — | `routes.ts:1772-2046`. Widget not rendered. |
| I6 | **MISSING** | RF saved | **CONFIRMED** | `/api/admin/ai-settings` returns 200 HTML (transcript). `ai-settings.tsx` calls endpoints that do not exist. Only `/api/ai/status` exists, and it is not admin-gated. |
| I7 | IMPLEMENTED | API RV saved, page NR | — | Both endpoints return JSON counts and costs. |
| I8 | IMPLEMENTED (ext. Bedrock/S3) | NR | — | KB status 200 `configured:false`. Data sources return 500 without AWS. |
| I9 | IMPLEMENTED (ext. Bedrock) | queue RV | hardening (F12) | Non-fatal learning on resolve. `add-to-learning` has no ticket access check. |
| K1 | IMPLEMENTED | create/list/403 RV saved | — | Edit and delete not walked. |
| K2 | IMPLEMENTED | RV report | minor | Unpublished articles are excluded from search. A PATCH with no body does not toggle; it needs `isPublished` in the body. |
| K3 | IMPLEMENTED | API RV saved, page NR | — | `routes.ts:2989-3015`. |
| K4 | IMPLEMENTED | RV report | — | `effectivenessScore` changed to 2.73. |
| K5 | IMPLEMENTED (ext. S3) | NR | access gap filed under Y1 | List, search and read are anonymous (`routes.ts:1384,1395,1411`, spot-checked). |
| K6 | **PARTIAL** | NR | **CONFIRMED** (spot-checked) | Any authenticated user gets inactive policies with `?includeInactive=true` (`routes.ts:2212`). Inactive policies can be downloaded. |
| K7 | IMPLEMENTED | create/list RV saved | minor | Unpublished guides are listed by default. Guide HTML is rendered raw (F15, filed under Y7). |
| K8 | IMPLEMENTED (ext. S3) | anonymous 401 RV saved | hardening (F14) | The caller chooses the S3 folder prefix. |
| E1 | IMPLEMENTED (ext. SES) | NR | hardening | `/api/smtp/test` is real. `/api/email/test` is a stub. `GET /api/smtp/settings` returns the SES secret. |
| E2 | IMPLEMENTED | list RV saved | — | Four templates are seeded. Edit persistence not probed. |
| E3 | IMPLEMENTED (ext. SES) | create RV report | **CONFIRMED** minor | Missing `expiresAt` gives 500 (runtime report and `routes.ts:2737`). Tokens come from `Math.random`. |
| E4 | IMPLEMENTED (ext. Teams) | NR | security (F7) | Any authenticated user can register a webhook that receives every ticket. |
| E5 | **STUB** | NR | **CONFIRMED** | `broadcastToUser`/`broadcastToAll` are never called. The notifications page shows `mockNotifications`. The socket trusts a `userId` the client supplies. Challenger verified. |
| E6 | **MISSING** (ext. SES) | — | **CONFIRMED** | No inbound handler. All phases agree. |
| G1 | **PARTIAL** | staff 201 report-only | **CONFIRMED** (code; all phases) | `routes.ts:497-513` has no role check. A plain user creates a team and becomes its admin. |
| G2 | IMPLEMENTED | API RV report | Y5 leak | `members` returns full user rows (`storage.ts:761`). |
| G3 | IMPLEMENTED | NR | — | Admin-only `routes.ts:541-557`. The role value is not validated. |
| G4 | IMPLEMENTED | assign RV report | — | Remove and `/teams/my` not re-probed. |
| G5 | IMPLEMENTED | create/list RV report | — | Rename and delete not probed. |
| G6 | **PARTIAL** | RF report | **CONFIRMED** | Runtime and review agree that accept only marks the invitation accepted and creates no user. Auto-approval happens only in `register`, matched by email without the token (F3, Critical). Challenger verified F3. |
| G7 | **PARTIAL** | NR | **CONFIRMED** (challenger + spot-check) | Revoke sets `cancelled`, but token GET and accept reject only `accepted` or expired (`routes.ts:2789-2795,2816-2822`). |
| D1 | **PARTIAL** | `/api/stats` RV saved | **CONFIRMED** | The second `.where()` overrides the high-priority filter (`storage.ts:1053-1062`, challenger verified). `on_hold` is not reported. The staff stats scope differs from the list scope. |
| D2 | IMPLEMENTED (function) | RV saved | leak filed under Y2 (F8) | A global feed, newest first, is served to every role (`routes.ts:731-740`, spot-checked). |
| D3 | IMPLEMENTED | RV saved | minor | Admin 200, customer 403. `urgentTickets` counts `high`. |
| S1 | **PARTIAL** | RF saved | **CONFIRMED** | `/api/admin/users` returns password hashes (transcript). Admin reset-password is a stub that never stores the password (`storage.ts:1105-1118`, spot-checked). |
| S2 | IMPLEMENTED | prefix/name RV | — | Logo upload not probed. Base64 logos are capped by the 100 kB default for `express.json()`. |
| S3 | IMPLEMENTED | create/list RV report | hardening (F18) | The list omits the secret. Keys come from `Math.random`, are stored in plain text, and the route is not admin-gated. |
| S4 | IMPLEMENTED | list RV report | — | CRUD not walked. |
| S5 | IMPLEMENTED | list RV saved | — | Clear not walked. |
| S6 | **PARTIAL** (ext. Entra) | GET RV saved (empty values) | **CONFIRMED** (spot-checked) | `GET /api/sso/config` returns the stored row with `clientSecret` in plain text (`routes.ts:1122-1123`). |
| Y1 | **PARTIAL** | 4 named routes 401 RV saved | **CONFIRMED** (spot-checked) | `/api/help`, `/api/help/search` and `/api/help/:id` have no `isAuthenticated`. `/api/auth/check-email` allows email enumeration. |
| Y2 | **PARTIAL** | cross-customer GET/PATCH/comment 403 RV saved | **CONFIRMED** | Leaks: the global `/api/activity` (spot-checked), unauthorised `DELETE /api/attachments/:id` (spot-checked), auto-response read, `/api/users` to any role, Teams webhook fan-out (F7) and presign to any folder (F14). |
| Y3 | IMPLEMENTED | RV saved (sample) | — | Every `/api/admin/*` handler checks `role !== 'admin'`. |
| Y4 | **MISSING** | staff GET 200 report-only | **CONFIRMED** (challenger + spot-check) | The route sets `filters.userIdFilter` (`routes.ts:163`), but `getTasks` has no such filter (`storage.ts:538-546`), so staff list, read, update and comment on every ticket. |
| Y5 | **PARTIAL** | RF saved | **CONFIRMED** | `password` hashes in admin/user responses (transcript). `/api/users` returns them to any role, including reset tokens (`routes.ts:450-458`). Challenger verified. |
| Y6 | **PARTIAL** | health `rateLimiting:false` RV saved | **CONFIRMED** | Auth and password-reset limiters are commented out (`security/index.ts:109-113`). The general limiter runs in production only. All phases agree. |
| Y7 | **PARTIAL** | validation RF; XSS NR | **CONFIRMED** (spot-checked) | `applySecurity` (with `sanitizeInput`) runs before `express.json()` (`server/index.ts:9-11`), so request bodies are never sanitised. Validation gaps as in T2, T10 and T12. Raw guide HTML. CSP `'unsafe-inline'`. |
| Y8 | IMPLEMENTED | RV saved | minor | Helmet CSP, nosniff and DENY headers. Health JSON 200 (`healthy:false`). Duplicate CSP header. |
| Y9 | IMPLEMENTED | RV report | hardening (F5) | `HttpOnly; SameSite=Lax`, 7 days. A hard-coded fallback session/JWT secret is used if the env var is unset. |
| P1 | **PARTIAL** | RF | **CONFIRMED** | Invalid values return 200. NaN ids return 500. Unknown `/api/*` returns 200 HTML. `{message}` instead of the documented shape. The error handler re-throws after responding. |
| P2 | IMPLEMENTED | HTML 200 only, NR | — | `client/src/pages/api-docs.tsx`. |
| P3 | **PARTIAL** | RF | **CONFIRMED** | Documented create returns 400, delete returns 500, the docs say PUT but the code uses PATCH, and the docs describe an envelope but the code returns an array. |
| M1–M9 | **MISSING** (9) | — | **CONFIRMED** (by design built last) | No MCP code or dependency in any phase. JWT middleware exists but no route uses it (needed for M2). |

**Totals (87):** IMPLEMENTED 47 · PARTIAL 24 · STUB 2 (A8, E5) · MISSING 12 (I6, E6, Y4, M1–M9) · DISPUTED 2 (A9, T14). This matches the review's 47/26/2/12, with A9 and T14 moved from PARTIAL to DISPUTED.

---

## Confirmed gaps (ranked)

The ranking is by importance to the design. Rank 1 comes first because "done" means a gate PASS, and today the gate cannot execute any suite. Ranks 2-11 cover the core ticket loop and the critical security defects. M1–M9 sit at rank 12: the design builds them after the defects are fixed, and their isolation depends on ranks 3 and 9.

| Rank | Gap | IDs | Severity | Basis | WP |
|---|---|---|---|---|---|
| 1 | The repository's own checks cannot run or pass: the `verify.sh` read-only mount stops every Node step in the gate. Behind it: no `lint` or `e2e` script, `jest.config.js` is CommonJS under `"type":"module"`, `jest@30` is paired with `ts-jest@29`, and there are 353 TS errors. The compose app starts before the schema exists and crashes. The `pg` install is unpinned. | gate (M9 "suite passes") | Blocker | gate log 855-906; builder transcript; R+C agree | 1, 2 |
| 2 | Documented and UI ticket create returns 400 (`ticketNumber` required) | T1, P3 | Critical (core loop) | saved RF + gate log 849; C agrees | 5 |
| 3 | No staff isolation: `userIdFilter` is dead code, and GET, PATCH, comments and attachments check only customers | Y4 | Critical (F4) | C + spot-check | 6 |
| 4 | Password hashes and reset tokens are returned to any authenticated user (`/api/users`, admin users, team members, admin PATCH/toggle/approve responses) | Y5, S1, G2 | Critical (F2) | saved RF; C agrees | 3 |
| 5 | Invitation privilege escalation: registering with an invited email grants the invited role and approval without the token. Password can be set on password-less SSO accounts. | G6, A1 | Critical (F3) | C agrees | 3 |
| 6 | Known admin `admin@ticketflow.local` / `Admin123!` is seeded in every environment, and the password is logged | Y1, Y3 (no single ID) | Critical (F1) | C agrees | 3 |
| 7 | Every ticket delete returns 500 (FK, no cascade), and non-admin staff are not refused | T16, P3 | High | C agrees; code | 6 |
| 8 | No validation: empty title, any priority or status string accepted; `resolvedAt`/`closedAt` never stamped; `createdBy`, `ticketNumber` and `resolvedAt` can be PATCHed by the client; NaN ids return 500 | T2, T10, T12, P1, Y7 | High | saved RF + gate log 850; C verified T12 | 5 |
| 9 | Remaining data-isolation leaks: global activity feed to customers, unauthorised attachment delete, auto-response read and add-to-learning unchecked, `/api/stats/global` | Y2, D2, T15, I9 | High (F8, F9, F12) | code, spot-checked | 6 |
| 10 | Login brute force is unthrottled: auth/reset rate limiters are commented out and lockout is not wired | Y6, A8 | High | all phases; C agrees | 4 |
| 11 | No per-ticket audit-trail read endpoint | T17 (and T13 visibility) | High (design feature) | saved RF; all phases | 7 |
| 12 | The MCP server and tools are absent | M1–M9 | High (design deliverable, built last) | all phases | 15-18 |
| 13 | Real-time updates are a stub: there are no broadcasts, the page uses mock data, and the socket identity is chosen by the client | E5 | Medium-High | C agrees | 10 |
| 14 | Admin AI settings API is missing (threshold, switch, test) | I6 | Medium-High | saved RF | 8 |
| 15 | Revoked invitation tokens still validate and can be accepted. Accept creates no user. Missing `expiresAt` gives 500. Tokens come from `Math.random`. | G7, G6, E3 | Medium-High | C + spot-check; runtime report | 12 |
| 16 | Any non-customer can create teams and becomes team admin | G1 | Medium | all phases (code) | 12 |
| 17 | Teams webhook: any user can register a URL that receives every ticket (data leak and SSRF) | E4, Y2 | Medium-High (F7) | review (code) | 10 |
| 18 | Attachments: no 10 MB limit, no real file upload (fake URL) | T15 | Medium | code + runtime report | 7 |
| 19 | AI auto-response comment can never be written (`'system'` FK). Latent until Bedrock is configured. | I2 | Medium | C agrees (severity disputed) | 8 |
| 20 | Body sanitiser runs before the body parser. Raw guide HTML with CSP `'unsafe-inline'` (stored XSS). | Y7, K7, Y8 | Medium (F13, F15) | spot-checked | 14 |
| 21 | Secrets in plain text: SSO `clientSecret` and SES `awsSecretAccessKey` returned to the UI. Fallback session/JWT secret. Reset token logged and unhashed. API keys from `Math.random`, stored in plain text, not admin-gated. | S6, E1, Y9, A6, S3 | Medium (F5, F6, F16, F18) | spot-checked S6; review | 3, 4, 13 |
| 22 | Admin "reset password" is a stub that returns a password it never saved | S1 | Medium | spot-checked | 13 |
| 23 | Anonymous help-document access and email enumeration | Y1, K5 | Medium (F25) | spot-checked | 9 |
| 24 | Inactive company policies are visible and downloadable to any user | K6 | Medium | spot-checked | 9 |
| 25 | Any user can presign an S3 PUT into any folder (knowledge-base poisoning) | K8, Y2 | Medium (F14) | review (code) | 9 |
| 26 | Dashboard counts are wrong: high-priority filter overridden, `on_hold` missing, stats scope differs from list scope, "urgent" counts `high` | D1, D3 | Medium | C verified | 13 |
| 27 | Team assignment cannot be read back (`assigneeTeamId` not returned or joined) | T11 | Medium | review (code) | 7 |
| 28 | `analyze-ticket` and `generate-response` take free text, not a ticket id, so they cannot return a 4xx for a missing ticket | I3 | Medium | review (code) | 8 |
| 29 | Error contract: `{message}` instead of the documented shape, unknown `/api/*` returns 200 HTML, the handler re-throws, and the docs drift (PUT/PATCH, envelope, bcrypt/scrypt) | P1, P3 | Medium | saved RF | 14 |
| 30 | Inbound email to ticket and reply to comment are absent | E6 | Medium (external SES) | all phases | 11 |
| 31 | Minor: ticket-number race and lexicographic max (T3); case-sensitive search (T7); a PATCH with no body does not toggle publish (K2); unpublished guides listed (K7); task feedback without an auto-response returns 500 (I4); deactivated sessions survive (A5); `dueDate:null` cannot clear (T18) | T3, T7, K2, K7, I4, A5, T18 | Low | review/runtime | folded into 4, 5, 7, 9 |

---

## Disputed

### Open disputes

**D-1 · T14: is an empty comment rejected?**
- *Reviewer:* PARTIAL. The active handler (`routes.ts:420-447`) validates with `insertTaskCommentSchema` (`createInsertSchema(taskComments)`, `content` is `text().notNull()` with no minimum length), so `{content:""}` is stored with 201. The duplicate handler with a `trim()` check (`routes.ts:743-776`) is registered later and shadowed.
- *Runtime:* "empty comment 400". This comes from an unsaved rerun; the saved transcript shows 401 (unapproved staff). The probe script did send `{content:''}` (`ticketflow-runtime-probes-2026-10-01.mjs:73`).
- *Challenger:* not re-checked.
- *Synthesis spot-check:* the code reads as the reviewer says.
- **Settle:** as an approved user, `POST /api/tasks/:id/comments {"content":""}` and save the response. 201 makes it a confirmed PARTIAL gap. WP 7 carries the test, and the one-line fix if the test fails.

**D-2 · A9: Microsoft SSO.**
- *Map:* IMPLEMENTED.
- *Reviewer:* PARTIAL, hedged as "very likely". `auth.ts:169` serialises `user.id`, but the Microsoft user object has no `id` (`microsoftAuth.ts:118-131`), and the fallback serialiser never registers (`microsoftAuth.ts:146`). SSO users are upserted with no approval or role check (`:115`). `validateIssuer:false` (`:81`).
- *Runtime:* NOT-RUNNABLE (Entra absent).
- *Challenger:* silent.
- **Settle:** a unit test that drives the Microsoft verify callback with a mocked profile through `req.logIn` and asserts a session plus `isApproved` handling, or a live Entra tenant test. Scheduled as the first step of WP 4. Fix only if it fails.

**D-3 · I2: how severe is the `'system'` FK defect?**
- *Reviewer:* broken now; no AI comment is ever added.
- *Challenger:* agrees the defect exists but calls it latent: it fires only when Bedrock returns a confidence of 0.7 or more, so it never fires in unconfigured environments.
- Both agree it must be fixed. The dispute affects ordering only.
- **Settle:** a unit test with mocked analysis at confidence 0.8, asserting that an "AI Auto-Response" comment row exists. WP 8 runs before any Bedrock enablement, so either position gives the same plan.

**D-4 · I3/I5: AI cost abuse, a challenger-only finding.**
- *Challenger:* `POST /api/ai/analyze-ticket`, `/api/ai/generate-response` and `/api/chat` need only `isAuthenticated` (`routes.ts:3553,3581`; my spot-check found no role check in 3553-3603). So any customer can drive Bedrock spend without a rate limit.
- *Reviewer:* did not raise it; it filed I3 as PARTIAL for the free-text input only.
- Design text: I3 says "Agents can analyse". I5 (chat) is meant for all users, so `/api/chat` needs a quota, not a role gate.
- **Settle:** the owner decides whether customers may call I3 endpoints, then a customer-session probe expecting 403. WP 8 includes the gate for analyze/generate. Rate limiting for chat rides on WP 4.

**D-5 · `getTasks` N+1 queries, a challenger-only finding with no requirement ID.**
- *Challenger:* one SELECT per creator and per assignee per row (`storage.ts:595-650`).
- *Reviewer:* not raised.
- **Settle:** a query-count assertion when listing 50 tickets. Optional stretch item in WP 6; not ranked.

### Conflicts resolved in this synthesis (not open)

| Item | Positions | Resolution |
|---|---|---|
| T13 | Runtime FAIL; review and challenger IMPLEMENTED | IMPLEMENTED. The runtime failure is the missing history route, which is counted once under T17. |
| Y4 list | Runtime: "excluded from normal staff list". Review and challenger: `userIdFilter` is dead code. | Review wins. The challenger agreed, `storage.ts:538-546` has no such filter (spot-checked), and the saved staff probes are 401. |
| Y1 | Runtime RV; review PARTIAL | PARTIAL. These do not contradict each other: the runtime probed only the four named routes, and the `/api/help*` routes have no auth (spot-checked). |
| Map vs review (28 IDs) | Map mostly IMPLEMENTED | Review statuses taken. The challenger endorsed the review, and runtime evidence agrees wherever it exists. The map's own tallies contradict each other (61/5/10 vs 71/6/10). |
| `npm ci` PASS (builder) vs FAIL (gate) | Same commit | The gate's clean tree has no `node_modules` mount point. This is a harness defect (R+C). |
| "Only `verify.sh` changed" (runtime) | Review: 4 files | 4 files. The gate diff lists `Dockerfile`, `docker-compose.yml`, `docker/db.ts` and `scripts/ai/verify.sh`. |

---

## Work packages

Order: WP 1-2 make the repository's own checks run (the gate fails today). After that the packages follow the design's section order A → T → I → K → E → G → D → S → Y → P → M. A Y-section or P-section gap goes with the first section whose code it changes. For example, Y5 goes with accounts, and Y4 goes with tickets, because the MCP tools reuse it. Each package is about one builder day.

General rules for every package:
- Add locked tests for every acceptance item.
- Change no existing assertion.
- Finish with `gate nmadhukar/ticketflow`.
- Changes to locked files (`scripts/ai/verify.sh`, and any locked test or config) need the owner to re-approve the lock. The builder never approves a lock.

## Work package 1 — Repository test suites runnable and gate harness repaired
**IDs:** gate precondition (M9 "suite passes"). Rank 1.
**Scope:**
- Make `jest.config.js` load under ESM (rename to `.cjs`, or convert it to ESM).
- Align `ts-jest` with `jest@30`, and give the client tests jest types.
- Add a `lint` script with a minimal ESLint config that passes.
- Add an `e2e` script with pinned `@playwright/test@1.55.0` and at least one real spec: login page loads, then the seeded dev admin signs in.
- Pin `pg`/`@types/pg` in `package.json` and the lockfile, and drop the unpinned `npm install` from the `Dockerfile`.
- Make the compose app wait for the schema (push or migrate before start).
- In `verify.sh`, stop mounting `node_modules` inside the `:ro` source tree (copy the source into a writable volume), and correct the "every discovered test runs" comment. This needs the owner's re-lock.
- Env-gated suites (`e2e/user-workflows`, `load/performance`, `integration/bedrock-api`) are reported honestly as skipped. Do not delete them.

**Acceptance criteria:**
1. In the gate: `npm ci frozen install`, `lint`, `all Jest suites`, `Jest runner report validated` and `official pinned-image browser e2e suite` all PASS.
2. The Jest JSON is valid with `numFailedTests = 0` and `numPassedTests ≥ 1`, and the `TESTS[...]` line reports the runner's own non-zero passed count.
3. `docker compose up -d --build` on an empty DB reaches `/api/security/health` 200 without a manual restart.
4. `git diff` shows no edited test assertion and no new `.skip`/`.only`/`--passWithNoTests`.

## Work package 2 — Typecheck clean
**IDs:** gate precondition. Rank 1.
**Scope:** fix the ~353 `tsc` errors. The largest counts are in `server/storage.ts` (51, including duplicate methods), `server/security/middleware.ts` (37), `client/src/pages/admin.tsx` (35), `client/src/components/ticket-detail.tsx` (32) and the two client test files (48). Do not change behaviour.
**Acceptance criteria:**
1. The gate `typecheck` step (`npm run check -- --noEmit`) PASSes.
2. No new `@ts-nocheck`, no new blanket `any` casts in more than 5 places, and no files removed from `tsconfig` `include`.
3. WP 1 suites still pass with the same or a higher count.

## Work package 3 — Account trust: seeded admin, credential exposure, invitation takeover
**IDs:** Y5, S1 (hash part), G2 (members leak), A1, G6 (F3 branch), F1, F5. Ranks 4, 5, 6, 21.
**Scope:**
- Seed the default admin only when `NODE_ENV !== 'production'` (or behind an explicit env flag), and never log its password.
- Add a single `toPublicUser()` serializer that strips `password`, `passwordResetToken` and `passwordResetExpires`. Apply it to `/api/users`, `/api/admin/users`, team members and the admin PATCH/toggle/approve responses.
- Restrict `/api/users` to staff.
- Registration grants the invited role and approval only with a valid invitation **token** bound to the email. Without the token: an unapproved customer.
- Never set a password on an existing password-less account through registration.
- Fail startup in production if `SESSION_SECRET`/`JWT_SECRET` is unset.

**Acceptance criteria:**
1. No response from any route in the route list contains the keys `password`, `passwordResetToken` or `passwordResetExpires`. Prove it with a test that walks `/api/users`, `/api/admin/users`, `/api/teams/:id/members` and the 3 admin mutations.
2. As a customer, `GET /api/users` returns 403.
3. An invitation for `x@corp` as `admin`: registering `x@corp` without the token gives `isApproved:false`, role `customer`. With the token, the user is approved with role `admin`.
4. With `NODE_ENV=production`, no `admin@ticketflow.local` is created and the log contains no password. Missing `SESSION_SECRET` aborts startup.
5. The gate auth probe still PASSes. The gate uses the dev seed.

## Work package 4 — Login brute-force protection and reset hygiene
**IDs:** A8, Y6, A6 (F6), A5, A9 (settle D-2 first). Ranks 10, 21.
**Scope:**
- Wire the 5-failure / 15-minute lockout into the live `LocalStrategy`. Persist it in the user row or a store, not in an in-memory Map per process.
- Re-enable the auth limiter and the password-reset limiter with an IPv6-safe key, on the real paths `/api/auth/login`, `/api/auth/forgot-password` and `/api/auth/reset-password`. They return 429 `RATE_LIMIT_EXCEEDED`.
- Enable the general limiter at 100 requests per 15 minutes outside test.
- Hash reset tokens at rest and remove the token from the log.
- `deserializeUser` rejects inactive users.
- Add the D-2 SSO serialisation test, and fix it only if it fails.

**Acceptance criteria:**
1. 5 wrong passwords, then the correct one, returns a locked-account error. After the lock window expires (clock-mocked), login succeeds.
2. More than the configured attempts from one IP within 15 minutes returns 429 with `RATE_LIMIT_EXCEEDED`.
3. `/api/security/health` reports `rateLimiting:true`.
4. The `users.password_reset_token` column never equals the emailed token, and the log contains no token.
5. After `toggle-status` deactivates a user, that user's existing cookie gets 401 on `/api/auth/user`.
6. The D-2 test result is recorded, and A9 is restated as IMPLEMENTED or PARTIAL.

## Work package 5 — Ticket create, validation and status workflow
**IDs:** T1, T2, T10, T12, P1 (ids), P3 (create), Y7 (validation part). Ranks 2, 8.
**Scope:**
- Separate create and update schemas. They omit `ticketNumber`, `createdBy`, `resolvedAt`, `closedAt`, `createdAt` and `updatedAt`.
- Title is `.min(1)`. Use enums for status (`open`, `in_progress`, `on_hold`, `resolved`, `closed`), priority, severity and category.
- `updateTask` stamps `resolvedAt`/`closedAt` on transition. Decide and document whether reopening clears them.
- All `:id` routes return 400 for non-numeric ids.
- Fix the client form if needed.

**Acceptance criteria:**
1. `POST /api/tasks {title,description,category:"bug",priority:"high"}` with no `ticketNumber` returns 201 with `TKT-YYYY-NNNN`, status `open` and `createdBy` equal to the caller.
2. An empty or missing title, priority `not-valid` and status `broken` each return 400 on create or PATCH, and no row is written or changed.
3. A PATCH to `resolved` and to `closed` returns non-null `resolvedAt` and `closedAt`, and `updatedAt` increases.
4. A body `createdBy`/`ticketNumber` sent in a PATCH is ignored or rejected.
5. `PATCH`, `DELETE`, `/comments` and `/attachments` on `/api/tasks/abc` return 400, not 500.
6. The gate step "Create and walk all workflow stages without re-entry" PASSes.

## Work package 6 — Ticket access control, delete and isolation leaks
**IDs:** Y4, Y2 (ticket paths), T16, T15 (delete auth), D2 (feed scope), I9/I1 (access checks). Ranks 3, 7, 9.
**Scope:**
- Add one shared `canAccessTask(user, task)` policy in the service layer: admin sees everything; staff see tickets they created, are assigned to, or that are assigned to their team; customers see only tickets they created. The MCP tools reuse it.
- Implement the list filter in `getTasks`.
- Apply the policy to GET, PATCH, comments (GET/POST), attachments (GET/POST/DELETE), `auto-response` (GET/feedback) and `add-to-learning`.
- Scope `/api/activity` and `/api/stats/global` by the same policy.
- Make `DELETE /api/tasks/:id` admin-only, and delete or cascade history, comments and attachments in one transaction.
- Optional D-5: remove the N+1 in `getTasks`.

**Acceptance criteria:**
1. Staff user U (not the creator or assignee) gets 403 on GET, PATCH and comment for ticket X, and X is absent from U's `GET /api/tasks`.
2. After X is assigned to U, all of these succeed.
3. Customer B gets 403 on A's ticket for read, update, comment, attachment list, attachment delete and auto-response, and B's `/api/activity` contains no event for A's ticket.
4. Admin `DELETE /api/tasks/:id` on a ticket with history, comments and an attachment returns 204, then `GET` returns 404. A user and a customer each get 403, and the ticket remains.
5. Cross-role test matrix (customer, user, manager, admin × own/other) is green.

## Work package 7 — Audit trail, team assignment, attachments, comments
**IDs:** T17, T13 (visibility), T11, T15, T14 (settle D-1), T18 minor. Ranks 11, 18, 27.
**Scope:**
- Add `GET /api/tasks/:id/history`, guarded by `canAccessTask`. Each entry has actor, field, old value, new value and time, ordered oldest first.
- Return `assigneeTeamId` and join the team on it.
- Attachments: enforce 10 MB on the declared size (and on multipart, if added), and replace the fake client URL with the presigned-upload flow (external S3).
- Add the D-1 test (`{content:""}` returns 400) and make the active comment handler reject empty or whitespace content.
- `dueDate:null` clears the date.

**Acceptance criteria:**
1. Create, set status `closed`, reopen to `open`, then reassign. The history endpoint returns JSON with ≥4 entries, each with `userId`, `field`, `oldValue`, `newValue` and `createdAt`.
2. Unknown `/api/*` paths no longer return HTML (cross-check with WP 14).
3. A PATCH with `assigneeType:"team", assigneeTeamId:T` followed by a GET returns `assigneeTeamId:T`.
4. Attachment metadata of 11,000,000 bytes returns 400 (or 413). 10,000,000 bytes returns 201.
5. An empty or whitespace comment returns 400, and no row is written.

## Work package 8 — AI settings and AI correctness
**IDs:** I6, I2, I3, I4 minor, D-4 (I3 role gate, after the owner decides). Ranks 14, 19, 28.
**Scope:**
- Add `GET/PUT /api/admin/ai-settings` (confidence threshold, auto-response switch) and `POST /api/admin/ai-settings/test`, all admin-only. Wire them to `client/src/pages/ai-settings.tsx`.
- Auto-response reads the threshold and switch from settings.
- The AI comment uses a real seeded system user or a nullable author.
- `analyze-ticket`/`generate-response` accept a `taskId`, look up the ticket with `canAccessTask`, and return 404 for a missing ticket.
- Restrict them to staff if the owner confirms D-4.
- Task feedback without an auto-response returns 404, not 500.
- Use a mocked Bedrock in tests.

**Acceptance criteria:**
1. Admin GET/PUT round-trips the threshold. A customer and a user each get 403.
2. `/test` returns a JSON `connected:false` with a clear error when AWS is unset.
3. With mocked confidence 0.8, a comment prefixed "AI Auto-Response" exists. At 0.5, there is none. At 0.8 with the switch off, there is none.
4. `analyze-ticket` with an unknown `taskId` returns 404. With a valid id it returns `{category, priority, suggestedText, confidence}` (mocked).
5. Ticket creation still returns 201 when Bedrock throws.

## Work package 9 — Knowledge, help, policies and S3 access
**IDs:** Y1 (help routes, check-email), K5, K6, K7 (unpublished listing), K8 (F14), K2 minor. Ranks 23, 24, 25.
**Scope:**
- Require auth on `/api/help`, `/api/help/search` and `/api/help/:id`.
- Rate-limit `/api/auth/check-email` or remove the enumeration.
- Honour `includeInactive` and inactive-policy download for admins only.
- Non-admins see only published guides.
- Presign is restricted to an allow-list of folders per role (customers: ticket attachments only) and content types.
- A publish PATCH with no body toggles.

**Acceptance criteria:**
1. Anonymous `GET /api/help`, `/api/help/search?q=x` and `/api/help/1` return 401. Signed-in users get 200.
2. A user with `?includeInactive=true` sees no inactive policy, and downloading an inactive policy returns 403/404. An admin sees both.
3. A customer presign into the `help/`, `policies/` or `guides/` folders returns 403.
4. `PATCH /api/admin/knowledge/:id/publish` with no body flips `isPublished`, and K2 search visibility follows it.
5. An unpublished guide is absent from a user's `GET /api/guides`.

## Work package 10 — Real-time notifications and Teams webhook safety
**IDs:** E5, E4 (F7), Y2 (webhook fan-out). Ranks 13, 17.
**Scope:**
- Authenticate WebSocket clients from the session cookie on upgrade, and ignore any client-sent `userId`.
- Broadcast `ticket_created`, `ticket_updated` and `comment_added` only to users who pass `canAccessTask`.
- The Notifications page shows live and persisted events instead of `mockNotifications`.
- Teams integration settings are admin-only, and webhook URLs must be HTTPS on an allow-listed Microsoft host.

**Acceptance criteria:**
1. Assignee A's socket on `/ws` receives a message within 2 seconds of a PATCH to A's ticket. Unrelated customer B's socket receives nothing.
2. A socket with no session cookie is refused or receives nothing.
3. `client/src/pages/notifications.tsx` no longer references `mockNotifications`, and the page renders the received event in the Playwright suite.
4. A customer or user `POST` of a Teams webhook returns 403, and a non-Microsoft URL returns 400. `POST /api/teams-integration/test` still reports success or failure (external).

## Work package 11 — Inbound email to tickets
**IDs:** E6. Rank 30.
**Scope:**
- Add an SES-receipt → SNS → HTTPS endpoint that verifies the SNS signature.
- A new message from a known user or customer creates a ticket.
- A reply whose subject or headers carry `TKT-…`/`HD-…` adds a comment to that ticket.
- Unknown senders follow a documented rule (reject, or create an unapproved customer).

**Acceptance criteria:**
1. A recorded SNS fixture for a new email creates a ticket with the sender as `createdBy` and the subject as the title.
2. A reply fixture with `Re: [HD-2026-0001]` adds a comment to that ticket.
3. An invalid signature returns 403 and creates nothing.
4. A live SES test is NOT-RUNNABLE unless SES is configured. Mark it so, not as a pass.

## Work package 12 — Teams and invitations
**IDs:** G1, G6, G7, E3 (expiresAt, tokens). Ranks 15, 16.
**Scope:**
- `POST /api/teams` is for admin and manager only.
- Invitation token GET and accept accept only `pending`, unexpired invitations.
- `accept` takes a password (and name), creates an approved user with the invited role, and marks the invitation accepted, so it works together with WP 3's token-bound registration.
- `expiresAt` defaults to 7 days.
- Tokens use `crypto.randomBytes`.

**Acceptance criteria:**
1. A user `POST /api/teams` returns 403. Manager and admin get 201, and the team appears in `GET /api/teams`.
2. After `DELETE /api/admin/invitations/:id`, `GET /api/invitations/:token` and `/accept` return 400/404.
3. `POST /api/invitations/:token/accept {password,…}` creates a user with `isApproved:true` and the invited role, who can log in immediately. An invalid token is refused.
4. Creating an invitation without `expiresAt` returns 200/201 with an expiry about 7 days ahead.

## Work package 13 — Dashboards and admin settings correctness
**IDs:** D1, D3 minor, S1 (reset stub), S6, E1 (secret masking), S3 (F18). Ranks 21, 22, 26.
**Scope:**
- `getTaskStats` uses the same visibility policy as the list, combines conditions with `and(...)`, and reports `on_hold`.
- `urgentTickets` counts `urgent`.
- Admin reset-password hashes and stores a random temporary password and forces a change, or sends a reset link.
- `GET /api/sso/config` and `GET /api/smtp/settings` return masked secrets, and a save keeps the stored secret when the masked value is posted back.
- API keys use `crypto.randomBytes`, are stored hashed, and the routes are admin-only.

**Acceptance criteria:**
1. For a staff user, every count in `/api/stats` equals the number of matching tickets in that user's `GET /api/tasks`. The high-priority count equals the number of tickets with priority `high` (fixture with mixed priorities).
2. After admin reset, logging in with the returned temporary password succeeds and the old password fails.
3. The SSO and SMTP GET bodies contain no stored secret value.
4. A non-admin `POST /api/api-keys` returns 403, and the DB column does not equal the returned plaintext key.

## Work package 14 — Cross-cutting input safety and API error contract
**IDs:** Y7, Y8 minor, K7 (raw HTML), P1, P3 (docs). Ranks 20, 29.
**Scope:**
- Move `sanitizeInput` after `express.json()`.
- Sanitise guide HTML on save and render it through a sanitiser.
- Use a single CSP without `'unsafe-inline'` scripts in production.
- Unknown `/api/*` returns JSON 404 before the Vite or static fallback.
- The error handler stops re-throwing after it responds.
- Either adopt the documented `{error,message,details,requestId}` shape, or update API_ENDPOINTS_REFERENCE.md, the Postman collection and SECURITY.md (PATCH, bare array, `{message}`, scrypt) to match the code. The owner picks one.

**Acceptance criteria:**
1. A ticket title or comment of `<script>alert(1)</script>` is stored inert, and the Playwright ticket page records no dialog or script execution.
2. A guide containing `<img onerror>` renders without the handler.
3. `GET /api/does-not-exist` returns 404 JSON.
4. 400, 401, 403 and 404 responses on ticket routes have the chosen shape and no stack trace.
5. A contract test walks the documented create, get, list, update, comment and delete calls and matches the (updated) documentation.

## Work package 15 — MCP server, tool listing and authentication
**IDs:** M1, M2. Rank 12. **Precondition:** WP 3-7 merged, so the service layer and `canAccessTask` exist.
**Scope:**
- An MCP server (official SDK) runs alongside Express and calls the same service and storage functions.
- `tools/list` returns 8 tools with descriptions and JSON input schemas.
- Authentication accepts the REST session cookie or a JWT (wire up the existing JWT middleware).

**Acceptance criteria:**
1. An MCP client connects, and `tools/list` returns exactly `create_ticket`, `get_ticket`, `list_tickets`, `update_ticket`, `close_ticket`, `reopen_ticket`, `delete_ticket` and `add_comment`, each with a non-empty description and a valid JSON schema.
2. A call with no credential, or with an invalid or expired token, returns an authentication error, and a DB row count before and after shows no change.
3. The same token works on `GET /api/auth/user`.

## Work package 16 — MCP create, get and list
**IDs:** M3, M4, M5. Rank 12.
**Acceptance criteria:**
1. `create_ticket` with valid input returns `ticketNumber` and `createdBy` equal to the caller, and `GET /api/tasks/:id` returns the same ticket. Invalid input returns a validation error and creates no row.
2. `get_ticket` returns a visible ticket. An unknown id returns not-found. A customer asking for another customer's ticket is refused exactly as REST refuses it.
3. `list_tickets` with status, category, assignee, search, limit and offset returns the same ids, in the same order, as `GET /api/tasks` for the same user and filters, for customer, user and admin.

## Work package 17 — MCP update, close and reopen
**IDs:** M6, M7. Rank 12.
**Acceptance criteria:**
1. `update_ticket` changes only the fields supplied, and writes the same `task_history` rows as the REST PATCH. Compare with the WP 7 history endpoint.
2. Invalid values are rejected, and a user that REST would refuse is refused.
3. `close_ticket` sets `closed` and `closedAt`. `reopen_ticket` sets `open`.
4. Closing a closed ticket, or reopening an open one, returns a clear error or an explicit no-op.
5. Both close and reopen appear in history.

## Work package 18 — MCP delete, add_comment and the isolation test suite
**IDs:** M8, M9. Rank 12.
**Acceptance criteria:**
1. `delete_ticket` without `confirm:true` refuses and the ticket remains. With `confirm:true`, an admin delete makes REST GET return 404. A customer and a user are refused even with `confirm:true`.
2. `add_comment` adds a comment that is visible at `GET /api/tasks/:id/comments`. An empty body, or a ticket the caller cannot access, is refused.
3. Every tool has tests for success, validation error, unauthenticated, forbidden and not-found, and the suite passes in the gate.
4. A cross-user test proves that no tool returns or changes another customer's data.
5. The gate prints RESULT: PASS with a `TESTS[...]` passed count higher than the WP 1 baseline.

---

## SUMMARY
1. Gate run 20261001T193507Z-4773e8 on e1de508 FAILs (8 pass / 7 fail, 0 tests). The test suites never ran because of `verify.sh`'s read-only mount; behind it, the repository has no lint or e2e script, Jest config breaks under ESM, and there are 353 TS errors. So WP 1-2 are the repository's own tests.
2. Final status of the 87 IDs: 47 IMPLEMENTED, 24 PARTIAL, 2 STUB (A8, E5), 12 MISSING (I6, E6, Y4, M1–M9), 2 DISPUTED (A9, T14). The review's statuses hold; the challenger agreed with 10 of 10 and nothing it re-checked was refuted.
3. Top confirmed gaps: ticket create returns 400 (T1); no staff isolation (Y4); password hashes and reset tokens exposed (Y5); invitation-by-email role takeover (G6/F3); seeded `Admin123!` admin everywhere; every delete returns 500 (T16); no validation or `resolvedAt`/`closedAt` stamping (T2/T10/T12).
4. Open disputes: T14 empty comment (code says 201, unsaved runtime says 400), A9 SSO serialisation, I2 severity (broken vs latent), and the challenger-only AI cost-abuse and N+1 findings. Each has a named settling test.
5. 18 work packages, about a day each, in design order: tests (1-2) → accounts (3-4) → tickets (5-7) → AI (8) → knowledge (9) → email (10-11) → teams (12) → dashboard/settings (13) → security/API (14) → MCP (15-18).
