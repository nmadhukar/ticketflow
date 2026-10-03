# TicketFlow validate: cold review, 2026-10-01

**Role:** cold reviewer. I did not run the earlier phases and did not take their claims on trust.
**Repository:** `/home/agent/workspace/nmadhukar/ticketflow`. The checkout is on branch `dc4/gate` (HEAD `e1de508`), not `main`. `main` = `origin/main` = `15621d1`. `dc4/gate` adds only `Dockerfile`, `docker-compose.yml`, `docker/db.ts` and `scripts/ai/verify.sh` (`git diff --stat main dc4/gate`). So the product code reviewed is the same as `main`.
**Inputs:** [requirements](ticketflow-requirements.md), [map](ticketflow-validate-map-2026-10-01.md), [runtime](ticketflow-validate-runtime-2026-10-01.md), probe transcript `ticketflow-runtime-probe-output-2026-10-01.txt`, builder gate transcript `ticketflow-verify-output-2026-10-01.txt`, and the independent gate run `/home/agent/evidence/nmadhukar/ticketflow/20261001T193507Z-4773e8.{json,log,diff,src.tar.gz}`.
**Mode:** read-only. I changed nothing in the repo and did not install, build, start containers or run tests.

## How the requesting-code-review checklist was applied

| Skill step | What I did |
|---|---|
| 1. Get the diff | `git diff main dc4/gate`: 4 files, 307 lines added (gate harness only). The product itself was reviewed file by file (`server/`, `shared/schema.ts`, `client/src`). |
| 2. Static security scan | On the diff, the only matches were the dev credentials `POSTGRES_PASSWORD: ticketflow`, `SESSION_SECRET: ticketflow-dev-session-secret-not-for-prod` (docker-compose.yml) and the product's seeded admin password `Admin123!`, which verify.sh uses. There was no `eval`/`exec`, no `shell=True` and no pickle. `\|\| true` appears only in cleanup and `ps`. In the product: no raw SQL (`sql.raw`/`db.execute` absent; Drizzle parameterises the queries). |
| 3. Baseline tests and lint | **Not run** (the brief is read-only). I used the gate log and the builder transcript instead. See "Gate check". |
| 4. Self-review checklist | Applied to the product: hard-coded secrets, input validation, parameterised SQL, path handling, error handling, debug logging and tests. Findings are below. |
| 5. Independent reviewer subagent | There is no `delegate_task` tool in this harness. This review is itself the independent, fresh-context reviewer. |
| 6–8. Evaluate / auto-fix / commit | **Verdict: VERIFICATION FAILED.** Auto-fix and commit were skipped on purpose (review only, no fixing). |

---

## 1. Requirement table (87 IDs)

Status meanings: **IMPLEMENTED** = the code satisfies the acceptance criterion (an external service may still be needed). **PARTIAL** = some of the criterion is met, or the code is present but broken. **STUB** = placeholder or disconnected code. **MISSING** = absent or not enforced at all.
The "Runtime evidence" column says whether the saved runtime artefacts support my status: RV = runtime-verified, RF = runtime-failed, NR = not runnable, — = none.
**✗** in the "Agrees?" column marks a disagreement with an earlier phase.

