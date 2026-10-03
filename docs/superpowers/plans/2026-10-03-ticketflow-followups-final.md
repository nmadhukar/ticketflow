# TicketFlow Final Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close every follow-up the fix program (2026-10-02) and the follow-ups round (2026-10-03) left open. Each item is fixed, or closed with a recorded ruling. No line in release-notes sections 5 and 6 stays "open". Then the work lands on `main`.

**Architecture:** Branch `fix/followups-final-2026-10-03` from `main` at fbffc94 (the merged follow-ups round, PR #3). Tasks FF1 to FF6 run in parallel git worktrees, each with its own test database. They then merge here, in the order FFZ gives. After the full gate and a final review, the branch lands on `main` through a PR merged by the DeepSeek Harness GitHub App (`app/madhukar-dsh-autopilot`), sha-pinned, as in rounds 1 and 2.

**Tech Stack:** TypeScript ESM, Express 4, React/Vite, drizzle-orm (node-postgres) with drizzle-kit 0.30, passport sessions, zod, ws, Jest + supertest, Playwright 1.63, Docker.

**Sources (binding), all read at fbffc94:**
- `docs/ticketflow-fix-program-release-notes.md`: section 5 "Follow-ups" (every subsection, and the "Still open after FU2" and "Still open" paragraphs) and section 6 "Follow-ups round", including "Left open on purpose". Cited below as `RN:L<line>`.
- Ledger 1, `.superpowers/sdd/2026-10-01-ticketflow-fix-program/progress.md`: the lines that say "deferred" or "parked". Cited as `L1:<line>`.
- Ledger 2, `.superpowers/sdd/2026-10-03-ticketflow-followups/progress.md`: the Deferred, Final-batch, follow-up and residual lines. It has no "Owner note" lines. Cited as `L2:<line>`.
- `docs/dc4-validation-2026-10-01/requirements-status-after-fixes.md`: the "Gap or external part" caveat on each row. Cited as `REQ:<id>`.

## Owner decisions
- 2026-10-03: "complete all the follow ups too", then "git push remote and some how get it into main".
- Standing: auto-approved, no waiting. The planner decides owner questions with the rulings below.
- Earlier decisions still hold:
  - role `user` is an agent;
  - agent scope is own tickets, plus the team queue, plus teammates;
  - staff close; staff and the creating customer reopen;
  - duplicate email on register stays 400 `email_registered`;
  - e2e is limited to core flows (owner decision of 2026-10-02).

## Global Constraints
- Same as the fix program (`docs/superpowers/plans/2026-10-01-ticketflow-fix-program.md`, lines 21-31) and the follow-ups round (`docs/superpowers/plans/2026-10-03-ticketflow-followups.md`, Global Constraints):
  - Stage explicit paths only. Never `git add -A` or `git add .`.
  - Never edit an applied migration. New migrations continue after `0020`. Check the highest number in `migrations/` first. Every migration must be idempotent.
  - No secrets in commits.
  - Error contract `{error, message, details?}`.
  - Closed status and priority sets.
  - No secret user fields in responses.
  - No new runtime dependencies without a ruling. This plan adds none, and R44 is explicitly dependency-free.
- Production applies the schema with `db:migrate-sql` and then `drizzle-kit push` (R10, R32). Every schema change goes in `shared/schema.ts`, plus an idempotent SQL file.
  - A column the running code needs also goes into `REQUIRED_TABLES` in `server/startup/schemaCheck.ts`.
  - `server/__tests__/integration/schemaSafety.test.ts:92` applies every 0007+ file twice. A new migration must pass it.
- Never stage `API_Documentation.md` or `API_DOCUMENTATION.md`; they collide on Windows. The main checkout has an unrelated local edit in `API_DOCUMENTATION.md`. Leave it alone.
- Reserved migration numbers: `0021` belongs to FF3 (R48), `0022` to FF1 (R53), and `0023` to FF5 (R50, only if the push fix needs a database-side change). No other task creates a migration.
- Release notes are written ONLY by FFZ: no FF task edits `docs/ticketflow-fix-program-release-notes.md`. The round-2 tasks all edited it and conflicted at every merge.
  - Each task records its user-visible changes, env and deploy notes in its report.
  - FF tasks document new environment variables only in `.env.example` and `docker-compose.yml` (pass-through, no value), plus a code comment.
  - FFZ updates README, DEVELOPER_DOCUMENTATION and the release notes in one pass.
- TDD: write each fix's test first and run it red against the old code. Record the failing output in the report. A test that cannot fail before the fix (a pure coverage test) says so.
- Worktrees: `../ticketflow-wt/ffN`, on branch `wt/ffN` from the plan commit. Each uses its own database, `ticketflow_test_ffN`, set through `TEST_DATABASE_URL`. A task that runs e2e uses its own `E2E_PORT`: FF5 uses 5081 and FF6 uses 5086.
  - Do not reuse the old `wt/fu*` or `wt/final` branches, or the stale `../ticketflow-wt/fu0` directory.
- Every task ends green, each command run on its own, with the last runs after the final edit:
  - `npm run check`;
  - `npx eslint .` (0 errors);
  - `npx jest --runInBand`;
  - the unit project with no DB env (`DATABASE_URL` and `TEST_DATABASE_URL` removed);
  - `npm run build` when server or client code changed;
  - then ONE commit with the message the task gives. Nothing is pushed.
- Report: `.superpowers/sdd/2026-10-03-ticketflow-followups-2/task-FFn-report.md`. One row per item: what was done, the test, and the red-first evidence. Then the verification output lines, and any concern.

## Rulings

Owner questions (binding as given):
- **R41.** A user's `phone` is visible to admins, managers and the user themself. Agents and customers never see another user's phone. This is applied through the one viewer projection (`projectUserForViewer` / `utils/publicUser.ts`).
- **R42.** SSO sign-ups take their role from `SSO_DEFAULT_ROLE` (`customer` or `agent`, default `customer`). They stay pending approval (`isApproved=false`), for every role, as today. An invalid value is logged once and falls back to `customer`. The role is set only when the account is created, never on a later SSO login. docker-compose passes it through.
- **R43.** The invitation "department" field does nothing: users have no department link, and access is team-based. It is removed from the invitation API, the invitation UI and the invitation email. A `departmentId` in the create body is ignored (stripped), so old clients still work. Responses no longer carry it. The `user_invitations.department_id` column stays (it is never written; no destructive migration).
- **R44.** Close the Teams webhook DNS-rebinding window with no new dependency. Send through `https.request` with a custom `lookup` that resolves the name, validates EVERY resolved address with the existing private, loopback and link-local checks, and pins the connection to the validated address. TLS still verifies the hostname (`servername`). The lookup handles Node's `all: true` form (autoSelectFamily).
- **R45.** Manager stats include the tickets the manager created or is assigned. This is the same visibility as `/api/stats` (`ticketVisibilityWhere` for the manager). Department blocks stay "tickets queued to the department's teams" and say so.
- **R46.** The inbound-email dedupe "done" mark is written in the same transaction as the ticket or comment insert. The ticket-number retry uses a SAVEPOINT inside that transaction (a drizzle nested transaction). If that proves impossible, the report records exactly why, with the failing evidence.
- **R47.** MCP tool ids accept numeric strings ("12" becomes 12). Non-numeric values stay a coded `VALIDATION` error. `limit` and `offset` accept numbers or numeric strings, and anything else is a coded `VALIDATION` with `fieldErrors`.
- **R48.** New column `ticket_auto_responses.applied_at` (nullable timestamp; migration 0021 and the schema).
  - It is set when a response is applied and cleared when an apply is undone.
  - `ticketsResolvedByAI` and similar analytics use it, and fall back to the old rule for legacy rows (NULL `applied_at`).
  - This fixes the second-draft over-count.
- **R49.** `TRUST_PROXY_HOPS` (an integer of 0 or more, default 1) sets Express `trust proxy`, in one place. An invalid value is logged once and falls back to 1. It goes into compose and the docs: with Coolify/Traefik in front of nginx, set 2.
- **R50.** `drizzle-kit push` is idempotent. Fix `shared/schema.ts` so push stops re-applying two things on every deploy: the `unique_team_admin` drop/add and the `'{}'` array defaults. Prove it in a scratch database: push twice, and show that the second push has no changes.
- **R51.** Realtime stops reading users on every event and stops running a UNION per 200 sockets.
  - Eligible users are cached for at most 1 s, keyed by the connected user set.
  - Each event runs one visibility query.
  - The cache is invalidated when a user is disconnected or approved.
  - The correctness tests stay.
- **R52.** Defaults and limits:
  - the general per-IP `/api` limit default rises to 600 per 15 minutes (still `RATE_LIMIT_MAX_REQUESTS`);
  - the inbound-email header cap becomes `INBOUND_EMAIL_MAX_HEADER_BYTES` (default 65536, max 262144; junk, 0 or over the max logs once and uses the default);
  - the MCP list limit stays 100, as decided: models page with `hasMore`. This is recorded as DECIDED, not open.
- **R53.** The login failure counter decays: it restarts at 1 when the lockout window (15 minutes) has passed since the last failure. A new column, `users.last_failed_login_at` (migration 0022), is never sent to clients. A NULL (legacy row) counts as today.
- **R54.** Gate and test-tooling leftovers:
  - the gate step that logs "JWT_SECRET is not set; using an insecure development default" gets the gate's generated secrets;
  - the `e2e/no-egress.cjs` bracket-strip regex becomes `/^\[|\]$/g`, with egress tests for an empty, an unparsable and a portless DATABASE_URL, and for an IPv6 host;
  - `split2`'s stale `dev: true` in the lockfile (already fixed at fbffc94; FF5 verifies it);
  - the bootGuard app-root detection uses the module path, not cwd.

Planner decisions (fixes):
- **R55.** `setupAuth` tracks every session store it creates, and `closeAuth` closes them all. A second `setupAuth` no longer leaks a pool (L1:47).
- **R56.** The security access log (`security/middleware.ts:225,244`) and the default key of `createCustomRateLimit` (`security/rateLimiting.ts:327`) read the session user's `id` (falling back to `userId`). The same defect was fixed only in `rbac.ts:59` (RN:L506).
- **R57.** The placeholder-secret test builds its sample list from the repository's tracked files (every `SESSION_SECRET` / `JWT_SECRET` example value), so a new doc sample is checked automatically (L2:30, "hardcoded sample list").
- **R58.** Email providers whose adapter is not implemented (SMTP, Mailgun, SendGrid, Custom) can no longer be selected.
  - Saving one answers 400 `provider_not_supported` with `fieldErrors.provider`, and the settings UI shows them as unavailable.
  - Implementing any of them needs a client library, which is a new dependency, so none is implemented.
  - This closes "a blank SMTP password simply stores none" (RN:L494-495).
- **R59.** `storage.getTasks` is deleted. Only tests called it (one query per row). The ticket detail query's `lastUpdatedBy` gives the same answer as the list for a deleted or missing user: no "Support agent" (RN:L522, RN:L530).
- **R60.** MCP write audits record the request's IP. The channel stays `mcp` (RN:L532).
- **R61.** `storage.createTeam` inserts only the team. `POST /api/teams` adds the creator's membership itself, in the same transaction, after the R12 check. A future caller of `createTeam` grants nothing (RN:L542).
- **R62.** The dead, unlocked `storage.toggleUserStatus` is deleted. The route flips inside the locked transaction (L2:24).
- **R63.** Service and storage code logs a caught error as the key or id plus the error type and code (`logRouteError` / `safeErrorSummary`), never the message or the object. A sweep test enforces this outside `server/seed/**` and the startup handler in `server/index.ts` (RN:L527, L1:171).
- **R64.** `autoResponseCommentExists` filters in SQL with bound parameters (prefix and suffix compare, no LIKE pattern from data) instead of loading every AI comment (L2:16).
- **R65.** An inbound `From` whose display name is exactly its address (quoted or not, case-insensitive) is accepted. Every other `@` in a display name, and every backslash, is still refused (RN:L543).
- **R66.** The production `Dockerfile` CMD runs the same sequence as compose: `npm run db:migrate-sql && npm run db:push && node dist/index.js`. A Dockerfile-only deploy (Coolify) then migrates too. A unit test keeps the two identical (RN:L424-425).
- **R67.** The bootGuard wiring is proven on the built bundle. A gate step runs the gate image's `node dist/index.js` with `NODE_ENV` empty and cwd `/`, and expects exit 1 and the "Refusing to start" line (L2:15).
- **R68.** Every requirement caveat whose subject is an API behaviour gets a test (the list is in FF1 and FF6). Two defects found while checking:
  - `POST /api/admin/users/:id/approve` for an unknown id answered 200 with an empty body. It becomes 404 `user_not_found`.
  - The `/api-docs` page lists only list, create and update. It gains get, comment and delete.

Planner decisions (closed, no code change):
- **R69.** Startup stays fail-fast (M8). A transient database error in a required startup step restarts the container until the database answers. A system-user email clash is logged and left to the owner (the query is in section 5): auto-merging accounts is unsafe (RN:L417-423).
- **R70.** Session-revocation residuals stay as they are, with their reasons:
  - the changer's own in-flight request can save old stamps, which fails closed;
  - the `authAt` clock skew can only touch sessions created before `pwdAt` existed (they expire within 7 days of the deploy), and it fails closed;
  - rate-limit and bearer-failure counters are per process: production runs one container, and a shared store would need Redis, an external service.
  - Sources: RN:L493-494, RN:L507, RN:L679-680.
- **R71.** `--runInBand` stays global. The integration suites share one database (reason at `jest.config.mjs:3`) (RN:L496, RN:L499).
- **R72.** An `ADMIN_EMAIL` that already belongs to a non-admin is only logged. Startup never promotes an existing account (RN:L502).
- **R73.** The placeholder rule refusing a real secret that starts with "todo" or "example" is accepted. A random secret never does, and refusing is the safe direction (L2:30).
- **R74.** 403 for an existing ticket outside scope and 404 for a missing one stay. That is the documented contract (T4, Y4) for REST and MCP alike (RN:L522, RN:L552).
- **R75.** A malformed id is 400 before authentication (401). It reveals nothing beyond the route table, which is public (RN:L523).
- **R76.** On PATCH, `assigneeId: ""` stays "absent" and `null` clears. The client clears with `null`, and the task modal sends `""` for an untouched field (`task-modal/index.tsx:261`), so treating `""` as a clear would unassign tickets by accident (RN:L525).
- **R77.** The triaged create keeps one primary-key lookup of the triage team. That lookup is what lets a deleted team fall back to "unassigned" instead of an FK error, and it runs only for customer and emailed tickets with no assignee (L2:38).
- **R78.** `GET /api/teams/:id` (name, description, department) stays readable by all staff as directory data. The member list (people) keeps the narrower agent and manager rule (RN:L677-678).
- **R79.** Legacy non-admin Teams webhook rows keep delivering by ticket access, which is the tested fan-out rule. Cleaning them up is an owner action, and FFZ puts the listing query in the release notes (L1:196).
- **R80.** The lockfile resync of Task 1 dropped packages that were never declared in `package.json` (`passport-azure-ad` and others). There is nothing to restore (RN:L466).
- **R81.** Requirement caveats about a UI page render are closed under the owner's 2026-10-02 decision (e2e limited to core flows). The API behaviour under each page is proven. Rows: T5 (Tasks page), T6, T9, I5 (chat widget), I7 (AI Analytics page), K3, K7, E5, G2, D1.
- **R82.** Requirement caveats about a live external service are closed as external: SES, Entra, Bedrock, S3 and Teams. The application side is tested with fakes. Rows: A6, A9 (live), E1, E3 (delivery), E4, E6, I1, I2, I3, I5, I6, I8, I9 (live model), K8, S6, T15 (live bucket).
- **R83.** Requirement caveats that restate a binding contract stay as they are:
  - T5: the REST list is a bare array;
  - Y6: 10 per minute with `too_many_requests` (M4);
  - P1: no `requestId`;
  - M2: MCP takes an API key only;
  - S4: the rules are inert (R23);
  - Y9: `Secure` follows `COOKIE_SECURE`, a deploy input;
  - K4: `/rate` and `/feedback` have no client, and the routes are kept and tested.

Existing rulings that close items: R23 (escalation is client-only), R29 (7-day JWTs are not bearers), R37 (line-ending and whitespace churn), R52 (MCP limit), and the binding "duplicate email is 400".

## Item ledger

Every open item, its verdict and its owner. **FIX** = a task fixes it. **DECIDED** = closed by a ruling. **ALREADY FIXED** = verified at fbffc94, with evidence.

### Follow-up items (sections 5 and 6, ledgers)

| # | Source | Item | Verdict | Ruling | Task |
|---|---|---|---|---|---|
| N01 | RN:L415-416, L431-432, L448-449 | General per-IP /api limit 100 per 15 min | FIX | R52 | FF4 |
| N02 | RN:L422-423 | Transient DB error in a required step restarts the container | DECIDED | R69 | FFZ |
| N03 | RN:L424-425 | Dockerfile CMD alone runs no schema steps (Coolify) | FIX | R66 | FF5 |
| N04 | RN:L451-454 | A future non-idempotent migration would fail every deploy | ALREADY FIXED: `schemaSafety.test.ts:43,92` runs the real script over `migrations/` twice | | |
| N05 | RN:L461-463, L474-475, L503, L506 | CRLF and whitespace churn | DECIDED | R37 | |
| N06 | RN:L466 | Lockfile resync dropped never-declared packages | DECIDED | R80 | |
| N07 | RN:L478 | Playwright trace records test passwords | ALREADY FIXED: `playwright.config.ts:23-30` per-run random passwords on a throwaway DB; `.gitignore:50` | | |
| N08 | RN:L491, L499 | `phone` visible to every agent | FIX | R41 | FF1 |
| N09 | RN:L492, L501, L675 | `invitation.departmentId` never applied | FIX | R43 | FF1 |
| N10 | RN:L493, L502 | Failure counter does not decay | FIX | R53 | FF1 |
| N11 | RN:L493-494, L507 | Changer's in-flight request saves old stamps | DECIDED | R70 | |
| N12 | RN:L494, L507 | Multi-instance clock skew | DECIDED | R70 | |
| N13 | RN:L494-495, L510 | SMTP adapter not implemented; blank password stores none | FIX | R58 | FF1 |
| N14 | RN:L495-496, L502 | `trust proxy 1` assumes one proxy | FIX | R49 | FF4 |
| N15 | RN:L496, L505, L673-674 | SSO sign-ups default to customer | FIX | R42 | FF1 |
| N16 | RN:L496-497, L499 | `--runInBand` global | DECIDED | R71 | |
| N17 | RN:L497-498, L509 | `generateTokens` 7-day JWTs cannot be bearers | DECIDED | R29 | |
| N18 | RN:L502 | `ADMIN_EMAIL` collision only logged | DECIDED | R72 | |
| N19 | L1:47 | `closeAuth` keeps one store reference (pool leak) | FIX | R55 | FF1 |
| N20 | RN:L506 (residual) | Audit and limiter read `req.user?.userId` in `security/middleware.ts:225,244`, `rateLimiting.ts:327` | FIX | R56 | FF4 |
| N21 | L2:30 | Secrets test sample list is hard-coded | FIX | R57 | FF1 |
| N22 | L2:30 | 'todo'/'example' prefix false positive | DECIDED | R73 | |
| N23 | L2:30 | SES symmetric guard (stored secret + env key id) | ALREADY FIXED: `server/services/ses/index.ts:42` | | |
| N24 | RN:L520-521, L528, L672 | Manager stats exclude own created/assigned | FIX | R45 | FF2 |
| N25 | RN:L522 | `getTasks` per-row lookups (tests only) | FIX | R59 | FF2 |
| N26 | RN:L522, L552 | `get_ticket` FORBIDDEN discloses existence | DECIDED | R74 | |
| N27 | RN:L523 | Anonymous bad id is 400 before 401 | DECIDED | R75 | |
| N28 | RN:L525 | PATCH `assigneeId ""` reads as absent | DECIDED | R76 | |
| N29 | RN:L530 | `lastUpdatedBy` "Support agent" for missing users (`storage/index.ts:622-629`) | FIX | R59 | FF2 |
| N30 | RN:L532 | MCP audit `ip='mcp'` (`mcp/tools.ts:27`) | FIX | R60 | FF2 |
| N31 | L2:24 | Triage team deleted after startup gives an FK 500 | ALREADY FIXED: `services/tickets/triage.ts:52-58` | | |
| N32 | L2:24 | toggle-status reads `isActive` outside the lock | ALREADY FIXED: `routes/index.ts:940-946` (`flipActive` inside the locked transaction) | | |
| N33 | L2:24 (residual) | Dead unlocked `storage.toggleUserStatus` (`storage/index.ts:1641`) | FIX | R62 | FF2 |
| N34 | L2:38 | Per-create triage team lookup | DECIDED | R77 | |
| N35 | RN:L527, L1:171 | `deleteTask` and S3 code log error text and objects | FIX | R63 | FF2 |
| N36 | RN:L537 | `ESCALATION_ACTIVE` client-only | DECIDED | R23 | |
| N37 | L2:16 | Second-draft over-count in `ticketsResolvedByAI` | FIX | R48 | FF3 |
| N38 | L2:16 | Numeric-string MCP id rejected | FIX | R47 | FF2 |
| N39 | L2:16 | `autoResponseComment` filters in JS | FIX | R64 | FF3 |
| N40 | L2:16 | Analytics matches the comment prefix | FIX | R48 | FF3 |
| N41 | RN:L541 | Per-event users read and UNION per 200 sockets | FIX | R51 | FF4 |
| N42 | RN:L541 | `secureAuth.ts` dead module | ALREADY FIXED: deleted in FU2, absent at fbffc94 | | |
| N43 | RN:L542, L667-668 | DNS-rebinding window on Teams webhooks | FIX | R44 | FF4 |
| N44 | RN:L542 | `createTeam` inserts the creator as a member/admin | FIX | R61 | FF2 |
| N45 | RN:L542 | Team routes return `{message}` without `error` | ALREADY FIXED: `routes/teams.ts` answers through `fail()` / `HttpError` (e.g. :184, :264); `unit/errorContractSweep.test.ts` | | |
| N46 | RN:L543 | Display names with `@` or backslash refused | FIX | R65 | FF3 |
| N47 | RN:L543 | Fenced-out late holder only logs | FIX | R46 | FF3 |
| N48 | RN:L543, L670-671 | Done mark separate from the create | FIX | R46 | FF3 |
| N49 | RN:L543, L669 | 64 KB inbound header cap | FIX | R52 | FF3 |
| N50 | RN:L549 | `NODE_ENV` unset in other entry points | ALREADY FIXED: `server/bootGuard.ts:8-16` (the built server refuses; `npm run dev` is development by design) | | |
| N51 | RN:L552, L681 | MCP list limit 100 vs REST 500 | DECIDED | R52 | |
| N52 | L1:295, RN:L552 | MCP `limit`/`offset` non-numeric give an SDK plain-text error (`mcp/tools.ts:85-86`) | FIX | R47 | FF2 |
| N53 | RN:L676 | Duplicate email on register stays 400 | DECIDED | binding | |
| N54 | RN:L677-678 | Team detail for staff skips the `/members` rules | DECIDED | R78 | |
| N55 | RN:L679-680 | Per-instance lockout/limiter counters | DECIDED | R70 | |
| N56 | L2:15 | `split2` stale dev flag in the lockfile | ALREADY FIXED: `package-lock.json:17051` has no `dev` flag (FF5 verifies `npm ci --omit=dev`) | R54 | FF5 (verify) |
| N57 | L2:15 | bootGuard wiring untested | FIX | R67 | FF5 |
| N58 | L2:15 | Guard skipped when cwd is not the app root | FIX | R54 | FF5 |
| N59 | L2:28 | `verify.sh` must require `numPassedTests>0 && numFailedTests==0` | ALREADY FIXED: `scripts/ai/verify.sh:247` | | |
| N60 | L2:28 | Gate tree copy must exclude `.env*` | ALREADY FIXED: `scripts/ai/verify.sh:91` | | |
| N61 | L2:38 | no-egress bracket-strip regex is a no-op (`e2e/no-egress.cjs:20,28`) | FIX | R54 | FF5 |
| N62 | L2:38 | Egress test lacks empty/unparsable/no-port cases | FIX | R54 | FF5 |
| N63 | L2:39 | Gate log: "JWT_SECRET is not set; using an insecure development default" | FIX | R54 | FF5 |
| N64 | L1:196 | Legacy non-admin webhook rows still deliver | DECIDED | R79 | FFZ (query) |
| N65 | RN:L526, L1:160 | `updateTask` history loop logs null/0 via `\|\|` | ALREADY FIXED: `storage/index.ts:965-969` (`asHistoryValue`) | | |
| N66 | ruling R50 | push re-applies `unique_team_admin` and `'{}'` defaults | FIX | R50 | FF5 |
| N67 | RN:L417-421 | System-user email clash leaves rows unattributed | DECIDED | R69 | |

### Requirement caveats (`requirements-status-after-fixes.md`)

| # | Row | Caveat | Verdict | Ruling | Task |
|---|---|---|---|---|---|
| C01 | A1 | No single test registers, is approved and logs in | FIX | R68 | FF6 |
| C02 | A2 | Cookie flags not asserted | ALREADY FIXED: `session.logout.test.ts:70`, `session.cookieSecure.test.ts` (Y9) | | |
| C03 | A5 | Re-activation and approve then login not tested | FIX | R68 | FF1 |
| C04 | A6 | Real email delivery | DECIDED | R82 | |
| C05 | A9 | SSO callback never run by a test (live Entra: R82) | FIX | R68 | FF1 |
| C06 | T3 | Prefix change not tested | ALREADY FIXED: `companySettings.tickets.test.ts:34` | | |
| C07 | T5 | Tasks page; list is a bare array | DECIDED | R81, R83 | |
| C08 | T6 | UI filter parity | DECIDED | R81 | |
| C09 | T9 | My Tasks page | DECIDED | R81 | |
| C10 | T15 | Upload and listing (ALREADY FIXED: `attachments.s3.test.ts:60,74`); file-size limit untested; live S3 (R82) | FIX (size) | R68 | FF6 |
| C11 | I1 | Saved complexity score not asserted (live Bedrock: R82) | FIX | R68 | FF6 |
| C12 | I2, I3 | Bedrock mocked | DECIDED | R82 | |
| C13 | I5 | Chat widget render; live Bedrock | DECIDED | R81, R82 | |
| C14 | I6 | Live connection | DECIDED | R82 | |
| C15 | I7 | `/api/bedrock/usage/summary` untested (page: R81) | FIX | R68 | FF6 |
| C16 | I8 | Live KB/S3 sync | DECIDED | R82 | |
| C17 | I9 | `/api/admin/learning-queue/process` not run (live: R82) | FIX | R68 | FF6 |
| C18 | K1 | `DELETE /api/admin/knowledge/:id` untested | FIX | R68 | FF6 |
| C19 | K3 | Knowledge Base page | DECIDED | R81 | |
| C20 | K4 | `/rate` and `/feedback` have no client | DECIDED | R83 | |
| C21 | K5 | Help-document admin upload/edit/delete untested (S3 faked; live: R82) | FIX | R68 | FF6 |
| C22 | K6 | Policy admin create/toggle/delete untested (S3 faked) | FIX | R68 | FF6 |
| C23 | K7 | User Guides page | DECIDED | R81 | |
| C24 | K8 | Live bucket | DECIDED | R82 | |
| C25 | E1 | Real delivery | DECIDED | R82 | |
| C26 | E2 | Template list and first-start seeding untested | FIX | R68 | FF6 |
| C27 | E3 | `POST /api/admin/invitations/:id/resend` untested (email: R82) | FIX | R68 | FF6 |
| C28 | E4 | Real Teams post | DECIDED | R82 | |
| C29 | E5 | Notifications page | DECIDED | R81 | |
| C30 | E6 | Real SES delivery | DECIDED | R82 | |
| C31 | G1 | Department manager creating a team and `GET /api/teams` untested | FIX | R68 | FF6 |
| C32 | G2 | Team Detail page | DECIDED | R81 | |
| C33 | G4 | `GET /api/teams/my` reflecting a change untested | FIX | R68 | FF6 |
| C34 | G7 | Admin invitation list with statuses not asserted | FIX | R68 | FF6 |
| C35 | D1 | Dashboard tiles | DECIDED | R81 | |
| C36 | D2 | `/api/activity` limit and newest-first order not asserted | FIX | R68 | FF6 |
| C37 | S1 | Approve route not tested directly (and an unknown id answers 200) | FIX | R68 | FF1 |
| C38 | S4 | Stored rules inert | DECIDED | R83 | |
| C39 | S6 | `POST /api/sso/test` calls Microsoft | DECIDED | R82 | |
| C40 | Y1 | Anonymous `/api/teams`, `/api/admin/users`, `/api/knowledge/search` not each asserted | FIX | R68 | FF6 |
| C41 | Y5 | scrypt hash not asserted | FIX | R68 | FF6 |
| C42 | Y6 | Wording differs from the code | DECIDED | R83 | |
| C43 | Y7 | No browser renders a markup title | FIX | R68 | FF6 |
| C44 | Y8 | `X-Content-Type-Options`, `X-Frame-Options`, `GET /api/security/health` not asserted | FIX | R68 | FF6 |
| C45 | Y9 | `Secure` is a deploy input | DECIDED | R83 | |
| C46 | P1 | No `requestId` | DECIDED | R83 | |
| C47 | P2 | `/api-docs` lists only list, create, update | FIX | R68 | FF6 |
| C48 | M2 | MCP key-only | DECIDED | R83 | |
| C49 | M5 | MCP limit 100 | DECIDED | R52 | |
| C50 | M6 | History parity with the REST update not asserted | FIX | R68 | FF6 |

Totals: 58 FIX (35 follow-up, 23 caveat); 45 DECIDED (20 follow-up, 25 caveat); 14 ALREADY FIXED (12 follow-up, 2 caveat). Total 117.

Lines in section 5 that the FU2/FU3/FU4 RESOLVED notes already close are not re-listed. They were spot-checked: `rbac.ts:59`, `utils/apiPath.ts`, `secureAuth.ts` absent, `ses/index.ts:36-42`, `storage/index.ts:965`.

---

## Parallel layout and merge overlaps

| Task | Area | Main files |
|---|---|---|
| FF1 | Accounts, SSO, invitations, lockout, email providers | `utils/publicUser.ts`, `routes/index.ts` (user and invitation handlers), `routes/teams.ts` (member/admin projection), `services/tickets/ticketService.ts:196`, `services/auth/microsoftAuth.ts`, `services/auth/index.ts` (closeAuth, login claim), `services/auth/lockout.ts`, `storage/index.ts:177-234`, `shared/schema.ts` (users), `migrations/0022_*.sql`, `startup/schemaCheck.ts`, `admin/companySettings.ts` (provider validation), client `invitations.tsx`, `EmailTab.tsx` |
| FF2 | Tickets, stats, MCP, teams, error logging | `storage/index.ts` (getManagerStats, getTasks removal, taskDetailQuery, createTeam, toggleUserStatus, deleteTask log), `storage/storage.inteface.ts`, `routes/index.ts` (`/api/stats/manager`), `routes/teams.ts` (`POST /api/teams`), `mcp/tools.ts`, `mcp/router.ts`, `services/s3Service.ts`, `admin/companySettings.ts:53,313`, `admin/aiSettings.ts:46`, `services/auth/index.ts:408,595`, `utils/systemUser.ts:55` |
| FF3 | AI analytics, inbound email | `shared/schema.ts` (ticket_auto_responses), `migrations/0021_*.sql`, `startup/schemaCheck.ts`, `services/ai/aiAutoResponse.ts`, `createTimeAutoResponse.ts`, `autoResponseComment.ts`, `routes/index.ts` (apply route ~3820-3870, ai-analytics ~4884-4905), `routes/email.ts`, `services/email/inbound.ts`, `services/email/mime.ts`, `services/tickets/create.ts`, `storage/index.ts:472-560, 1400-1416` (tx parameter), `storage/storage.inteface.ts` |
| FF4 | Realtime, Teams webhooks, proxy, limits, security logs | `realtime/ws.ts`, `permissions/ticketAccess.ts`, `services/webhookGuard.ts`, `services/teamsNotifications.ts`, `server/index.ts:19`, `services/auth/index.ts:263-266`, `security/rateLimiting.ts`, `security/middleware.ts`, new `server/startup/proxy.ts` (or similar) |
| FF5 | Schema push idempotency, deploy image, gate, tooling | `shared/schema.ts` (team_admins, array defaults), maybe `migrations/0023_*.sql`, `Dockerfile`, `scripts/ai/verify.sh`, `e2e/no-egress.cjs`, `server/bootGuard.ts`, `server/env.ts`, `unit/toolingConfig.test.ts`, `integration/schemaSafety.test.ts` |
| FF6 | Requirement-caveat coverage | new test files under `server/__tests__/integration/`, `client/src/pages/api-docs.tsx`, `client/src/__tests__/apiDocs.test.tsx`, `e2e/tickets.spec.ts`, `docs/dc4-validation-2026-10-01/requirements-status-after-fixes.md` |

Expected overlaps (different hunks; resolve by keeping both sides):
- `shared/schema.ts`: FF1 (users), FF3 (ticket_auto_responses), FF5 (team_admins and array defaults). R50's two-push proof is re-run after the merge (FFZ).
- `server/startup/schemaCheck.ts`: FF1 and FF3 add adjacent `REQUIRED_TABLES` entries, so a textual conflict is likely. Keep both.
- `docker-compose.yml` and `.env.example`: FF1 (`SSO_DEFAULT_ROLE`), FF3 (`INBOUND_EMAIL_MAX_HEADER_BYTES`), FF4 (`TRUST_PROXY_HOPS`, the `RATE_LIMIT_MAX_REQUESTS` default). Keep all of them.
- `server/routes/index.ts`: FF1, FF2 and FF3 each touch different handlers.
- `server/storage/index.ts` and `storage.inteface.ts`: FF1 (login claim), FF2 (stats, teams, getTasks, toggle, logs), FF3 (createTask tx).
- `server/services/auth/index.ts`: FF1 (closeAuth, login), FF2 (two log lines), FF4 (trust proxy lines).
- `server/routes/teams.ts`: FF1 (members/admins projection), FF2 (`POST /api/teams`).
- `server/admin/companySettings.ts`: FF1 (provider validation ~:415-450), FF2 (log lines :53, :313).
- Only FF5 edits `schemaSafety.test.ts`. FF1 and FF3 put their migration tests in new files.

---

### Task FF1: Accounts, SSO, invitations, lockout and email providers

Worktree `../ticketflow-wt/ff1`, branch `wt/ff1`, DB `ticketflow_test_ff1`. Migration number: **0022**.

Items:
1. **N08, R41: phone visibility** (RN:L491, RN:L499).
   - Change `projectUserForViewer` to take the viewer `{id, role}`:
     - admin and manager get `toPublicUser` (with `phone`);
     - the user themself gets their own row with `phone`;
     - an agent gets `toPublicUser` without `phone`;
     - a customer or unknown role keeps `CUSTOMER_VISIBLE_USER_FIELDS`.
   - Route EVERY response that carries another user through it. Start from `grep publicUserColumns|PublicUser` and the endpoints in `users.secrets.test.ts`:
     - `/api/users` and the `forTeamMemberSelection` picker;
     - `/api/admin/users` and its PATCH, approve and toggle answers;
     - `/api/teams/:id/members` and `/admins` (`user`, `grantedByUser`);
     - `/api/teams/:id/tasks/:taskId/assignments` (`assignedUser`, `assignedByUser`);
     - `/api/tasks/:id/comments` and `/history`;
     - MCP `get_ticket` comments (`ticketService.ts:196`);
     - any user list inside `/api/stats/manager`.
   - `/api/auth/user` keeps the caller's own phone.
   - Test: new `integration/users.phone.test.ts`. Seed staff with phones, then check each endpoint:
     - as an agent: no other user object has a `phone` key, but the agent's own row does;
     - as a manager and as an admin: `phone` is present;
     - as a customer: never.
     - Run it red first.
   - Update `unit/viewerProjection.test.ts` for the new signature.
2. **N09, R43: invitation department removed** (RN:L492, RN:L501).
   - The invitation create and update schema drops `departmentId` (strip, not 400).
   - Nothing writes `user_invitations.department_id`.
   - `GET /api/invitations/:token` (`routes/index.ts:3506-3510`) and the admin list stop returning it.
   - The invitation emails (`routes/index.ts` ~2791 and ~3337) stop loading a department. A stored template's `{{department}}` renders empty, never as a literal.
   - Client `client/src/pages/admin/UsersGroups/invitations.tsx`: remove the department field (:49, :90, :111-113, :464) and the department column (:293).
   - Test: `integration/invitations.department.test.ts`. A create carrying `departmentId` is 201 with `department_id` NULL in the database, the responses have no `departmentId`, and the rendered email has no department text. Red first.
3. **N10, R53: lockout decay** (RN:L493, RN:L502).
   - Migration `migrations/0022_users_last_failed_login.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at timestamp;` (idempotent).
   - Schema: `lastFailedLoginAt: timestamp("last_failed_login_at")`.
   - `claimLoginAttempt` (`storage/index.ts:208`) restarts the count at 1 when `last_failed_login_at <= now - LOCKOUT_MINUTES`. It keeps the expired-lock rule, and sets `last_failed_login_at = now` on every claim. NULL counts as today.
   - `resetFailedLogins` clears it.
   - Add `last_failed_login_at` to the users entry of `REQUIRED_TABLES`.
   - Rewrite the "Accepted" comment in `services/auth/lockout.ts`.
   - Tests, in `integration/login.decay.test.ts`, red first:
     - 4 misses, then a miss 16 minutes later (passing `now`), gives attempt 1 and no lock;
     - 5 misses within the window still lock;
     - a legacy row (count 4, NULL stamp) locks on the next miss;
     - the column is never in any response (extend the "never returns the lockout columns" check);
     - 0022 applies twice on a pushed database. `schemaSafety`'s twice-run covers this once the file exists; also assert it in the new test file.
   - Deploy note for FFZ: add `last_failed_login_at` to the drift query's users column list.
4. **N15, R42 and C05 (A9): SSO default role and the callback test** (RN:L496, RN:L505).
   - Parse `SSO_DEFAULT_ROLE` once (`customer` | `agent`, default `customer`). An invalid value gives one `console.error` line and `customer`.
   - In `microsoftAuth.ts:259-267`, a NEW account gets that role, with `isApproved=false`. An existing account's role and approval are never touched by a later SSO login: `storage.upsertUser` sets `...userData` on conflict, so either pass the role only for the insert or use a dedicated insert-or-update.
   - Compose: `SSO_DEFAULT_ROLE: ${SSO_DEFAULT_ROLE:-}`. Add it to `.env.example`.
   - Test: `integration/sso.callback.test.ts`, with MSAL's `acquireTokenByCode` faked and a crafted id token. This is the first test that runs the callback. Cases:
     - unset: customer, unapproved, redirected to the pending answer;
     - `agent`: agent, unapproved;
     - `admin` or junk: one log line, customer;
     - an existing agent signing in again keeps their role;
     - the AI system email is still refused.
     - Red first for `agent`.
5. **N19, R55: closeAuth tracks every store** (L1:47).
   - A module-level `Set` of stores: `setupAuth` adds to it, and `closeAuth` closes and clears all of them.
   - Test: `unit/closeAuth.test.ts` (or integration) calls `setupAuth` on two apps, then `closeAuth`, and asserts both stores closed (spy). Red first.
6. **N21, R57: secrets samples from the repo** (L2:30).
   - In `secrets.failclosed.test`, collect `SESSION_SECRET` / `JWT_SECRET` example values from tracked files (`git ls-files` for `*.md`, `*.example`, `docker-compose*.yml`, `*.env*`).
   - Skip `${...}` and empty values.
   - Assert that production refuses each value, and on failure name the file and line.
   - Keep the explicit dev fallbacks.
7. **N13, R58: unimplemented email providers** (RN:L494-495, RN:L510).
   - `PATCH`/`POST /api/company-settings/email` with provider `smtp`, `mailgun`, `sendgrid` or `custom` answers 400 `provider_not_supported`, with `fieldErrors.provider`, and stores nothing.
   - `EmailTab.tsx:246-257` shows those options disabled, with "(not available)".
   - An existing stored row of that kind still reads back, and sending through it still logs "not implemented".
   - Test: extend `companySettings.email.test.ts`: each of the four is 400, and AWS and Mailtrap still save. Red first.
8. **C03 and C37 (A5, S1): approve and re-activate, then log in** (REQ:A5, REQ:S1).
   - `POST /api/admin/users/:userId/approve` for an unknown id is 404 `user_not_found` (`routes/index.ts:956-975`; it answered 200 with an empty body).
   - Test: `integration/users.approve.test.ts`:
     - a pending user is refused login, an admin approves, and login succeeds;
     - deactivate, then the login is refused; re-activate through toggle-status, then login succeeds;
     - an unknown id is 404 (red first);
     - a non-admin is 403.

Files: the ones listed in the parallel layout table for FF1. Docs: `API_ENDPOINTS_REFERENCE.md` and the Postman collection only if they show an invitation `departmentId` or an email provider value (`contract.docs.test` must stay green).

Commit: `fix(accounts): phone visibility, SSO default role, invitation department removed, lockout decay, email providers`.

### Task FF2: Tickets, stats, MCP, teams and error logging

Worktree `../ticketflow-wt/ff2`, branch `wt/ff2`, DB `ticketflow_test_ff2`. No migration.

Items:
1. **N24, R45: manager stats** (RN:L520-521, RN:L528, RN:L672).
   - `getManagerStats` (`storage/index.ts:3243`) gains:
     - `totalTickets`, plus `priorityDistribution` and `categoryBreakdown` computed over `ticketVisibilityWhere({id, role: "manager"})`, the `/api/stats` scope;
     - a `personal` block, `{assignedToMe, createdByMe}`.
   - The `department` and `teamPerformance` blocks stay team-queue based, with a comment that says so.
   - Test: extend `integration/stats.test.ts`. A manager with these tickets:
     - (a) created by them, in another department;
     - (b) assigned to them;
     - (c) queued to their department's team;
     - (d) assigned to a member of that team;
     - (e) unrelated.
   - Assert that `totalTickets`, the priority sum and the category sum equal `GET /api/stats` total for that manager (a+b+c+d), that (e) is excluded, and that `personal` is correct. Red first.
2. **N25 and N29, R59: getTasks removed; lastUpdatedBy** (RN:L522, RN:L530).
   - Delete `storage.getTasks` (`storage/index.ts:774-893`) and its interface entry.
   - `integration/storage.test.ts:27` and `tickets.workflow.test.ts:300` use `getVisibleTasksForUser` as an admin.
   - `taskDetailQuery` `lastUpdatedBy` (`:622-629`) uses the list's rule: no name for a missing user, `''` when there is none, and tie order `created_at DESC, id DESC`.
   - Test: a ticket whose last history row's user is deleted (or NULL). `GET /api/tasks/:id` `lastUpdatedBy` equals the list row's, and neither is "Support agent". Red first.
3. **N30, R60: MCP audit IP** (RN:L532).
   - Thread the request IP from `mcp/router.ts` into the tool context (`mcp/tools.ts:27`), in place of `ip: "mcp"`. `channel: "mcp"` stays.
   - Test: an audited MCP write (or status refusal) logs the caller's IP. Red first.
4. **N38 and N52, R47: MCP ids, limit and offset** (L2:16, L1:295, RN:L552).
   - A string matching `^[1-9][0-9]{0,9}$` and at most 2147483647 is that number.
   - Anything else stays `VALIDATION` with `fieldErrors.<field>`: `"abc"`, `"1.5"`, `""`, `" 12"`, `0`, `-1`, `1.5`.
   - `limit` and `offset` (`mcp/tools.ts:85-86`) accept a number or a numeric string. Out of range or non-numeric is `VALIDATION`, with `fieldErrors.limit` or `fieldErrors.offset` (limit 1..100, offset ≥ 0).
   - Update the tool descriptions.
   - Tests, in the MCP suites:
     - `"12"` gives the same result as `12`, on `get_ticket`, `update_ticket` and `add_comment`;
     - the invalid list is `VALIDATION`;
     - `list_tickets {limit:"10"}` works;
     - `{limit:"abc"}` and `{offset:"x"}` are `VALIDATION`.
     - The FU4 test that expected `"12"` to be refused is updated. Red first.
5. **N44, R61: createTeam membership** (RN:L542).
   - `storage.createTeam` (`storage/index.ts:1066`) inserts only the team.
   - `POST /api/teams` (`routes/teams.ts:166-210`) inserts the team and then the creator's member row (`role: "admin"`, as today) in ONE `db.transaction`.
   - Test: `storage.createTeam` alone leaves 0 `team_members` rows (red first). POST by an admin and by the department's manager still makes them a member. An agent's POST is 403 and writes nothing.
6. **N33, R62: dead toggleUserStatus** (L2:24).
   - Delete `storage.toggleUserStatus` (`storage/index.ts:1641-1659`) and its interface entry. First grep to confirm there are no callers.
   - Test: `npm run check`; the existing toggle-status tests stay green.
7. **N35, R63: error logs carry type, not text** (RN:L527, L1:171).
   - These lines log the key or id plus `safeErrorSummary` / `logRouteError`, never the message or the object:
     - `storage/index.ts:1030-1040` (S3 after a delete);
     - `services/s3Service.ts:185, 236, 267, 333, 430, 472`;
     - `admin/companySettings.ts:53, 313`;
     - `admin/aiSettings.ts:46`;
     - `services/auth/index.ts:408, 595`;
     - `utils/systemUser.ts:55`;
     - `storage/index.ts:1884`.
   - Update `tickets.delete.test.ts` "a failing S3 delete is logged (key and message, no Error object)" to "key and error type, no message".
   - New `unit/rawErrorLogSweep.test.ts`. It scans `server/**/*.ts`, skipping comments, `server/__tests__/**`, `server/seed/**` and the startup handler in `server/index.ts` (named with the reason), for `console.(error|warn)(…, <identifier>)` where the identifier is a caught error. It fails, listing file:line. Red first (it lists today's 14 sites).

Files: as in the parallel layout table for FF2. Docs: `API_ENDPOINTS_REFERENCE.md` (manager stats fields, MCP id and limit wording) and `server/mcp` tool descriptions.

Commit: `fix(tickets): manager stats scope, MCP id/limit coercion and audit IP, team creation, error logs`.

### Task FF3: AI analytics and inbound email

Worktree `../ticketflow-wt/ff3`, branch `wt/ff3`, DB `ticketflow_test_ff3`. Migration number: **0021**.

Items:
1. **N37 and N40, R48: applied_at** (L2:16).
   - Migration `migrations/0021_ticket_auto_responses_applied_at.sql`: `ALTER TABLE ticket_auto_responses ADD COLUMN IF NOT EXISTS applied_at timestamp;`. No backfill.
   - Schema: `appliedAt: timestamp("applied_at")`.
   - Add `ticket_auto_responses: ["applied_at"]` to `REQUIRED_TABLES`.
   - Set `applied_at`:
     - `aiAutoResponseService.setApplied(id, true)` (`aiAutoResponse.ts:336`) sets `now()`, and `false` clears it;
     - the apply route's conditional update (`routes/index.ts` ~3842) sets it, and the undo (~3866) clears it;
     - the "alreadyApplied" path that finds an existing AI comment sets it to that comment's `created_at`.
   - `ticketsResolvedByAI` (`routes/index.ts:4889-4905`): `GREATEST(resolvedAt, closedAt) >= COALESCE(applied_at, <the old comment/createdAt rule>)`.
   - Tests, in `integration/ai.appliedAt.test.ts`:
     - the over-count case: the old rule takes the EARLIEST AI comment created after a draft's `createdAt`, so a later-applied draft can borrow another draft's earlier comment. Seed draft A (unapplied, but its comment posted before the resolve) and draft B (created before A's comment, applied AFTER the resolve). Old rule: counted. New rule: not counted. Red first;
     - a normal applied-before-resolve case is counted;
     - a legacy row (NULL `applied_at`) still follows the old rule;
     - apply sets it and undo clears it;
     - 0021 applies twice.
2. **N39, R64: SQL filter for the AI comment** (L2:16).
   - `autoResponseCommentExists` (`autoResponseComment.ts:20-27`) selects with `left(content, len(PREFIX)) = PREFIX AND right(content, len(tail)) = tail` (bound parameters) and `LIMIT 1`.
   - Test: the existing "comment written but setApplied failing" tests stay green. Add a response containing `%`, `_` and `'`, which matches only itself.
3. **N48 and N47, R46: done mark in the same transaction** (RN:L543, RN:L670-671).
   - `storage.createTask`, `getNextTicketNumber` and `addTaskComment` (`storage/index.ts:472-560`, `:1400`) take an optional `tx`.
   - With a `tx`, the counter bump and the insert run on it, and the number-clash retry runs inside `tx.transaction(...)`, which is a SAVEPOINT.
   - `createTicketRecord` (`services/tickets/create.ts`) passes the `tx` through, history included.
   - `routes/email.ts:175-220` / `services/email/inbound.ts` run the insert plus `markMessageDone` in one `db.transaction`. If the claim is no longer this holder's, throw inside the transaction: it rolls back, and the fenced-out holder leaves NOTHING (this fixes N47). Side effects (AI, realtime, Teams) still run after the commit.
   - REST creates are unchanged (no `tx`).
   - Replace the comment at `routes/email.ts:204-211`.
   - Tests, in `integration/email.inbound.tx.test.ts`, red first where possible:
     - (a) a forced throw after the insert and before the mark leaves no ticket and a released claim; the retry creates exactly one;
     - (b) a claim taken over before the mark rolls back: no ticket, no duplicate;
     - (c) a pre-existing ticket holding the next number forces a 23505; the savepoint retry succeeds and the mark is committed;
     - (d) the same three for a reply (comment).
   - If R46 proves impossible, record the exact reason with the failing evidence, and keep the fence.
4. **N46, R65: display name equal to the address** (RN:L543).
   - In `parseSingleMailbox` (`mime.ts:245-332`), when there is a `<...>` and the display text, or a quoted string, contains `@`: accept it only when the trimmed display text is the angle address, case-insensitively.
   - Every other `@`, and every backslash, is refused as today. Update the header comment.
   - Tests, in `unit/inboundMime.test.ts`:
     - accepted: `"a@b.com" <a@b.com>`, `a@b.com <a@b.com>`, `"A@B.com" <a@b.com>`;
     - refused: `"x@y.com" <a@b.com>` and `a@b.com <c@d.com>`;
     - backslash cases are still refused.
     - Red first.
5. **N49, R52: header cap** (RN:L543, RN:L669).
   - `MAX_HEADER_BLOCK` (`mime.ts:33`, also :344, :366) comes from `INBOUND_EMAIL_MAX_HEADER_BYTES`: a positive integer up to 262144, default 65536. Junk, 0 or a value over the max logs one line and uses the default.
   - Check that the inbound route's body limit and `snsVerify.ts:113` (a different 64 KB limit; say what it bounds) do not refuse first.
   - Compose: `INBOUND_EMAIL_MAX_HEADER_BYTES: ${INBOUND_EMAIL_MAX_HEADER_BYTES:-}`. Add it to `.env.example`.
   - Tests:
     - a 100 KB header block is refused by default and accepted with `131072`;
     - `300000` and `abc` give one log line and the default.

Files: as in the parallel layout table for FF3.

Commit: `fix(integrations): AI applied_at analytics, inbound done mark in the create transaction, display names, header cap`.

### Task FF4: Realtime, Teams webhooks, proxy and limits

Worktree `../ticketflow-wt/ff4`, branch `wt/ff4`, DB `ticketflow_test_ff4`. No migration.

Items:
1. **N41, R51: realtime cache and one visibility query** (RN:L541).
   - `currentlyEligibleUsers` (`realtime/ws.ts:196-232`) keeps its result for at most 1000 ms. The cache key is the connected user set: sorted user ids plus their session stamps.
   - The cache is invalidated by `disconnectUser`, by approve (which disconnects with 1012) and by any change to the connection set.
   - Replace `usersWhoCanAccessTask` (`permissions/ticketAccess.ts:81-92`, a UNION ALL per 200) with ONE set-based query. Pass the eligible `(id, role)` pairs as arrays, use `unnest($ids::text[], $roles::text[])`, and apply the rule written against those columns. That rule must be the same rule as `ticketVisibilityWhere`.
   - `notifyStaff` uses the cache too.
   - Tests:
     - all of `integration/realtime.test.ts` stays green;
     - a parity test over the isolation-matrix fixtures: for every role and ticket, the set-based query agrees with `canAccessTask`;
     - a burst of 10 events within 1 s performs one users read (count queries with a pool `query` spy);
     - one event with 250 connected sockets runs exactly one visibility query (red first);
     - a user deactivated through the admin API is still closed at once.
2. **N43, R44: pinned webhook connections** (RN:L542, RN:L667-668).
   - `postWebhookJson` (`services/webhookGuard.ts:130`) sends with `https.request`, using:
     - `lookup(hostname, options, cb)`, which resolves with `dns.lookup(..., {all: true})`, refuses when ANY address `isPrivateAddress`, and answers with the validated address. It honours `options.all` (array form) for Node's autoSelectFamily;
     - `servername: hostname`, so TLS checks the certificate against the name.
   - Keep the existing behaviour: no redirects followed, a timeout, a bounded response read, `true` only on 2xx. Rewrite the `webhookGuard.ts:16-20` comment.
   - Tests:
     - `unit/webhookGuard.test.ts`: a lookup returning [public, private] refuses; [public] pins that address; `all: true` returns an array; the request options carry `lookup` and `servername` (`https.request` mocked);
     - `integration/teamsWebhook.test.ts`, adapted from mocking `fetch` to mocking the sender or `https.request`. "a private DNS answer blocks the call and the ticket still saves" stays.
     - Red first for the pin.
3. **N14, R49: TRUST_PROXY_HOPS** (RN:L495-496, RN:L502).
   - One parser reads `TRUST_PROXY_HOPS`: an integer of 0 or more, default 1. Junk or a negative value logs one line and uses 1.
   - It is applied once, in `server/index.ts:19`. Remove the duplicate `app.set("trust proxy", 1)` at `services/auth/index.ts:263-266`, and keep its comment at the new place.
   - `attachRealtime` keeps `trustProxy: Boolean(app.get("trust proxy"))`.
   - Compose: `TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-1}`. Add it to `.env.example`, with "2 behind Coolify/Traefik plus nginx".
   - Tests:
     - unit parser cases: unset gives 1; `"2"` gives 2; `"0"` gives 0; `"-1"` and `"x"` give 1 and one log line;
     - integration: with 2, `req.ip` is the second-to-last `X-Forwarded-For` entry and the auth limiter keys on it; with 0, `X-Forwarded-For` is ignored and the WebSocket does not trust `x-forwarded-host`.
4. **N01, R52: general limit 600** (RN:L415-416, RN:L431-432, RN:L448-449).
   - `rateLimiting.ts:24-28` default becomes 600. Update compose (`${RATE_LIMIT_MAX_REQUESTS:-600}`), `.env.example:89` and `unit/rateLimits.test.ts`, then add "unset is 600". Red first.
5. **N20, R56: security log and limiter key** (RN:L506 residual).
   - `security/middleware.ts:225,244` and the default `keyGenerator` of `createCustomRateLimit` (`rateLimiting.ts:327`) use `user.id ?? user.userId`.
   - Tests:
     - the SECURITY_ACCESS line for a session admin carries the admin's id (red first);
     - a custom limiter with no `keyGenerator` keys two session users on one IP separately.

Files: as in the parallel layout table for FF4.

Commit: `fix(realtime,webhooks): cached eligibility and one visibility query, pinned webhook DNS, TRUST_PROXY_HOPS, limit 600`.

### Task FF5: Schema push idempotency, deploy image, gate and tooling

Worktree `../ticketflow-wt/ff5`, branch `wt/ff5`, DB `ticketflow_test_ff5`, `E2E_PORT=5081`. Migration number: **0023**, created only if R50 needs a database-side change.

Items:
1. **N66, R50: push idempotent**.
   - Reproduce first. In a scratch database, run `npm run db:migrate-sql` and then `npx drizzle-kit push --verbose --force` twice. Capture the second push's SQL: today it re-issues the `unique_team_admin` DROP/ADD (`shared/schema.ts:165`) and array `DEFAULT '{}'` statements (`:341` api_keys.permissions, `:437` email_templates.variables, `:746` notification_types, and any others it prints).
   - Fix the declarations so they match what Postgres stores, for example ``.default(sql`'{}'::text[]`)`` and the constraint's declared form and column order. Prefer schema-only changes.
   - If a database object has to change form, write `0023` (idempotent) and add it to the twice-run.
   - Proof, in the report: the second push's output says no changes.
   - Regression test in `integration/schemaSafety.test.ts`: push the schema, push again, and assert the second run applies nothing (drizzle-kit 0.30 prints "No changes detected"; assert on that, or on the absence of SQL in `--verbose` output).
2. **N63, R54: gate secrets**.
   - In `scripts/ai/verify.sh`, the containers that `in_tree` starts get `SESSION_SECRET="$GATE_SESSION_SECRET"` and `JWT_SECRET="$GATE_JWT_SECRET"`. Today `-e SESSION_SECRET -e JWT_SECRET` forwards host variables that are unset (`:90`).
   - Find which step printed the warning, from the gate log.
   - Proof: a full `verify.sh` run whose log has zero "insecure development default" lines and ends `RESULT: PASS`.
3. **N61 and N62, R54: no-egress regex and tests**.
   - `e2e/no-egress.cjs:20,28`: change `/^[|]$/g` to `/^\[|\]$/g`.
   - Loading with an empty DATABASE_URL, an unparsable one or a portless one must not throw: allow loopback only, the given host on 5432, and the given host on 5432 respectively.
   - Tests, in `unit/toolingConfig.test.ts`: those three cases, plus `postgresql://u:p@[fd00::1]:6543/db`, which allows exactly `[fd00::1]:6543` and refuses `[fd00::1]:5432`. Red first for IPv6.
4. **N58, R54: bootGuard uses the module path**.
   - `server/bootGuard.ts:8-12` takes the dist directory from the module's own location, not `process.cwd()`: `import.meta.dirname` when it is named `dist`, and otherwise no dist (under tsx it is `server/`).
   - Adjust `unsetNodeEnvBootProblem` (`server/env.ts:18-30`) to match.
   - Tests:
     - unit: cwd elsewhere and the module in `<root>/dist` refuses; the module in `server/` passes;
     - the existing spawn test (`unit/sanitizeHtml.test.ts:192`) stays green.
5. **N57, R67: bootGuard wiring proven on the bundle**.
   - New `verify.sh` step after STEP 1: `compose run --rm --no-deps -T -e NODE_ENV= -w / app node <app dir>/dist/index.js`. It expects exit 1 and the line `Refusing to start: NODE_ENV is not set`. Read `docker/gate/Dockerfile.gate` for the app directory.
   - It is counted as an `ok`/`bad` step.
6. **N03, R66: Dockerfile CMD**.
   - The `Dockerfile` CMD becomes `["sh", "-c", "npm run db:migrate-sql && npm run db:push && node dist/index.js"]`. Rewrite the comment above it: the same sequence as compose, and the R32 drift check still applies.
   - `docker/gate/Dockerfile.gate` is untouched (R39).
   - Test: `unit/toolingConfig.test.ts` asserts that the Dockerfile CMD and the `docker-compose.yml` app `command` run the same three steps in the same order.
   - Manual proof, in the report: build the image, run it with no command override against a fresh scratch database, and show the logs (`sql-migrations`, push, `serving on port 5000`).
7. **N56, R54: split2 (verify only)**.
   - In a scratch copy: `npm ci --omit=dev`, then `node -e "require('pg'); require('split2')"` succeeds.
   - Record it in the report. Edit the lockfile only if it fails.

Also run `npm run e2e` (port 5081) and one full `scripts/ai/verify.sh`.

Commit: `chore(deploy): idempotent drizzle push, Dockerfile runs schema steps, gate secrets and bootGuard proof, egress guard fixes`.

### Task FF6: Requirement-caveat coverage and the status document

Worktree `../ticketflow-wt/ff6`, branch `wt/ff6`, DB `ticketflow_test_ff6`, `E2E_PORT=5086`. No migration.

Write each test against fbffc94 behaviour. Do not assert anything FF1-FF5 change:
- no `departmentId` on invitations;
- no `phone` assertions;
- no `"12"`-id MCP cases;
- POST `/api/teams` keeps the creator as a member.

If a test finds a defect, fix it at the narrowest place. Then check the file list for overlap with FF1-FF5, and name the overlap in the report.

Items (REQ row: test):
1. **C01, A1**: register, admin approves, login succeeds; before approval, the login is refused (`integration/accounts.e2e.test.ts`).
2. **C10, T15**: an attachment over the configured size limit is refused with the documented status and stores nothing (S3 faked).
3. **C11, I1**: creating a ticket with Bedrock faked stores the complexity score row (`ticket_complexity_scores`) with the faked values.
4. **C15, I7**: `GET /api/bedrock/usage/summary` is admin-only and sums the recorded usage.
5. **C17, I9**: `POST /api/admin/learning-queue/process`, with 5 resolved tickets and Bedrock faked, processes the queue and stores the learned pattern or article. It is admin-only.
6. **C18, K1**: `DELETE /api/admin/knowledge/:id`: admin 200 and the row is gone; non-admin 403; unknown 404.
7. **C21, K5**: help-document admin upload, edit and delete with S3 faked; non-admin 403.
8. **C22, K6**: policy admin create, toggle and delete with S3 faked; non-admin 403.
9. **C26, E2**: `GET` email templates lists the seeded defaults after a first start (run the seeder on an empty table); admin-only.
10. **C27, E3**: `POST /api/admin/invitations/:id/resend` re-sends (email adapter faked) a pending invitation, refuses an accepted or cancelled one, and is admin-only.
11. **C31, G1**: the manager of department D creates a team in D (201) and not in another department (403); `GET /api/teams` lists it.
12. **C33, G4**: after an admin adds or removes a member, that member's `GET /api/teams/my` reflects it.
13. **C34, G7**: the admin invitation list shows pending, accepted, cancelled and expired statuses correctly.
14. **C36, D2**: `/api/activity?limit=N` returns at most N rows, newest first.
15. **C40, Y1**: anonymous `GET /api/teams`, `/api/admin/users` and `/api/knowledge/search` are each 401 in the error contract.
16. **C41, Y5**: a stored password hash is the scrypt format the code writes (salt and hash parts of the expected lengths), never bcrypt or plaintext.
17. **C44, Y8**: responses carry `X-Content-Type-Options: nosniff` and the `X-Frame-Options` value the server sets, and `GET /api/security/health` answers its documented shape.
18. **C50, M6**: an MCP `update_ticket` writes the same history entries (field, old value, new value) as the equivalent REST PATCH.
19. **C47, P2**: the `client/src/pages/api-docs.tsx` Tasks section also documents get (`GET /api/tasks/:id`), comment (`POST /api/tasks/:id/comments`) and delete (`DELETE /api/tasks/:id`, admin). Extend `client/src/__tests__/apiDocs.test.tsx`. Red first.
20. **C43, Y7**: in `e2e/tickets.spec.ts`, a ticket titled `<img src=x onerror=alert(1)><script>x</script>` renders as literal text on the detail and list pages, and no CSP violation or dialog occurs.

Then update `docs/dc4-validation-2026-10-01/requirements-status-after-fixes.md`:
- every caveat that a test now covers names that test;
- every DECIDED caveat names its ruling (R81, R82, R83, R52);
- the already-fixed caveats (A2, T3, T15 upload/listing) name their tests;
- the summary and notes stay true.

C03, C37 and C05 belong to FF1; FFZ adds their test names to the doc after the merge.

Run `npm run e2e` (port 5086) as well.

Commit: `test: cover the remaining requirement caveats`.

### Task FFZ: Merge, gate, release notes, final review and landing

1. **Merge** into `fix/followups-final-2026-10-03` with `git merge --no-ff wt/ffN`, in this order: FF5, FF4, FF2, FF1, FF3, FF6.
   - Resolve each overlap listed above by keeping both sides.
   - After each merge, run `npm run check` and the merged task's focused suites.
   - After FF1 and FF3, check that `REQUIRED_TABLES` has both new columns and that `schemaSafety.test.ts` passes.
   - Run `git status` before every stage, and stage explicit paths only.
2. **R50 re-proof** on the merged schema (0021 and 0022 add columns): scratch database, migrate-sql, push twice, and the second push shows no changes.
3. **Full gate** in a clean worktree of HEAD (build the commit, not the tree), after `npm ci`:
   - `npm run check`;
   - `npx eslint .` (0 errors);
   - `npx jest --runInBand`;
   - the unit project with no DB env;
   - `npm run build`;
   - `npm run e2e`;
   - `scripts/ai/verify.sh`, which must end `RESULT: PASS` with a `TESTS[...]` line equal to the Jest totals, and whose log has zero "insecure development default" lines.
   - Record each command's last lines in the ledger.
4. **Release notes**: add section 7, "Final follow-ups round (2026-10-03)", to `docs/ticketflow-fix-program-release-notes.md`. It holds:
   - rulings R41-R83, one line each;
   - the behaviour changes from the six reports;
   - new and changed environment: `SSO_DEFAULT_ROLE`, `TRUST_PROXY_HOPS` (set 2 behind Coolify/Traefik plus nginx), `INBOUND_EMAIL_MAX_HEADER_BYTES`, and the `RATE_LIMIT_MAX_REQUESTS` default of 600;
   - migrations 0021, 0022 (and 0023 if FF5 created it);
   - deploy checks:
     - the drift query adds `last_failed_login_at`;
     - the Dockerfile CMD now runs the schema steps;
     - the R79 query that lists legacy non-admin webhook rows: `SELECT s.user_id, u.role, s.enabled FROM teams_integration_settings s JOIN users u ON u.id = s.user_id WHERE u.role <> 'admin' AND s.webhook_url IS NOT NULL;`, with the cleanup `UPDATE teams_integration_settings SET enabled = false WHERE user_id IN (...)`.
   - Then:
     - mark EVERY section-5 and section-6 line RESOLVED (FFn) or DECIDED (Rnn), using the item ledger above. That includes the "Still open after FU2" and "Still open" paragraphs, and the section-6 "Left open on purpose" list, which becomes "Closed in the final round" with each entry's verdict;
     - update section 2 owner actions 9 (SSO role) and 13 (lockout);
     - update README and DEVELOPER_DOCUMENTATION env tables in one pass;
     - fill in the FF1 test names (C03, C05, C37) in the requirements status doc.
   - Do not stage `API_DOCUMENTATION.md`.
5. **Final review** on the most capable model (opus) over `fbffc94..HEAD`, with these rulings and the item ledger as the spec. Run fix rounds until the verdict is "Ready to merge: Yes". Re-run the gate if code changed.
6. **Secret scan** of the added lines (`git diff fbffc94..HEAD`) for AKIA, private keys, `sk-`, `ghp_`, `ghs_`, `xox`, `sk-or`, `AIza` and `tfk_` patterns, and real-looking passwords.
7. **Land**:
   - Push the branch as `release/ticketflow-followups-final-2026-10-03` and open a PR into `main`.
   - Merge it through the DeepSeek Harness GitHub App, sha-pinned to the gated head.
   - Verify that `origin/main`'s tree equals the branch tree.
   - Append a `LANDED:` line to the ledger: PR number, merge commit, merger, time.
