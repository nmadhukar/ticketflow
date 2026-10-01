# TicketFlow runtime design-conformance validation — 2026-10-01

**Branch:** `dc4/gate`; **commit:** `e1de50805c18d2571892ee7f2b14db4f538261f8` (only repository change: `scripts/ai/verify.sh`; no push). **Inputs:** [requirements](ticketflow-requirements.md), [untrusted static map](ticketflow-validate-map-2026-10-01.md). Runtime evidence: [API probe transcript](ticketflow-runtime-probe-output-2026-10-01.txt), [gate output](ticketflow-verify-output-2026-10-01.txt). The first transcript includes *exploratory false negatives*: a staff account was role-changed but not approved. Staff checks were repeated after `POST /api/admin/users/:id/approve`; corrected results below supersede the initial transcript. Also, a 200 `text/html` response from Vite for an unknown `/api/...` path is **not** a successful API endpoint (the static map incorrectly treats some such routes as implemented).

## Stack, images, seed and health

- Docker Compose project `tfphase2_179`, repository `docker-compose.yml`: `postgres:16-alpine` (`sha256:721873c34ceb...`, `pg_isready` **healthy**) and locally built `tfphase2_179-app` (`sha256:bbf6d04e6eeb...`, Node 20, Express/Vite). App HTTP `/` **200** HTML; `/api/security/health` **200** JSON `{"healthy":false,"checks":{"jwtSecret":false,"awsCredentials":false,"rateLimiting":false,"inputValidation":true,"httpsRedirect":false}}`. Helmet CSP, `X-Content-Type-Options:nosniff`, and `X-Frame-Options:DENY` present. Browser-based interaction unavailable (no browser tools); UI route HTML tested, not rendered/visually verified. Do not confuse these with screen verification.
- Fresh `docker compose up -d --build postgres app` starts the app *before* schema provisioning; app exits with `relation "sso_configuration" does not exist` (`server/microsoftAuth.ts:27`). `docker compose run --rm -T --no-deps app npx drizzle-kit push --force` then `docker compose restart app` brought it online. Environment bootstrap defect; recovered well under ten minutes. The gate script orders schema push before app startup. No sample-ticket dataset exists; startup seeds **four email templates** and **one approved admin** (`admin@ticketflow.local`, password defined in `server/seedDefaultAdmin.ts:10-15`). Additional customer/staff accounts and records below were created exclusively in the throwaway DB. No AWS/SES/S3/Entra/Teams credentials configured.
- Test runner image `node:20-slim` (`sha256:2cf067cfed83...`); official browser image `mcr.microsoft.com/playwright:v1.55.0-noble` (`sha256:b27e719ecbfe...`). Both used only through Docker. Compose app build runs `npm ci` then an **unfrozen** `npm install pg @types/pg` in `Dockerfile:10-13` (recorded, not altered).

## End-to-end ticket workflow