| ID | Final status | Agrees with earlier phases? | Evidence (code file:line; runtime) |
|---|---|---|---|
| A1 | IMPLEMENTED | Map ✓ / Runtime ✓ | `server/auth.ts:185-305` registers with `isApproved:false` (268), duplicate returns 400 (245-247), pending login returns 401 (157-158). RV. Security defect in the invitation branch: see F3. |
| A2 | IMPLEMENTED | ✓ / ✓ | `auth.ts:308-345`, session at 112-128, `/api/auth/user` at 368-383. RV. |
| A3 | IMPLEMENTED | ✓ / ✓ | `auth.ts:140-151,319,369-371`. RV. |
| A4 | IMPLEMENTED | ✓ / ✓ | `auth.ts:348-355` (`req.logout`). RV (old cookie gets 401). |
| A5 | IMPLEMENTED | ✓ / runtime NR | Toggle and approve at `routes.ts:608-638`. Login checks at `auth.ts:153-159`. Note: `deserializeUser` (171-182) and `isAuthenticated` (470-475) never re-check `isActive`, so a deactivated user's existing sessions stay valid. NR. |
| A6 | IMPLEMENTED (email is external) | ✓ / NR | `auth.ts:386-449`, generic reply (393, 407), "Invalid or expired reset token" (428). The reset token is **logged in plain text** (`auth.ts:405`) and stored unhashed (`storage.ts:393-415`); see F6. NR. |
| A7 | IMPLEMENTED | ✓ / NR | Default `customer` (`auth.ts:266`). Admin role change at `routes.ts:590-606` → `storage.ts:866-896`. Role value is not validated. NR. |
| A8 | **STUB** | ✗ map said PARTIAL / NR | Lockout exists only in a disconnected module: `security/secureAuth.ts:25,94`, with `const user = null; // Simplified for demo` at 205. No caller outside `server/security/` (grep). The live strategy (`auth.ts:131-167`) has no lockout. |
| A9 | **PARTIAL** (external) | ✗ map IMPLEMENTED / NR | Routes exist (`microsoftAuth.ts:42-61,152-199`, `routes.ts:1131-1140`). But: (a) `auth.ts:169` serialises `user.id`, while the MS user object has no `id` (`microsoftAuth.ts:118-131`), and the fallback serialiser is never registered (`146`, where `!passport.serializeUser.length` is always false). So `req.logIn` will very likely fail. (b) SSO users are upserted with no approval or role check (`115`), which would bypass the approval workflow. (c) `validateIssuer:false` (81). Not runtime-testable. |
| T1 | **PARTIAL (broken)** | ✗ map IMPLEMENTED / runtime RF ✓ | `insertTaskSchema` (`shared/schema.ts:321-329`) keeps `ticketNumber` required (`schema.ts:110` notNull). The route parses before storage generates the number (`routes.ts:224-228` vs `storage.ts:472`). The client never sends it (`client/src/components/task-modal.tsx:314-325`). RF: 400 "ticketNumber Required", in both the probe transcript and the gate log line 849. |
| T2 | **PARTIAL** | ✗ / RF ✓ | Missing title → 400 (zod). But an empty title and any priority/status string are accepted: `schema.ts:111,114-115` are free varchar, and there is no `.min(1)` or enum in `schema.ts:321-329`. RF (empty title gave 201). |
| T3 | IMPLEMENTED | ✓ / RV | `storage.ts:439-467`, prefix via `routes.ts:853-871`. Defects: race on concurrent creates (unique-violation 500), and a lexicographic `ORDER BY ticket_number` (`storage.ts:453`) breaks after `-9999`. RV (TKT-…-0001..0003, then HD-…-0001). |
| T4 | IMPLEMENTED | ✓ / RV | `routes.ts:194-219`: 400 (197-199), 404 (205-207). Minor: `getTask` omits `assigneeTeamId` (`storage.ts:495-529`). RV. |
| T5 | IMPLEMENTED (API + table UI) | ✓ (the map's "card/table toggle" claim is wrong: `viewMode` at `tasks.tsx:47` is never used) / NR | `routes.ts:141-173` returns a bare array. `client/src/pages/tasks.tsx:325-341` renders a `<table>` with number, title, priority, status and assignee. The staff visibility defect is counted under Y4. UI NR. |
| T6 | IMPLEMENTED | ✓ / NR | `routes.ts:146-152` → `storage.ts:549-559`. API returned matching JSON. UI not verified. |
| T7 | IMPLEMENTED | ✓ (the map says `ilike`; the code uses case-sensitive `like`, `storage.ts:76,565-571`) / RV | Substring match on title and description. RV (match, and `[]` for no match). |
| T8 | IMPLEMENTED | ✓ / RV | `storage.ts:583-589`. RV (no overlap). |
| T9 | IMPLEMENTED | ✓ / NR (staff portion not in saved transcript) | `routes.ts:175-192`, `assigneeId = caller`. Gate log: the admin's self-assignment shows in My Tasks (the workflow failed later, at resolvedAt). |
| T10 | **PARTIAL** | ✗ / RF ✓ | `routes.ts:305-375`. Valid update 200, unknown id 404 (313-315). Invalid values are accepted (`schema.ts:114-115`). A non-numeric id is not checked (307) and goes to the DB as NaN, giving 500. RF (`not-valid` priority gave 200). |
| T11 | **PARTIAL** | ✗ / NR | User assignment works (`routes.ts:322-323`). For team assignment, `assigneeTeamId` is stored, but `getTask` neither returns it nor joins on it: it joins teams on `assigneeId` (`storage.ts:533`, also `612`). So team assignment cannot be read back. |
| T12 | **PARTIAL** | ✗ (the map's text admits the gap but still says IMPLEMENTED) / RF ✓ | No status enum (`schema.ts:114`). `updateTask` never stamps `resolvedAt`/`closedAt` (`storage.ts:653-687`). Gate log 850: "resolvedAt not stamped". |
| T13 | IMPLEMENTED | Map ✓ / ✗ runtime RF | Close→open works through the same PATCH. History rows are written per field (`storage.ts:673-684`) and appear in `GET /api/activity` (`storage.ts:1082-1103`). The runtime phase failed T13 only because no per-ticket history route exists, which is T17's gap. |
| T14 | **PARTIAL** | ✗ map IMPLEMENTED / ✗ runtime "empty comment 400" (unsaved rerun; the saved transcript shows 401) | `routes.ts:397-447` is the active handler. The duplicate at 743-776, which does reject empty or whitespace content, is shadowed. `insertTaskCommentSchema` (`schema.ts`, `createInsertSchema(taskComments)`, `content` is `text().notNull()` at 137) only requires *a string*, so `""` passes and gives 201. Body sanitising never runs (Y7). Create and list work. Comments come back newest first (`storage.ts:799`). |
| T15 | **PARTIAL** | ✗ map IMPLEMENTED / RF ✓ | Metadata only (`routes.ts:801-829`). The multer 10 MB limit (`79-84`) is not attached to the route. The client posts a fake `storage.example.com` URL (`task-modal.tsx:170`). `DELETE /api/attachments/:id` has **no authorisation** (`routes.ts:831-840`). RF (11,000,000-byte metadata gave 201). |
| T16 | **PARTIAL (broken)** | ✗ / RF ✓ (but evidence missing from the saved transcript) | Only customers are blocked (`routes.ts:384-386`). `deleteTask` (`storage.ts:689-691`) deletes the task row while `task_history`/`task_comments`/`task_attachments` reference it with no `onDelete` (`schema.ts:135,144,156`; no `onDelete` anywhere). Every task has a "created" history row (`storage.ts:483-488`), so **every delete fails with 500**. The saved transcript only shows the customer 403 and staff 401 (unapproved). The "admin 500" claim comes from an unsaved rerun, but the code confirms it. |
| T17 | PARTIAL | ✓ / RF ✓ | History is written (`storage.ts:483-488,673-684,775-780`). There is no per-ticket read route (route list; `/api/tasks/:id/history` falls through to the Vite SPA). Only the global `/api/activity` exists (`routes.ts:731-740`). |
| T18 | IMPLEMENTED | ✓ / NR | Columns at `schema.ts:125-127`, accepted by `insertTaskSchema`. Minor: `dueDate:null` cannot clear a date (`storage.ts:662`). |
| I1 | IMPLEMENTED (external) | ✓ / NR | `routes.ts:230-268` (try/catch; creation continues), `2953-2968`. The UI flow is blocked in practice by T1. `GET …/auto-response` has no ownership check (F12). |
| I2 | **PARTIAL (broken)** | ✗ map IMPLEMENTED / NR | The ≥0.7 branch inserts a comment with `userId:'system'` (`routes.ts:253-257`). `task_comments.user_id` references `users.id` (`schema.ts:136`) and no `system` user exists (grep). The insert hits an FK violation, the error is swallowed (265-268), and **no AI comment is ever added**. Threshold hard-coded. |
| I3 | **PARTIAL** (external) | ✗ / NR | `routes.ts:3553-3603` takes free-text title/description, not a ticket id. "4xx for a missing ticket" cannot happen. |
| I4 | IMPLEMENTED | ✓ / NR | `routes.ts:2971-2984`, `3311-3367`. Generic feedback persisted (runtime 200). Task feedback without an AR gives 500. |
| I5 | IMPLEMENTED (external) | ✓ / NR | `routes.ts:1772-2046`. The response message row carries `sessionId`. History is scoped per user (`storage.ts:1360-1371`). |
| I6 | **MISSING** | ✗ map PARTIAL / RF ✓ | No `/api/admin/ai-settings` or `/test` route (route list). `client/src/pages/ai-settings.tsx:276,317,340` (and 105, 163, 219, 286) call endpoints that do not exist. Only `/api/ai/status` exists (`routes.ts:3649-3669`, not admin-gated). |
| I7 | IMPLEMENTED | ✓ / NR | `routes.ts:3169-3222`, `2069-2087`. RV for the JSON shapes. Page not rendered. |
| I8 | IMPLEMENTED (external) | ✓ / NR | `routes.ts:2126-2207`. Data sources returned 500 without AWS. |
| I9 | IMPLEMENTED (external) | ✓ / NR | `routes.ts:325-334` (non-fatal), `3388-3425`, `3467-3487`. Queueing has no access check. |
| K1 | IMPLEMENTED | ✓ / NR | `routes.ts:3018-3123` (duplicates at 3674-3820 shadowed, except `GET /:id` at 3734). |
| K2 | IMPLEMENTED | ✓ / RV ✓ | `routes.ts:3126-3148` (sets from `isPublished`), search filter at `2996-2997`. |
| K3 | IMPLEMENTED | ✓ / NR | `routes.ts:2989-3015` (parameterised `ilike`). |
| K4 | IMPLEMENTED | ✓ / RV ✓ | `routes.ts:3151-3164`, `3864-3879`. effectivenessScore changed. |
| K5 | IMPLEMENTED (external) | ✓ / NR | `routes.ts:1384-1547`. List, search and read are **anonymous**, not "signed-in" only (counted under Y1). |
| K6 | **PARTIAL** | ✗ / NR | Any authenticated user gets inactive policies with `?includeInactive=true` (`routes.ts:2212`, `storage.ts:1773-1785`), and `/download` serves inactive ones (`2394-2414`). |
| K7 | IMPLEMENTED | ✓ / NR | `routes.ts:1552-1737` (duplicates at 2419-2541). Unpublished guides are listed by default (1566). Guide HTML is rendered raw (`client/src/pages/user-guides.tsx:112,120`); see F15. |
| K8 | IMPLEMENTED (external) | ✓ / RV (anonymous 401) | `routes.ts:116-138`. Caller-chosen `folder` prefix (`s3Service.ts:65`); see F14. |
| E1 | IMPLEMENTED (external) | ✓ / NR | `/api/smtp/test` is real (`routes.ts:1297-1340`). `/api/email/test` is a stub (1209-1227). `GET /api/smtp/settings` returns `awsSecretAccessKey` (1239-1249). |
| E2 | IMPLEMENTED | ✓ / NR (list RV) | `routes.ts:1345-1379`, seeding at `server/index.ts:45-51`. |
| E3 | IMPLEMENTED (external) | ✓ / NR | `routes.ts:2706-2778`, `2563-2621`. Missing `expiresAt` gives 500 (2737). Token from `Math.random` (`storage.ts:1524`). |
| E4 | IMPLEMENTED (external) | ✓ / NR | `routes.ts:270-293`, `336-365`, `2897-2948`. Data leak to user-controlled webhooks: see F7. |
| E5 | **STUB** | ✗ map IMPLEMENTED / NR | The `/ws` server exists (`routes.ts:3492-3550`), but `broadcastToUser`/`broadcastToAll` are **never called** (grep), so no ticket change ever reaches a client. The page uses `mockNotifications` (`client/src/pages/notifications.tsx:23,118`). The socket trusts a client-supplied `userId` (3507-3509). |
| E6 | MISSING | ✓ / — | No inbound handler (grep `inbound\|SNS` gives nothing). |
| G1 | **PARTIAL** | ✗ (the map table says IMPLEMENTED but its section tally counts PARTIAL) / RF (unsaved rerun) | `routes.ts:497-513` has no role check. A plain user can create and becomes team admin (`storage.ts:698-704`). |
| G2 | IMPLEMENTED | ✓ / NR | `routes.ts:515-538`. No customer block. `members` returns full user rows including the password hash (`storage.ts:761`), see Y5. |
| G3 | IMPLEMENTED | ✓ / NR | `routes.ts:541-557` (admin-only). Role value not validated. |
| G4 | IMPLEMENTED | ✓ / NR | `routes.ts:640-672`, `479-495`. |
| G5 | IMPLEMENTED | ✓ / NR | `routes.ts:2624-2685`. Note: `GET /api/admin/departments` (674-687) returns distinct user department strings, not the departments table. |
| G6 | **PARTIAL** | ✗ map IMPLEMENTED / NR | `POST /api/invitations/:token/accept` only marks the invitation accepted (`routes.ts:2808-2833`) and creates no user. After that, a registration finds no pending invitation, so the user becomes an unapproved customer. Auto-approval happens only in `register`, matched **by email without the token** (`auth.ts:193-197`); see F3. |
| G7 | **PARTIAL** | ✗ / NR | Revoke sets `status='cancelled'` (`storage.ts:1584-1589`), but `GET /api/invitations/:token` and `/accept` only reject `accepted` or expired (`routes.ts:2789-2795,2816-2822`). **A revoked token still validates.** |
| D1 | **PARTIAL** | ✗ / NR | `routes.ts:706-718`, `storage.ts:1018-1079`. For staff, the stats scope (own) differs from the list scope (all, Y4). `highPriorityQuery.where()` is called twice, and the second overrides the `priority='high'` filter (`1053-1062`). `on_hold` is not reported. |
| D2 | IMPLEMENTED (function) | ✓ / RV | `routes.ts:731-740`, `storage.ts:1082-1103`, newest first. It is a **global feed shown to every role**: leak, see F8 / Y2. |
| D3 | IMPLEMENTED | ✓ / RV ✓ | `routes.ts:575-588`. Note `urgentTickets` counts `high` (`storage.ts:838`). |
| S1 | **PARTIAL** | ✗ map IMPLEMENTED / RF ✓ | Admin password reset is a **stub**: `storage.resetUserPassword` returns a `Math.random` temp password and never stores it (`storage.ts:1105-1118`). The list exposes password hashes (`routes.ts:567`). |
| S2 | IMPLEMENTED | ✓ / NR | `routes.ts:843-898`. Logo is base64 in JSON, capped by `express.json()`'s default 100 kB (`index.ts:11`). |
| S3 | IMPLEMENTED (with security defects) | ✓ / NR | `routes.ts:900-958`: list omits `keyHash`. Not admin-gated. Keys come from `Math.random` and are stored in plain text as `keyHash` (`storage.ts:1176-1180`). |
| S4 | IMPLEMENTED | ✓ / NR | `routes.ts:3227-3306` (raw `req.body` insert, admin only). |
| S5 | IMPLEMENTED | ✓ / NR | `routes.ts:2090-2123`. |
| S6 | **PARTIAL** | ✗ map IMPLEMENTED / NR (runtime saw empty values) | `GET /api/sso/config` returns the stored row **including `clientSecret` in plain text** (`routes.ts:1122-1123`, `storage.ts:1622-1629`). |
| Y1 | **PARTIAL** | ✗ map IMPLEMENTED / ✗ runtime RV | The four named routes return 401 (RV). But `/api/help`, `/api/help/search` and `/api/help/:id` are anonymous (`routes.ts:1384,1395,1411`), and so is `/api/auth/check-email` (`auth.ts:452-464`, email enumeration). |
| Y2 | **PARTIAL** | ✗ map IMPLEMENTED / runtime NR | Direct GET/PATCH/comment are blocked for customers (RV). These paths leak: `/api/activity` to customers (F8); `DELETE /api/attachments/:id` has no check (`routes.ts:831-840`); `GET /api/tasks/:id/auto-response` has no check (2953-2968); `/api/users` (100-108) and `/api/teams/:id/members` (529-538) are reachable; Teams webhook fan-out sends every ticket (F7); the S3 presign folder is open (F14). |
| Y3 | IMPLEMENTED | ✓ / RV (sample) | Every `/api/admin/*` handler checks `role !== 'admin'` (route list; e.g. `routes.ts:563,578,593`). |
| Y4 | **MISSING** | ✗ map PARTIAL / ✗ runtime ("excluded from normal staff list") | The route sets `filters.userIdFilter` (`routes.ts:161-164`), but `storage.getTasks` ignores it: the key is not in its filter type and has no condition (`storage.ts:538-591`; grep `userIdFilter` finds only routes.ts). So **staff list every ticket**. GET by id (210), PATCH (318), comments (404, 426) and attachments check customers only. Nothing restricts staff. The runtime "excluded from list" claim contradicts the code, and its staff probes in the saved transcript are all 401 (unapproved account). |
| Y5 | **PARTIAL** | ✗ map IMPLEMENTED / RF ✓ | scrypt hash, stored correctly (`auth.ts:42-46`). Full user rows including `password` and `passwordResetToken` are returned by `/api/users` (any role, `routes.ts:100-108,450-458` → `storage.ts:379-381`), `/api/admin/users` (567), team members (`storage.ts:761`), and the admin PATCH/toggle/approve responses (`routes.ts:601,617,633`). RF (hashes in the transcript). |
| Y6 | PARTIAL | ✓ map / NR | Auth limiters are commented out (`security/index.ts:109-113`; the path `/api/auth/password-reset` would not match the real route anyway). The general limiter runs only in production (`index.ts:48,100-102`). Health says `rateLimiting:false` (RV). |
| Y7 | **PARTIAL** | ✗ map IMPLEMENTED / NR | `sanitizeInput` is registered in `applySecurity` (`security/index.ts:95-97`), which runs **before** `express.json()` (`server/index.ts:9` vs `11`), so request bodies are never sanitised (only query strings). Validation gaps as in T2/T10/T12 (RF). React escaping protects ticket/comment rendering. Guide HTML is raw (`user-guides.tsx:112`). |
| Y8 | IMPLEMENTED | ✓ / RV ✓ | Helmet (`security/index.ts:66-89`) plus headers at `validation.ts:407-419`. The CSP allows `'unsafe-inline'` scripts (weak), and the second CSP header overrides Helmet's. |
| Y9 | IMPLEMENTED | ✓ / RV ✓ | `auth.ts:112-123`. The session secret falls back to a hard-coded string (`auth.ts:113`, F5). |
| P1 | **PARTIAL** | ✗ map IMPLEMENTED / RF ✓ | `{message}` shape, not the documented one. 500 on non-numeric ids (PATCH/DELETE/comments). Invalid values give 200. The final error handler re-throws after responding (`server/index.ts:72-77`). Unknown `/api/*` returns 200 HTML in dev. |
| P2 | IMPLEMENTED | ✓ / NR | `client/src/pages/api-docs.tsx` (HTML 200 only). |
| P3 | **PARTIAL** | ✗ map IMPLEMENTED / RF ✓ | The documented create gives 400, delete gives 500, PUT vs PATCH, array vs envelope. |
| M1–M9 | MISSING (9) | ✓ / — | No MCP code or dependency (grep `mcp\|modelcontextprotocol` gives nothing). JWT middleware exists but is not used by any route (needed for M2). |

### Totals (87 IDs)

| Status | Count | % of 87 | % of 78 (excluding new M section) |
|---|---|---|---|
| IMPLEMENTED | 47 | **54.0 %** | 60.3 % |
| PARTIAL | 26 | **29.9 %** | 33.3 % |
| STUB | 2 (A8, E5) | 2.3 % | 2.6 % |
| MISSING | 12 (I6, E6, Y4, M1–M9) | 13.8 % | 3.8 % |

The map claimed 71 / 6 / 0 / 10. **I disagree with it on 28 IDs:** A8, A9, T1, T2, T10, T11, T12, T14, T15, T16, I2, I3, I6, K6, E5, G1, G6, G7, D1, S1, S6, Y1, Y2, Y4, Y5, Y7, P1, P3. Its own tallies also contradict each other: the per-status table says 61/5/10, the per-section table says 71/6/10, and G1 is IMPLEMENTED in the table but PARTIAL in the tally.

**Disagreements with the runtime phase:**
1. Y4: it says staff list "excludes" foreign tickets. The code shows staff see everything.
2. T13: it says FAIL. I count it IMPLEMENTED; the gap is T17's.
3. T14: it says empty comment gives 400. The active handler accepts `""`.
4. Y1: it says RV. I count it PARTIAL (anonymous help routes).
5. Its claim that the "only repository change" was verify.sh is wrong: the gate diff has 4 files.
6. Its staff-dependent results (Y4 200, G1 201, T16 staff/admin 500, T9/T14/T12 staff walk) are **not in any saved artefact**. The transcript shows only the first, unapproved-staff run with 401s, and `PROBE_COUNTS` 57/22 is from that run. The code supports T16/G1/T12, but the evidence trail is incomplete.

---

## 2. Gate check

**Verdict:** gate `20261001T193507Z-4773e8` (runner `gates/5`) on commit `e1de508` (= HEAD of `dc4/gate`): **FAIL**, exit 1, `TESTS[515db053…]: 0 passed, 0 skipped`, `PASS: 8 / FAIL: 7`, locks "all locked files match their approved hashes". Duration 591 s.

**What failed in the gate log:**

| Step | Result | Real cause |
|---|---|---|
| Stack, schema push, health, UI | PASS (log 819-839) | — |
| Workflow probe | FAIL (849-851) | Documented create gave 400 (T1); `resolvedAt not stamped` (T12). Product defects. |
| Auth/anonymous probe | PASS (852-853) | — |
| `npm ci`, lint, typecheck, Jest, Jest JSON | **all FAIL (855-874) without running** | `docker: … error mounting … _deps … to …/repo/node_modules: read-only file system`. `run_node` (`verify.sh:50-55`) mounts a volume **inside** a `:ro` bind mount. That only works locally because an untracked `node_modules/` already exists in the workspace (gitignored, created 2026-10-01 10:53). The gate's clean source tree has none, so Docker cannot create the mount point. **A verify.sh portability defect: in the gate, the test suites never ran at all.** |
| Browser e2e | FAIL (891-906) | No `e2e` script in `package.json`. Honest failure. |

**Builder's claims compared with the gate:**

| Builder claim (runtime report) | Gate / code |
|---|---|
| "PASS: npm ci frozen install", "PASS: 9, FAIL: 6" | Gate: npm ci FAIL, 8/7. Same commit, different environment; the cause is above. The builder's own run was not representative of the gate. |
| verify.sh "fails closed", counts only from the Jest JSON | **True.** `REPORT_VALID` is required for PASS (`verify.sh:29,197-208`). Counts come from `numPassedTests`/`numPendingTests`, with a consistency check. No fabricated counts. |
| Lint/typecheck/Jest fail because of product defects | **Probably true, but not proven by the gate.** The builder's transcript shows `Missing script: "lint"`, hundreds of TS errors, and `module is not defined in ES module scope` at `jest.config.js:1` (`package.json:4` has `"type":"module"`). Also `jest@^30` sits next to `ts-jest@^29` (`package.json:81,103`). |
| The fallback create does not weaken T1 | **True.** `assert(first.status===201)` remains (`verify.sh:153`). |

**Does verify.sh run the full suite without skipping or weakening tests?**
- There is no `--passWithNoTests`, no `testPathIgnorePatterns`, no `.only`/`.skip` added, and no edits to tests or `jest.config.js`. That part is clean.
- **But the comment "Every discovered test runs, including … load, client and server end-to-end suites" (`verify.sh:186-188`) is not accurate.** verify.sh does not set `RUN_E2E_TESTS`, `RUN_LOAD_TESTS` or `RUN_INTEGRATION_TESTS`. The suites `server/__tests__/e2e/user-workflows.test.ts:12,43-44`, `load/performance.test.ts:7,19` and `integration/bedrock-api.test.ts:7,26` turn themselves into `it.skip`. They would show up honestly as skipped, but they would not run. The e2e suite is also hollow: its app and login set-up is commented out (`user-workflows.test.ts:20-28`), so enabling it would not test anything real.
- The probes cover only T1/T12/T9/T14/A2–A4/Y1 for the seeded admin. They do not cover Y2/Y4/Y5/T16/G1. That is acceptable for a gate, but the gate could not catch the security defects below.
- Lock-review items that are still open in the files: `Dockerfile:13` still runs an unpinned `npm install pg @types/pg` (`pg` is not in `package.json`). `Dockerfile:16,22` replace the product `server/db.ts` with `docker/db.ts`, so the system under test is not the shipped DB layer. The manifest of the 25 locked files is not readable from here, so I cannot confirm `docker/db.ts` is in it. The compose file binds fixed host ports 5000/5432 (`docker-compose.yml`), which can collide with concurrent runs.

**Gate conclusion:** the FAIL is genuine and the gate did not report false success. However, it fails partly for the wrong reason: the test suites never executed. Even after the product is fixed, it **cannot pass as written** until (a) `run_node` stops mounting into a read-only tree, and (b) the repo gains a working `lint`, `e2e` and Jest configuration.

---

## 3. Findings (security and correctness, ordered)

| # | Severity | Location | Finding |
|---|---|---|---|
| F1 | **Critical** | `server/seedDefaultAdmin.ts:10-15,52-54`; `server/index.ts:53-59` | An approved admin `admin@ticketflow.local` / `Admin123!` is seeded on every start in **every environment** (no `NODE_ENV` guard), and the password is printed to the log. Any fresh production deployment ships with a known admin login. |
| F2 | **Critical** | `routes.ts:100-108,450-458,529-538,567,601,617,633`; `storage.ts:379-381,761` | Password hashes and reset tokens are returned to any authenticated user, including customers, via `/api/users`, and to others via team members and admin responses. That enables offline cracking and, with a live token, account takeover (Y5). |
| F3 | **Critical** | `server/auth.ts:192-242,266-268` | Invitation privilege escalation. Registration auto-approves and grants the **invited role** to anyone who registers with an invited email, **without the invitation token** and with no email verification. If an admin invites `x@corp` as `admin`, whoever registers `x@corp` first becomes an approved admin. The same branch lets anyone set a password on an existing password-less (SSO) account that has a pending invitation (200-236). |
| F4 | **Critical** | `routes.ts:161-164,194-214,305-323,397-447`; `storage.ts:538-591` | Staff (`user`, `manager`) isolation is absent. `userIdFilter` is dead code, so staff can list, read, update and comment on every customer's tickets (Y4). |
| F5 | High | `server/auth.ts:113`; `security/index.ts:43` | Hard-coded fallback secrets for sessions and JWT. If `SESSION_SECRET` is unset, session cookies can be forged. |
| F6 | High | `server/auth.ts:403-405`; `storage.ts:393-415` | Password reset tokens are logged in plain text and stored unhashed. Log access is enough to take over any account. |
| F7 | High | `routes.ts:270-293,336-365,2856-2868` | Any authenticated user, including a customer, can register a Teams `webhookUrl` with `ticket_created`/`ticket_updated`. Every ticket's title, description and status is then POSTed to that URL. This is a cross-tenant data leak and an SSRF primitive. |
| F8 | High | `routes.ts:731-740`; `storage.ts:1082-1103`; also `/api/stats/global` (720-728) | The global activity feed (ticket titles, old and new values, actor names) is served to customers (Y2). |
| F9 | High | `routes.ts:831-840` | `DELETE /api/attachments/:id` has no ownership or role check, so any user can delete any attachment. |
| F10 | High | `routes.ts:224-228`; `shared/schema.ts:110,321-329` | Primary create is broken (T1). Status and priority have no enum and an empty title is accepted (T2/T10/T12). Customers and staff can also PATCH `createdBy`, `ticketNumber` and `resolvedAt` directly, because the whole insert schema is `.partial()`. |
| F11 | High | `storage.ts:689-691`; `schema.ts:135,144,156` | Ticket delete always fails with an FK violation (500). Non-admin staff are not blocked (T16). |
| F12 | Medium | `routes.ts:2953-2968,3388-3425` | Auto-response read and learning-queue insert have no ticket access check. |
| F13 | Medium | `server/index.ts:9-11`; `security/index.ts:95-97` | Body sanitisation is ineffective because the middleware runs before the body parser. Rate limiting is disabled for auth (`security/index.ts:109-113`) and lockout is not wired (A8), so login brute-force is unthrottled. |
| F14 | Medium | `routes.ts:116-138`; `s3Service.ts:54-79` | Any authenticated user can get a presigned PUT into any S3 prefix (e.g. the help, policy or guide folders that the Bedrock KB syncs), with any content type. This allows knowledge-base poisoning. |
| F15 | Medium | `client/src/pages/user-guides.tsx:112,120`; CSP `'unsafe-inline'` (`security/index.ts:73`, `validation.ts:413`) | Stored XSS through guide HTML (admin-authored), with a CSP that would not stop inline script. |
| F16 | Medium | `routes.ts:1122-1123,1239-1249,1283-1289` | SSO `clientSecret` and SES `awsSecretAccessKey` are returned in plain text to the admin UI (S6). |
| F17 | Medium | `routes.ts:3497-3529` | WebSocket identity is whatever `userId` the client sends. It is latent today because nothing broadcasts (E5), but it becomes an impersonation hole as soon as broadcasting is wired. |
| F18 | Medium | `storage.ts:1176-1180,1524`; `storage.ts:1105-1118` | API keys and invitation tokens come from `Math.random` (predictable), and API keys are stored in plain text. Admin "reset password" is a stub that returns a password that was never saved. |
| F19 | Medium | `routes.ts:253-257`; `schema.ts:136` | AI auto-response comment uses the non-existent user `'system'`. The FK insert fails silently, so I2 never works. |
| F20 | Medium | `routes.ts:2789-2795,2816-2822,2808-2833` | Revoked invitations still validate (G7). The accept endpoint creates no user (G6). |
| F21 | Medium | `microsoftAuth.ts:81,115,146,118-131` | SSO login very likely fails to serialise. SSO users would bypass approval, and the issuer is not validated (A9). |
| F22 | Low | `storage.ts:439-467` | Ticket-number race, and a lexicographic max that breaks at 10,000 tickets per year/prefix. |
| F23 | Low | `storage.ts:1053-1062,838` | Dashboard high-priority count is wrong for non-admins; "urgent" counts `high`. |
| F24 | Low | `server/index.ts:72-77` | Error handler re-throws after sending the response. Non-numeric `:id` returns 500 instead of 400 on PATCH/DELETE/comments/attachments. |
| F25 | Low | `auth.ts:452-464`; `routes.ts:1384-1428` | Anonymous email enumeration and anonymous help-document access (Y1). |
| F26 | Medium (gate) | `scripts/ai/verify.sh:50-55,186-188`; `Dockerfile:13,16,22` | Read-only mount defect stops all suites in the gate. The "every test runs" comment overstates what runs (env-gated `it.skip`). Unpinned `pg` install, and the DB layer is swapped in the image under test. |

---

## 4. Verdict

**Is it done with no issues? No.**

- By ID: **54.0 % IMPLEMENTED** (47/87) and **29.9 % PARTIAL** (26/87). The rest is 2 STUB (2.3 %) and 12 MISSING (13.8 %).
- Excluding the not-yet-started MCP section: **60.3 % IMPLEMENTED, 33.3 % PARTIAL** (of 78).
- If PARTIAL counts as half, about **69.0 %** of the 87.
- The independent gate is **FAIL** (8 pass / 7 fail, 0 tests reported).
- There are **4 Critical** security defects (F1–F4).
- The core customer journey is broken: create gives 400, delete gives 500.

### Remaining work, in order

1. **Fix the Critical security issues.**
   - Gate the default-admin seed to dev only and stop logging its password (F1).
   - Strip `password`, `passwordResetToken` and `passwordResetExpires` from every user response (`/api/users`, admin, team members) (F2).
   - Require the invitation **token** in registration, bound to the email; stop email-only matching and password-setting on SSO accounts (F3).
   - Enforce staff scoping: implement `userIdFilter` in `storage.getTasks`, and add creator/assignee/team checks on GET, PATCH, comments and attachments (F4, Y4).
2. **Repair the ticket core.**
   - Omit `ticketNumber`, `createdBy`, `resolvedAt` and `closedAt` from the client insert/update schemas (T1).
   - Add `.min(1)` on title, and enums for status, priority, category and severity (T2/T10/T12).
   - Stamp `resolvedAt`/`closedAt` on status change (T12).
   - Make delete admin-only and cascade or clean up history, comments and attachments (T16).
   - Reject empty comments in the active handler (T14).
   - Validate numeric ids, returning 400 (T10/P1).
   - Return `assigneeTeamId` and join teams on it (T11).
   - Add `GET /api/tasks/:id/history` (T17/T13).
3. **Close the remaining data-isolation leaks (Y2).**
   - Scope `/api/activity` and `/api/stats/global` by role.
   - Authorise `DELETE /api/attachments/:id`, auto-response read and add-to-learning.
   - Restrict Teams webhooks to admins or validate their targets (F7).
   - Restrict the presign folders (F14).
   - Block `includeInactive` and inactive-policy download for non-admins (K6).
   - Require auth on `/api/help*` (Y1).
4. **Fix auth hardening.**
   - Re-enable the auth and password-reset rate limiters (Y6).
   - Wire lockout into the LocalStrategy (A8).
   - Remove the fallback secrets (F5).
   - Stop logging reset tokens and hash them (F6).
   - Use `crypto.randomBytes` for API keys and invitation tokens, and hash API keys (F18).
   - Move `sanitizeInput` after `express.json()` (Y7).
   - Re-check `isActive` on each request (A5).
5. **Finish the PARTIAL and STUB features.**
   - Admin user password reset must actually store the password (S1).
   - Revoke must invalidate tokens; accept must create an approved user (G7/G6).
   - Role gate on `POST /api/teams` (G1).
   - Mask the SSO and SES secrets (S6/F16).
   - The AI comment needs a real system user or a nullable author (I2).
   - Look up `analyze-ticket` by ticket id (I3).
   - Fix dashboard stats parity and counts (D1).
   - Enforce the attachment size limit and real upload (T15).
   - Broadcast WS events with session-authenticated sockets and a live notifications page (E5/F17).
   - Fix SSO serialisation and approval (A9).
6. **Build what is missing.**
   - Admin AI settings API: threshold, switch, test (I6).
   - Inbound email to ticket (E6).
   - Then the MCP server and its tools M1–M9 on the shared storage and authorisation layer, with JWT/session auth (M2).
7. **Make the repository testable, and the gate able to pass.**
   - Add `lint` and `e2e` scripts and a pinned Playwright spec.
   - Rename `jest.config.js` to `jest.config.cjs` (or ESM) and align `ts-jest` with `jest`.
   - Fix the TS errors.
   - Give `user-workflows.test.ts` a real app.
   - In verify.sh, stop mounting `node_modules` inside the `:ro` tree (for example, copy the source into a writable volume) and correct the "every test runs" claim.
   - Pin `pg` in `package.json` and the lockfile.
   - Then re-lock and re-run the gate.
8. **Update the docs to match the code** (PUT vs PATCH, list envelope, `{message}` error shape, bcrypt vs scrypt), or the other way round (P1/P3).

---

## SUMMARY
1. Not done: 47/87 IMPLEMENTED (54.0 %), 26 PARTIAL (29.9 %), 2 STUB, 12 MISSING (all MCP plus I6, E6 and Y4); about 69.0 % if PARTIAL counts as half.
2. The independent gate e1de508 is a genuine FAIL (8/7, 0 tests), but verify.sh's read-only `node_modules` mount stopped every test suite from running in the gate.
3. Four Critical security defects: a seeded `Admin123!` admin in every environment, password hashes exposed to all users, invitation-role takeover by email alone, and no staff ticket isolation (`userIdFilter` is dead code).
4. The core ticket flow is broken: documented create gives 400 (`ticketNumber` required), every delete gives 500 (FK), and status, priority and title are not validated or timestamped.
5. I disagree with the map on 28 IDs and with the runtime phase on Y4, Y1, T13, T14 and the scope of changed files; several runtime staff results are not in the saved transcript.