1. Admin login **200**, `connect.sid` issued (`HttpOnly; SameSite=Lax; Expires` seven days later); `/api/auth/user` **200**. Self-registration **201** with `customer`, `isApproved:false`; pending login **401**, duplicate **400**. Admin approves customer **200**, then customer logs in **200**. Staff registration and role change to `user` **200**; `isApproved` must be set via separate approve endpoint, since `PATCH /api/admin/users/:id` silently ignores `isApproved`. Staff then logs in **200**.
2. Customer sends `{title:"Early ...",description:"Description entered once ...",category:"bug",priority:"high",tags:["early"],estimatedHours:3,dueDate:"2026-10-20T00:00:00.000Z"}`: **400** because `ticketNumber` is required by the insert schema even though it is generated server-side. Resubmitting the *same* data with temporary `ticketNumber:"ignored-by-storage"` succeeds **201**; persisted number `TKT-2026-0002`, status `open`, same `createdBy`. **This workaround is evidence, not acceptance of T1.** Frontend `client/src/components/task-modal.tsx:314-325` never supplies ticketNumber, so its normal create form is broken. Another ticket with empty title succeeds **201** despite expected **400**.
3. Customer A can read own ticket **200**; other customer gets **403** on read/update/comment. Unrelated staff can read it by direct id **200** although it is excluded from normal staff list. Admin `PATCH` assign staff ID **200**, re-read shows the same assignee; assigned staff `/api/tasks/my` now lists it **200**. Staff comment **201**, list **200**, empty comment **400**. Ticket retains original description, tags and estimated hours; no re-entry on subsequent transitions.
4. With staff cookie `PATCH /api/tasks/2` status through `open → in_progress → on_hold → resolved → closed → open`: **200** at every transition, original description preserved after each and after re-read; `resolvedAt:null` on resolved, `closedAt:null` on closed, and invalid status `broken` is wrongly accepted **200**. Activity history is written in DB (`task_history`), but `GET /api/tasks/2/history` returns **200 text/html**, not a JSON audit trail. `GET /api/activity?limit=5` returns JSON.
5. Admin changes prefix with `PATCH /api/company-settings` **200**; next ticket number `HD-2026-0001` **201** with the same workaround; `/api/tasks?limit=2&offset=0` IDs `[4,3]` versus `offset=2` IDs `[2,1]`. Staff `POST /api/teams` **201** though user role should be forbidden. Customer delete **403**; both staff and admin delete return **500** (instead of staff **403**, admin **204**), since `task_history` FK prevents deleting a ticket (`23503`).

## Runtime requirement matrix

Statuses refer to the **whole acceptance criterion**; a checked subpath does not make an incomplete criterion pass. `NOT-RUNNABLE` identifies missing external integrations, unavailable browser automation, or absent executable suite, not an assumed pass. This covers **all 77 static-map IMPLEMENTED/PARTIAL IDs** (the map's status-table tally 71+6+10=87 is correct; its alternative tally 61+5+10 and some per-section subtotals are contradictory). M1–M9 and E6 were marked MISSING and were not promoted on static assertion alone.

| ID | Outcome | Runtime endpoint/screen evidence or limiting condition |
|---|---|---|
| A1 | RUNTIME-VERIFIED | Register 201 unapproved; login 401 pending; duplicate 400. |
| A2 | RUNTIME-VERIFIED | Admin/customer login 200, session cookie and `/api/auth/user` 200. |
| A3 | RUNTIME-VERIFIED | Wrong password 401, anonymous user 401, no session issued. |
| A4 | RUNTIME-VERIFIED | Logout 200, old cookie `/api/auth/user` 401; tasks old-cookie not independently retested. |
| A5 | NOT-RUNNABLE | Approve exercised, toggle/deactivated-user login not walked; product UI unverified. |
| A6 | NOT-RUNNABLE | SES absent; token-delivery/reset success unavailable; invalid token not separately exercised. |
| A7 | NOT-RUNNABLE | Registration customer, seeded admin, role-patched approved staff login user; manager invitation and four-role login coverage not completed. |
| A8 | NOT-RUNNABLE | Live login path has no lockout call (`server/auth.ts:131-166`; disconnected secureAuth module), but five-attempt then correct-password sequence was not sent to this stack. |
| A9 | NOT-RUNNABLE | `/api/sso/status` 200 `configured:false`; Entra absent. |
| T1 | RUNTIME-FAILED | Documented create **400** missing ticketNumber; extra client-side placeholder yields 201. |
| T2 | RUNTIME-FAILED | Empty title plus workaround stored as ticket id 3 **201**; priority `not-valid` update also accepted **200**. |
| T3 | RUNTIME-VERIFIED | TKT-2026-0001/0002/0003 and HD-2026-0001 after settings change; no concurrency probe. |
| T4 | RUNTIME-VERIFIED | Own GET 200; invalid ID 400; unknown ID 404. |
| T5 | NOT-RUNNABLE | GET list 200 bare JSON array; table columns/view cannot be confirmed without browser. |
| T6 | NOT-RUNNABLE | Status/category/assigneeId filters returned JSON; UI controls not browser-tested. |
| T7 | RUNTIME-VERIFIED | Matching search includes ticket; unmatched returns `[]`. |
| T8 | RUNTIME-VERIFIED | Limit 2, offsets 0/2 `[4,3]`/`[2,1]`, no overlap. |
| T9 | NOT-RUNNABLE | `/api/tasks/my` initially empty, after assignment contains id 2; My Tasks rendered page untested. |
| T10 | RUNTIME-FAILED | Priority update and reread work; invalid `not-valid` accepted 200, not 400. |
| T11 | NOT-RUNNABLE | User assignment PATCH 200; assignee appears in `/api/tasks/my`; team assignment not probed. |
| T12 | RUNTIME-FAILED | All five statuses accepted, but no resolved/closed stamps and invalid status accepted 200. |
| T13 | RUNTIME-FAILED | Close/reopen PATCH 200 and DB history written, but per-ticket history endpoint responds HTML, not an inspectable audit trail. |
| T14 | RUNTIME-VERIFIED | POST comment 201 author staff; GET list contains it; empty content 400. |
| T15 | RUNTIME-FAILED | JSON metadata 11,000,000 bytes accepted 201 (>10MB); no actual file stored; S3 unconfigured. |
| T16 | RUNTIME-FAILED | Customer DELETE 403, staff/admin DELETE 500 FK `task_history`; admin cannot get 204. |
| T17 | RUNTIME-FAILED | `/api/tasks/2/history` is HTML SPA fallback; `task_history` DB rows exist. |
| T18 | NOT-RUNNABLE | tags, estimatedHours and dueDate survived create, updates, reread; actualHours and their full update path were not tested. |
| I1 | NOT-RUNNABLE | Create workaround succeeds without Bedrock; auto-response GET 200 `null`; scoring needs Bedrock. |
| I2 | NOT-RUNNABLE | Bedrock absent; no >=0.7 AI response available. |
| I3 | NOT-RUNNABLE | Bedrock absent; API generation not asserted. |
| I4 | NOT-RUNNABLE | `/api/ai-feedback` rating 5 persisted 200 and read 200. Ticket auto-response feedback returned 500 because no auto-response existed without Bedrock; valid-response scenario unavailable. |
| I5 | NOT-RUNNABLE | Bedrock absent; widget not browser-tested. |
| I6 | RUNTIME-FAILED | `/api/admin/ai-settings` 200 **HTML**, not JSON/settings; `/api/ai/status` 200 says bedrockAvailable:false. |
| I7 | NOT-RUNNABLE | Both analytics APIs returned 200 empty/counts; Analytics rendered page not tested. |
| I8 | NOT-RUNNABLE | KB status 200 `configured:false`, data sources 500; Bedrock/S3 sync impossible. |
| I9 | NOT-RUNNABLE | Resolved PATCH 200, learning queue POST 200 and status 200 `[pending:1]`; Bedrock actual learning absent. |
| K1 | NOT-RUNNABLE | Admin article POST 201/list 200, customer admin-list 403; edit/delete not exercised. |
| K2 | RUNTIME-VERIFIED | unpublished article excluded (`[]`), PATCH publish with `isPublished:true` 200, search contains article. No-body PATCH does not toggle (maps incorrectly claim toggle). |
| K3 | NOT-RUNNABLE | Search 200 article returned; Knowledge Base rendered page not browser-tested. |
| K4 | RUNTIME-VERIFIED | Feedback 200, rating 200; effectivenessScore changed to `"2.73"`. |
| K5 | NOT-RUNNABLE | `/api/help/search?q=phase2` 200 `[]`; S3 unavailable for file upload/open. |
| K6 | NOT-RUNNABLE | `/api/company-policies` 200 `[]`; S3 upload/download unavailable. |
| K7 | NOT-RUNNABLE | Category POST 200; guide POST with required category/type 200, list 200; User Guides rendered page not browser-tested. |
| K8 | NOT-RUNNABLE | Anonymous presigned URL POST 401; authenticated S3 presign unavailable. |
| E1 | NOT-RUNNABLE | SES absent; email test not attempted. |
| E2 | NOT-RUNNABLE | Startup seeds four templates; GET `/api/email-templates` 200; edit persistence untested. |
| E3 | NOT-RUNNABLE | Invitation create with explicit expiresAt 200; SES delivery/resend unavailable. No expiresAt causes 500. |
| E4 | NOT-RUNNABLE | Teams webhook absent. |
| E5 | NOT-RUNNABLE | `/notifications` serves HTML 200; source uses mock notifications (`client/src/pages/notifications.tsx:22-23,118-122`). WebSocket message delivery and rendered page were not exercised. |
| G1 | RUNTIME-FAILED | Approved plain staff POST `/api/teams` 201, should 403. |
| G2 | NOT-RUNNABLE | Team GET 200 and members GET 200 with created-by member; rendered Team Detail page not browser-tested. |
| G3 | NOT-RUNNABLE | Team member role PATCH not exercised. |
| G4 | NOT-RUNNABLE | Admin assign-team 200, members reflect role; remove/`/teams/my` were not retested. |
| G5 | NOT-RUNNABLE | Admin POST department 200, staff GET department 200; rename/delete untested. |
| G6 | NOT-RUNNABLE | Valid invitation GET 200 then POST accept 200 merely marks accepted and says sign in; no auto-approval user creation observed. Registration with still-pending invitation was not exercised, so end-to-end acceptance remains unverified. |
| G7 | NOT-RUNNABLE | Admin invitation list 200; revoke/invalidated token not exercised. |
| D1 | NOT-RUNNABLE | Admin `/api/stats` 200 `{total:3,open:3,...}`; dashboard tiles and user count parity not browser-tested. |
| D2 | NOT-RUNNABLE | `/api/activity?limit=5` 200 max five JSON entries; dashboard rendering not tested. |
| D3 | RUNTIME-VERIFIED | Admin GET `/api/admin/stats` 200; customer 403. |
| S1 | RUNTIME-FAILED | Admin list, role edit, approve 200; `/api/admin/users` exposes password hash; non-admin permissions on edit were not fully exercised. |
| S2 | NOT-RUNNABLE | Admin PATCH prefix/name 200 and subsequent HD ticket; logo upload unavailable/unexercised. |
| S3 | NOT-RUNNABLE | API key create 201 (plainKey only on creation); list 200 omits secret; delete not probed. |
| S4 | NOT-RUNNABLE | GET escalation rules 200 `[]`; CRUD not exercised. |
| S5 | NOT-RUNNABLE | GET FAQ cache 200 `[]`; clear not exercised. |
| S6 | NOT-RUNNABLE | SSO config GET 200 empty credentials; Entra save/test unavailable. |
| Y1 | RUNTIME-VERIFIED | Anonymous GET tasks, teams, admin users, knowledge search each 401. |
| Y2 | NOT-RUNNABLE | Customer B GET/PATCH/comment on A's ticket each 403; listing limited; attachments cross-user not separately probed. |
| Y3 | NOT-RUNNABLE | Customer and staff admin-users GET 403; other admin routes not exhaustively checked. |
| Y4 | RUNTIME-FAILED | Unrelated staff GET `/api/tasks/2` **200** while normal list excludes record. |
| Y5 | RUNTIME-FAILED | `/api/users`, `/api/admin/users`, `/api/teams/3/members` include `password` hash field, even to ordinary staff. Stored value is scrypt hash, but **never return password** is violated. |
| Y6 | NOT-RUNNABLE | Health says `rateLimiting:false`, and `server/security/index.ts:109-113` comments out auth limiters; 5–10 and 100-request rate thresholds were not directly exercised. |
| Y7 | NOT-RUNNABLE | Empty title and malformed priority/status persisted through API (input-validation defect); XSS inert rendering could not be browser-verified. |
| Y8 | RUNTIME-VERIFIED | Helmet CSP, nosniff, DENY headers and health JSON HTTP 200; health overall `false`. |
| Y9 | RUNTIME-VERIFIED | Session cookie attributes `HttpOnly; SameSite=Lax`, expiry exactly seven days; Secure off in dev. |
| P1 | RUNTIME-FAILED | Invalid priority/status 200, delete FK failure 500, unknown API path 200 HTML; docs error shape `{error,message,details,requestId}` differs from `{message}`. |
| P2 | NOT-RUNNABLE | `/api-docs` 200 HTML; interactive content requires browser; not rendered here. |
| P3 | RUNTIME-FAILED | Documented create 400 not 201, PUT vs PATCH, array vs documented envelope, delete 500 rather than 204. |

## CI-equivalent container test suites

No `.github/workflows/*` exists. `package.json:6-12` has `check` but **no** `test`, `lint` or `e2e` script. `server/__tests__/README.md:28-77` describes commands that cannot run against the checked-in scripts; its e2e file's test setup is commented out (`server/__tests__/e2e/user-workflows.test.ts:12-28`). All below were attempted in containers with the untouched tracked files and no skipped tests or weakened assertions; failures are product/test-infrastructure defects, not passing suites.

| Suite | Container command | Result / first real failure | Runner counts |
|---|---|---|---|
| Frozen install | `node:20-slim`, read-only code, isolated node_modules/npm-cache volumes: `npm ci --no-audit --no-fund` | PASS; added **1104 packages**, lockfile unchanged | n/a |
| Lint | `npm run lint` | FAIL: `npm error Missing script: "lint"` (`package.json:6-12`) | n/a |
| Typecheck | `npm run check -- --noEmit` | FAIL: first `client/src/__tests__/useAuth.test.tsx:7:16 TS2304 Cannot find name 'jest'`; hundreds of further errors, including missing `vitest`, duplicate storage methods | n/a |
| Unit + integration + server/client e2e Jest discovery | `npm exec --no -- jest --config jest.config.js --runInBand --json --outputFile=/gate-reports/jest.json` | FAIL **before runner starts**: `ReferenceError: module is not defined in ES module scope` at `jest.config.js:1`; `package.json:4` declares ESM. Default discovery has same error. | **No Jest JSON generated; counts unavailable**, not zero successful/skipped tests. |
| Official image browser E2E | `mcr.microsoft.com/playwright:v1.55.0-noble` (`node v22.18.0`) runs `npm run e2e` only if declared | FAIL: `Error: no e2e script in package.json`; no pinned Playwright test dependency/spec in repo | No test report; counts unavailable |

## `verify.sh` gate execution

Executed **once**, `GATE_NONCE=runtime-phase2 scripts/ai/verify.sh`, from the committed-only file contents (commit made immediately after run with no further edits). It uses Docker CLI and DOCKER_HOST; unique Compose project and dependency/report volumes, pinned official Playwright image, `npm ci`, all available suites, Jest JSON validation, real API workflow, and trap cleanup. It **fails closed**, does not fake counts when Jest cannot produce a report, and prints the required trailer immediately before `RESULT:`. Output: [complete 625-line transcript](ticketflow-verify-output-2026-10-01.txt). Relevant verbatim tail:

```
PASS: npm ci frozen install
FAIL: lint
FAIL: typecheck
FAIL: all Jest suites (unit, integration, AI, load, e2e)
FAIL: Jest runner JSON report absent or invalid
FAIL: official pinned-image browser e2e suite
--- CLEANUP ---
Cleanup complete.
--- RESULTS ---
PASS: 9
FAIL: 6
TESTS[runtime-phase2]: 0 passed, 0 skipped
RESULT: FAIL
```

**Exit 1**. `TESTS[...]` is an unavailable-report sentinel (`0/0`), **not** claimed actual run counts: Jest configuration fails before producing its own report; script marks this failure. Workflow gate also fails `resolvedAt not stamped` after logging documented create 400. Gate was not pushed or submitted to independent gate runner. Commit `e1de50805c18d2571892ee7f2b14db4f538261f8`.

## Defects (ranked; file:line and runtime evidence)

| Severity | Location | Evidence / cause |
|---|---|---|
| Critical | `server/routes.ts:450-455,560-568,529-536`; `server/storage.ts:866-895` | GET `/api/users` **200 to ordinary staff**, full `password` scrypt hashes; admin users and team members also expose hashes; violates Y5. |
| Critical | `server/routes.ts:194-214,305-323` | Unrelated staff GET other customer's ticket **200**; normal list filters it out. Y4 direct-ID isolation bypass. |
| High | `shared/schema.ts:321-329`, `server/routes.ts:224-228`, `client/src/components/task-modal.tsx:314-325` | Frontend and documented POST omit `ticketNumber`; server returns **400 Required** before storage generates it. Primary customer workflow cannot create ticket. |
| High | `server/routes.ts:377-389`, `server/storage.ts:689-691`, `shared/schema.ts:142-151` | DELETE reaches DB for non-admin; FK `task_history_task_id_tasks_id_fk` causes **500 even for admin**, not 204. |
| High | `server/routes.ts:497-505` | Plain `user` POST teams **201**, not 403; creates team and admin team membership. |
| High | `shared/schema.ts:321-329`, `server/routes.ts:322`, `server/storage.ts:659-670` | Empty title POST 201; invalid priority and status PATCH 200, stored unchanged by validators; violates T2/T10/T12/Y7. |
| High | `server/routes.ts:801-821`, `client/src/components/task-modal.tsx:169-177` | Metadata-only attachment >10MB **201**; frontend points to `storage.example.com` fake URL, actual file not uploaded. T15. |
| High | `server/storage.ts:653-686` | Resolved and closed transitions **200** but `resolvedAt`/`closedAt` remain null. |
| High | `server/routes.ts:2706-2739,2808-2828` | Invitation without `expiresAt` **500 Invalid time value**. Direct accept only marks accepted/instructs login; auto-approval via registration with a still-pending token not tested. |
| High | `server/security/index.ts:109-113`, `server/auth.ts:131-166` | Rate limit explicitly disabled; live login never invokes account lockout; health `rateLimiting:false`. |
| Medium | `server/routes.ts:194-219,730-740` | No per-ticket history route; `/api/tasks/2/history` **200 HTML** Vite fallback, not audit JSON. |
| Medium | `server/routes.ts:3649-3669` | Admin AI settings endpoint absent; GET **200 HTML**; static map incorrectly claims whole feature via `/api/ai/status`. |
| Low | `server/routes.ts:3311-3367,2971-2982` | Generic AI feedback works; posting feedback without an existing AI auto-response gives **500** (no configured Bedrock to test normal flow). |
| Medium | `docker-compose.yml:31-34`, `server/index.ts:44-64` | Fresh compose without schema dies on missing `sso_configuration`; manual `drizzle-kit push` and restart needed. |
| Medium | `jest.config.js:1`, `package.json:4,6-12` | Jest CommonJS configuration evaluated as ESM; no runnable Jest report; missing lint/e2e scripts. `client/src/__tests__/useAuth.test.tsx:7` first TS error. |
| Medium | `client/src/pages/notifications.tsx:22-23,118-122` | Notifications page uses hard-coded mock records, not observed live socket events. |
| Low | `server/routes.ts:2989-3009,3125-3143` | Publishing only succeeds if explicit `isPublished:true`; no-body PATCH returns 200 but does not toggle. |

**External exclusions:** Bedrock, SES, S3, Entra/Microsoft Graph and Teams webhook not configured; do not classify their unavailable downstream calls as product failures. Browser toolset absent, so no screenshots/console diagnostics; UI evidence is HTTP-renderability and component source only. MCP M1–M9 and inbound-email E6 were already MISSING, not claimed implemented.

## Cleanup and final working tree

`docker compose down -v --remove-orphans` and gate trap removed **all containers, networks and volumes created**. Deleted both app images built by this run; kept pre-existing/shared cached images. Scratch files and probe transcripts are **inside** `/home/agent/workspace/reports`; no scratch outside reports remains. Docker resources after cleanup: containers `(none)`; networks `bridge, host, none`; volumes `(none)`. `git status --porcelain` output: **empty**; branch `dc4/gate`, one committed file, no push.

## SUMMARY
Stack booted after schema push; Postgres healthy, API/UI respond, security health false.
Customer ticket creation fails 400; placeholder workaround proves all five statuses retain original data.
Critical leaks expose password hashes and unrelated staff can read other customers' tickets.
Frozen install passed; lint, typecheck, Jest and official-image E2E fail; runner counts unavailable.
Gate commit e1de508 exited 1 with RESULT: FAIL; all created Docker resources removed and git clean.
