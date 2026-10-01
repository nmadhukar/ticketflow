# TicketFlow Fix Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TicketFlow's own checks run and pass, close every confirmed defect from the 2026-10-01 check-up as re-verified on this branch, and add an MCP server for ticket create/get/list/update/close/reopen/delete/comment.

**Architecture:** Fix on branch `fix/merge-main-and-gaps` (= `feat/aws-ec2` + `main`, feat wins). One access rule for tickets (`server/permissions/ticketAccess.ts`) used by every REST handler and every MCP tool; one ticket service (`server/services/tickets/`) that REST routes and MCP tools both call; one error contract. Tests first, against a real throw-away Postgres for anything touching the database.

**Tech Stack:** Node 24, TypeScript (ESM, `"type":"module"`), Express, drizzle-orm + Postgres, passport sessions, zod, Jest + ts-jest + supertest, Playwright (new), ESLint flat config (new), `@modelcontextprotocol/sdk` 1.31.0 (new).

**Spec:** `docs/dc4-validation-2026-10-01/ticketflow-requirements.md` (requirement IDs A1..M9) and `docs/dc4-validation-2026-10-01/ticketflow-validate-gaps-2026-10-01.md` (gap ranks, work packages). Re-verification of the gaps on THIS branch (2026-10-01, three readers) is summarised per task below; where it disagrees with the gap list, the re-verification wins.

## Owner decisions (2026-10-01)

- Role `user` means **agent**: existing `user` rows are migrated to `agent`, staff default is `agent`; any other unknown role fails closed.
- Agents see and work on tickets **assigned to them, created by them, queued to a team they belong to, or assigned to a teammate**.
- Workflow: **staff (agent, manager, admin) can close**; a closed or resolved ticket can be **reopened by staff or by the customer who created it** (back to `open`).
- In scope: inbound email to tickets (built and tested against a mocked SES/SNS payload), Playwright browser end-to-end tests, ESLint.
- Merge conflicts went to `feat/aws-ec2`. main's unwired `server/s3Service.ts` and `server/awsKnowledgeBase.ts` are dead code (imported by nothing; the latter imports a package that is not installed).

## Global Constraints

- Work only in `C:\Users\MadhukarNarahari\Documents\GitHub\ticketflow` on branch `fix/merge-main-and-gaps`; nothing on DC4.
- Stage explicit paths only; never `git add -A` or `git add .`.
- Never edit an applied migration. New migrations continue the sequence after `migrations/0009_simplify_cost_limits.sql` (check the highest number immediately before creating a file); every migration idempotent (`IF NOT EXISTS`/`IF EXISTS`), never deletes user data.
- No secrets, real credentials or `.env` files committed. Tests use generated values.
- New runtime dependencies allowed: `@modelcontextprotocol/sdk@1.31.0` (pinned), `sanitize-html` (pinned exact). zod may move to `^3.25`. New dev dependencies allowed: `supertest`, `@types/supertest`, `@playwright/test`, `eslint`, `typescript-eslint`, `@eslint/js`, `globals` (all pinned exact). Nothing else without asking.
- Error responses: JSON `{ "error": <code>, "message": <text>, "details"?: <field errors> }`, status 400 invalid input, 401 unauthenticated, 403 forbidden, 404 missing id, 409 invalid state; never a stack trace (P1).
- Ticket statuses: `open`, `in_progress`, `on_hold`, `resolved`, `closed`. Priorities: `low`, `medium`, `high`, `urgent`. Values outside these are rejected with 400, never matched to zero rows.
- `DELETE /api/tasks/:id`: admin only (manager only when `ALLOW_MANAGER_DELETE=true`), returns 204, a following GET returns 404 (T16).
- A user object leaving the server never contains `password`, `passwordResetToken`, `passwordResetExpires`, `failedLoginAttempts`, `lockedUntil` or any secret.
- Every task ends with: `npm run check` (0 TS errors once Task 2 lands), `npm run lint` (0 errors once Task 3 lands), `npm test` green, then a commit.

## Review Focus

1. A staff member opening a ticket by id, through any route (get, update, comments, attachments, auto-response, feedback, history, learning) for a ticket outside their scope must get 403 — the list and the by-id path must never disagree (Task 8 `isolation.matrix.test.ts`).
2. A non-numeric or negative id on any `/:id` route must give 400 JSON, never 500 (Task 7 `idParams.test.ts`).
3. A user object returned by ANY endpoint (users, team members, comments, admin actions, invitations) must not carry password or reset fields (Task 4 `noSecretsInResponses.test.ts` walks every JSON response in the integration suite).
4. Two concurrent ticket creations must get distinct `ticketNumber`s (Task 9 `ticketNumber.concurrency.test.ts`).
5. An MCP agent asking "how many open tickets" across more than one page must get the true count, not a page count (Task 20 `listTickets.pagination.test.ts` asserts `hasMore` and that paging reaches every row).

---

## File Structure

New, by responsibility:
- `server/http/errors.ts` — `HttpError`, `sendError`, the JSON error middleware, `/api` 404.
- `server/http/params.ts` — `parseIdParam`.
- `server/utils/publicUser.ts` — `toPublicUser`, `PUBLIC_USER_COLUMNS`.
- `server/permissions/roles.ts` — `normalizeRole`.
- `server/permissions/ticketAccess.ts` — `ticketVisibilityWhere`, `canAccessTask`, `assertTaskAccess`.
- `server/permissions/workflow.ts` — status transition table, `assertTransition`.
- `server/services/tickets/{ticketService,schemas,serializers,notifier}.ts` — the one ticket service.
- `server/services/auth/{apiKeys,bearer,lockout}.ts` — hashed API keys, bearer middleware, login lockout.
- `server/services/email/inbound.ts` + route — SES/SNS inbound email to ticket/comment.
- `server/mcp/{router,server,tools,errors}.ts` — MCP over Streamable HTTP at `/api/mcp`.
- `server/__tests__/integration/helpers/{testDb,testApp,fixtures}.ts` — the integration harness.
- `docker-compose.test.yml`, `eslint.config.js`, `playwright.config.ts`, `e2e/*.spec.ts`.
- `migrations/0010_*.sql` onward.

Modified: `server/routes/index.ts` (handlers become thin, duplicates removed), `server/storage/index.ts`, `server/storage/storage.inteface.ts`, `server/services/auth/index.ts`, `server/security/*`, `server/index.ts`, `server/seed/*`, `shared/schema.ts`, `jest.config.mjs`, `package.json`, `tsconfig.json`, client pages that consume changed endpoints.

---

## Phase 0 — Make the checks run

### Task 1: Test harness that actually runs (WP1)

Re-verified state: Jest loads 11 suites, 7 fail to load: 6 import pre-refactor paths (`../db`, `../auth`, `../ses`, `../costMonitoring`, `../../aiAutoResponse`, `../../bedrockIntegration`, `../../knowledgeBaseLearning`); `moduleNameMapper` for `@shared` is missing; `roots` covers only `server` so client tests never run; no integration database.

**Files:**
- Modify: `jest.config.mjs`, `package.json` (scripts, devDeps `supertest`, `@types/supertest`), `server/__tests__/setup.ts`
- Create: `docker-compose.test.yml`, `server/__tests__/integration/helpers/testDb.ts`, `server/__tests__/integration/helpers/testApp.ts`, `server/__tests__/integration/helpers/fixtures.ts`, `server/__tests__/integration/smoke.test.ts`
- Fix imports in: `server/__tests__/auth.test.ts`, `storage.test.ts`, `costMonitoring.test.ts`, `companySettings.email.test.ts`, `unit/aiAutoResponse.test.ts`, `unit/knowledgeBaseLearning.test.ts`, `integration/bedrock-api.test.ts`

**Interfaces:**
- Produces: `testDb.ts` → `export async function resetDb(): Promise<void>` (TRUNCATE all app tables RESTART IDENTITY CASCADE); `testApp.ts` → `export async function createTestApp(): Promise<{ app: Express; close(): Promise<void> }>` (calls the real `registerRoutes`); `fixtures.ts` → `createUser(opts: { role: 'admin'|'manager'|'agent'|'customer'; email?: string; password?: string; isApproved?: boolean; isActive?: boolean }): Promise<User>`, `loginAs(app, user, password?): Promise<supertest.Agent>` (POST `/api/auth/login`, keeps the cookie), `createTeam(managerOrAdmin, opts)`, `createTicketAs(agent, body)`.

- [ ] **Step 1: Test database.** `docker-compose.test.yml` with one service `postgres-test` (`postgres:16-alpine`, port `55432:5432`, db `ticketflow_test`, user/password `test`/`test`, tmpfs data). Scripts: `"test:db:up": "docker compose -f docker-compose.test.yml up -d --wait"`, `"test:db:push": "cross-env DATABASE_URL=postgres://test:test@localhost:55432/ticketflow_test drizzle-kit push --force"` (add `cross-env` only if not present; otherwise use node `--env-file`), `"test": "jest"`, `"test:unit": "jest --selectProjects unit"`, `"test:integration": "jest --selectProjects integration --runInBand"`.
- [ ] **Step 2: Jest projects.** Rewrite `jest.config.mjs` with `projects`: `unit` (roots `server`, testMatch `server/__tests__/{unit,ai}/**/*.test.ts` and `server/**/*.unit.test.ts`, node env), `integration` (testMatch `server/__tests__/integration/**/*.test.ts`, `setupFiles: ['<rootDir>/server/__tests__/integration/helpers/env.ts']` which sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://test:test@localhost:55432/ticketflow_test'`, `SESSION_SECRET`, `NODE_ENV='test'`), `client` (roots `client/src`, `testEnvironment: 'jsdom'`, ts-jest with `tsx: react-jsx`). All projects: `moduleNameMapper: { '^@shared/(.*)$': '<rootDir>/shared/$1', '^@/(.*)$': '<rootDir>/client/src/$1' }`, ESM-compatible ts-jest settings matching `tsconfig.json`.
- [ ] **Step 3: Smoke test (failing first).**

```ts
// server/__tests__/integration/smoke.test.ts
import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";

describe("integration harness", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx.close(); });
  beforeEach(async () => { await resetDb(); });

  it("rejects an anonymous ticket list with 401 JSON", async () => {
    const res = await request(ctx.app).get("/api/tasks");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/json/);
  });

  it("logs a seeded admin in and lists tickets", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const res = await agent.get("/api/tasks");
    expect(res.status).toBe(200);
  });
});
```

Run: `npm run test:db:up && npm run test:db:push && npm run test:integration -- smoke` → FAIL first (missing helpers), then PASS.
- [ ] **Step 4: Repair stale suites.** For each listed suite: point imports at the current modules (`server/storage/db`, `server/services/auth`, `server/email/...`, `server/services/ai/...`); a suite whose subject no longer exists is deleted, and the deletion is listed in the commit message with the replacement test, if any. `server/__tests__/e2e/user-workflows.test.ts` (commented-out app, skipped tests) and `server/__tests__/load/performance.test.ts` (simulated helpers only) are removed; Playwright (Task 23) replaces the first.
- [ ] **Step 5:** `npm test` → every project loads; record pass/fail/skip counts in the commit message. Skips allowed only for tests needing real AWS (`RUN_INTEGRATION_TESTS`), each named.
- [ ] **Step 6: Commit** `test: make every Jest suite load; add Postgres integration harness`.

### Task 2: Type check clean (WP2)

Re-verified: 63 errors — 29 `client/src/components/__tests__/task-modal.test.tsx` (tests a component this branch deleted), 22 `client/src/__tests__/useAuth.test.tsx`, 6 `server/awsKnowledgeBase.ts` (dead, imports uninstalled `@aws-sdk/client-bedrock-agent`), 2 `server/storage/storage.inteface.ts:6,18` (`BedrockUsage`/`InsertBedrockUsage` not exported), 4 server test utils.

**Files:** Delete `server/awsKnowledgeBase.ts`, `server/s3Service.ts`, `scripts/test-auto-sync.ts`, `scripts/test-knowledge-base.ts`, `scripts/setup-knowledge-base.ts`, `test-s3-integration.ts` (main's dead duplicates; history keeps them; commit message says so). Delete `client/src/components/__tests__/task-modal.test.tsx` (component removed on feat/aws-ec2) — replaced by a test for the current task create component in Step 2. Modify `storage.inteface.ts`, `client/src/__tests__/useAuth.test.tsx`, server test utils, `tsconfig.json` (`exclude` keeps test files type-checked by Jest, not by `check`, only if the client tests are type-checked by the `client` Jest project).

- [ ] **Step 1:** `npx tsc --noEmit` → record 63.
- [ ] **Step 2:** Fix each group; add `client/src/components/__tests__/<current create component>.test.tsx` rendering the create form and asserting required-field validation.
- [ ] **Step 3:** `npm run check` → 0 errors; `npm test` green.
- [ ] **Step 4: Commit** `fix: type check clean (63 -> 0)`.

### Task 3: ESLint

**Files:** Create `eslint.config.js` (flat: `@eslint/js` recommended + `typescript-eslint` recommended, `globals.node` for server, `globals.browser` for client; ignores `dist`, `node_modules`, `migrations`, `coverage`); `package.json` script `"lint": "eslint ."`.

- [ ] **Step 1:** Install pinned dev deps; run `npm run lint` and record the count by rule.
- [ ] **Step 2:** Fix errors. Rules that would require behaviour changes across hundreds of lines (e.g. `no-explicit-any`) are set to `warn` with a comment naming the count; no rule is disabled to hide a real bug (`no-unused-vars` on imports is fixed, not silenced).
- [ ] **Step 3:** `npm run lint` → 0 errors. **Commit** `chore: add ESLint flat config; lint clean`.

---

## Phase 1 — Accounts and secrets (WP3, WP4, secrets parts of WP13)

### Task 4: No secrets in any response; /api/users staff only (Y5, S1, G2)

Re-verified: `GET /api/users` (routes `:175`, shadows `:1302`) returns `select * from users` to any role; `/api/admin/users`, PATCH/toggle/approve return full rows; team members/admins (`storage:858-874`, `teams.ts:340,366`) and `getTaskComments` (`storage:1110-1134`) include password and reset token.

**Files:** Create `server/utils/publicUser.ts`, `server/__tests__/unit/publicUser.test.ts`, `server/__tests__/integration/users.secrets.test.ts`, `server/__tests__/integration/helpers/noSecrets.ts`. Modify `server/storage/index.ts` (`getAllUsers`, `getTeamMembers`, `getTeamAdmins`, `getTaskComments`, `updateUserProfile`, `toggleUserStatus`, `approveUser` select/return public columns), `server/routes/index.ts` (delete the shadowed `/api/users` at `:1302`; `/api/users` staff-only), `server/routes/teams.ts`.

**Interfaces — Produces:**

```ts
// server/utils/publicUser.ts
import type { User } from "@shared/schema";
export const PUBLIC_USER_FIELDS = ["id", "email", "firstName", "lastName", "role", "isActive", "isApproved",
  "profileImageUrl", "createdAt", "updatedAt"] as const;
export type PublicUser = Pick<User, (typeof PUBLIC_USER_FIELDS)[number]>;
export function toPublicUser<T extends Partial<User>>(u: T): PublicUser {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_USER_FIELDS) if (k in u) out[k] = (u as Record<string, unknown>)[k];
  return out as PublicUser;
}
```

(Adjust the field list to the real `users` columns; anything not listed is dropped. Allow-list, never a deny-list.)

```ts
// server/__tests__/integration/helpers/noSecrets.ts
const FORBIDDEN = ["password", "passwordResetToken", "passwordResetExpires", "failedLoginAttempts",
  "lockedUntil", "keyHash", "clientSecret", "awsSecretAccessKey"];
export function findSecrets(body: unknown, path = "$"): string[] {
  if (Array.isArray(body)) return body.flatMap((v, i) => findSecrets(v, `${path}[${i}]`));
  if (body && typeof body === "object")
    return Object.entries(body).flatMap(([k, v]) =>
      (FORBIDDEN.includes(k) ? [`${path}.${k}`] : []).concat(findSecrets(v, `${path}.${k}`)));
  return [];
}
```

- [ ] **Step 1: Failing tests.** `users.secrets.test.ts`: as customer, `GET /api/users` → 403; as admin, `GET /api/users`, `/api/admin/users`, PATCH a user, toggle, approve, `GET /api/teams/:id/members`, `GET /api/tasks/:id/comments` each → `findSecrets(res.body)` equals `[]`. Also a Jest `afterEach` hook in `testApp.ts` that records every JSON response body and fails the test if `findSecrets` is non-empty (Review Focus 3).
- [ ] **Step 2:** Run → FAIL (password present).
- [ ] **Step 3:** Implement projections in storage (select explicit columns, not `select()`), route changes.
- [ ] **Step 4:** Run → PASS; full suite green. **Commit** `fix(security): no password or reset fields in any response; /api/users staff only`.

### Task 5: Invitations, registration and SSO accounts (G6, G7, E3, A1)

Re-verified: `register` matches an invitation by email with no token (`auth:208-212`) and grants its role and `isApproved` (`:268-270`); a password can be set on a password-less SSO account (`:215-231`); `GET /api/invitations/:token` and accept reject only `accepted`/expired, so cancelled tokens work (`routes:4123,4154`); accept creates no user (`:4177`); missing `expiresAt` → Invalid Date → 500 (`:3965`); tokens from `Math.random` (`storage:2185`).

**Files:** Modify `server/services/auth/index.ts`, `server/routes/index.ts` (invitation routes), `server/storage/index.ts` (`createUserInvitation`), client registration page (send `inviteToken` from the invite link). Test: `server/__tests__/integration/invitations.test.ts`.

- [ ] **Step 1: Failing tests:** (a) registering with an invited email but no token → 201 as a normal unapproved customer, role NOT the invited role; (b) with the right token and email → invited role, approved, invitation `accepted`; (c) token for another email → 400; (d) cancelled token → `GET /api/invitations/:token` 404 and accept 400; (e) expired → 400; (e2) a logged-in user whose email matches a pending invitation calls accept with the token → their role becomes the invited role and the invitation is `accepted` (accept never leaves a dangling "accepted" invitation with no user); (f) admin creates an invitation with no `expiresAt` → 201 with expiry = now + 7 days; with `expiresAt: "garbage"` → 400; (g) token matches `/^[A-Za-z0-9_-]{43}$/` (32 random bytes base64url); (h) registering with the email of an existing SSO account (no password) → 409, the account unchanged.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`crypto.randomBytes(32).toString("base64url")`; register requires `inviteToken` to apply an invitation, compares `invitation.email === body.email` and `status === "pending"` and not expired; accept → same code path as register-with-token or, for a logged-in user whose email matches, links the role). **Step 4:** PASS. **Commit** `fix(security): invitations need their token; revoked and expired tokens refused`.

### Task 6: Login hardening, seeding, secrets fail closed (A5, A8, Y1, Y3, Y6, Y9, A6, S1, role vocabulary)

Re-verified: auth rate limiters commented out (`security/index.ts:115-118`, wrong paths); `secureAuth.ts` unused; live `LocalStrategy` (`auth:141-182`) has no lockout; general limiter keys on the first `X-Forwarded-For` entry (spoofable, `rateLimiting.ts:16-20`); `deserializeUser` ignores `isActive`/`isApproved` (`auth:183-189`); session secret and JWT secret fall back to literals (`auth:122`, `jwt.ts:5`); reset token logged (`auth:516`); admin reset-password is a stub returning an unsaved `Math.random` password (`storage:1452`); every seeder runs in production and logs `Admin123!` plus 12 fixed `Password123!` accounts (`server/index.ts:64-83`, `seedUsers.ts`); role `user` vs `agent` split.

**Files:** Create `server/services/auth/lockout.ts`, `migrations/0010_login_lockout_and_roles.sql`; modify `shared/schema.ts` (users: `failedLoginAttempts integer not null default 0`, `lockedUntil timestamp`; role default `agent` for staff), `server/services/auth/index.ts`, `server/security/index.ts`, `server/security/rateLimiting.ts`, `server/security/jwt.ts`, `server/storage/index.ts` (`resetUserPassword`), `server/index.ts` (seeding gate), `server/seed/seedUsers.ts`, `server/permissions/roles.ts` (new). Tests: `integration/login.lockout.test.ts`, `integration/session.inactive.test.ts`, `unit/roles.test.ts`, `unit/seed.gate.test.ts`, `unit/secrets.failclosed.test.ts`, `integration/adminResetPassword.test.ts`.

Migration `0010` (idempotent): add the two columns `IF NOT EXISTS`; `UPDATE users SET role='agent' WHERE role='user';` and set the column default to `'customer'` for self-registration (staff come through invitations). It never deletes rows.

```ts
// server/permissions/roles.ts
export type Role = "admin" | "manager" | "agent" | "customer";
export function normalizeRole(role: unknown): Role | null {
  if (role === "admin" || role === "manager" || role === "agent" || role === "customer") return role;
  if (role === "user") return "agent"; // owner decision 2026-10-01; rows are migrated by 0010
  return null; // unknown roles fail closed everywhere
}
```

- [ ] **Step 1: Failing tests:** lockout — 5 wrong passwords then the right one → 423 `{error:"account_locked"}`; after `lockedUntil` passes (fake clock / set column) → 200; a successful login resets the counter. Rate limit — 11 login attempts in a minute from one IP → 429 even when `X-Forwarded-For` changes each time. Session — deactivate a logged-in user → next request 401. Seeding — with `NODE_ENV=production` and no `SEED_DEMO_DATA=true`, no demo users are created; with no admin in the database, an admin is created only from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env and nothing is logged containing the password (spy on `console`). Secrets — `NODE_ENV=production` with `SESSION_SECRET` or `JWT_SECRET` unset → startup throws; reset token never appears in logs and is stored as a sha256 hash. Admin reset — `POST /api/admin/users/:id/reset-password` → the returned temporary password logs in, the old one does not, and the user is flagged to change it (`mustChangePassword`). Roles — `normalizeRole` table incl. `user→agent`, `"superuser"→null`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement: wire `authRateLimit` on `/api/auth/login`, `/api/auth/forgot-password` and `/api/auth/reset-password` (real paths from `auth:393,533`); key on `req.ip` (with `trust proxy` = 1 it is the address nginx saw); lockout in `LocalStrategy`; `deserializeUser` returns `false` for inactive/unapproved; secrets throw at startup in production; seeding gate; hash reset tokens; real admin reset with the same hash routine. **Step 4:** PASS + full suite. **Commit** `fix(security): login lockout and rate limit; no demo accounts in production; secrets fail closed; user role means agent`.

---

## Phase 2 — Tickets (WP5, WP6, WP7)

### Task 7: Error contract and id parameters (P1, P3, T2 part, Y7 NaN)

Re-verified: error handler sends `{message}` then re-throws (`server/index.ts:128-133`); unknown `/api/*` returns 200 `index.html` in production (`vite.ts:82`); NaN ids reach Postgres on PATCH `1084`, DELETE `1208`, comments `1231/1254`, attachments `1614/1660`, auto-response `4333`.

**Files:** Create `server/http/errors.ts`, `server/http/params.ts`; modify `server/index.ts` (error middleware, `/api` 404 before `serveStatic`/`setupVite`), every `:id` handler in `server/routes/index.ts` and `server/routes/teams.ts`. Tests `integration/errorContract.test.ts`, `integration/idParams.test.ts`.

```ts
// server/http/errors.ts
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
  if (err instanceof ZodError) return res.status(400).json({ error: "validation_failed", message: "Invalid input", details: err.flatten() });
  console.error(err);
  return res.status(500).json({ error: "internal_error", message: "Internal server error" });
}
export function apiNotFound(req: Request, res: Response) {
  res.status(404).json({ error: "not_found", message: `No route ${req.method} ${req.path}` });
}
// server/http/params.ts
export function parseIdParam(raw: unknown, name = "id"): number {
  const n = typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "invalid_id", `${name} must be a positive integer`);
  return n;
}
```

- [ ] **Step 1: Failing tests:** `idParams.test.ts` — for every `:id` route found by `rg -n "/:id|/:taskId|/:userId|/:teamId" server/routes`, call with `abc`, `-1`, `0`, `1.5` → 400 JSON `{error:"invalid_id"}` (table-driven list kept in the test). `errorContract.test.ts` — unknown `/api/nope` → 404 JSON; a thrown error → 500 JSON without `stack`; zod failure → 400 with `details`.
- [ ] **Step 2–4:** FAIL → implement (express 4: wrap async handlers with a tiny `asyncHandler` so thrown errors reach the middleware) → PASS. **Commit** `fix(api): JSON error contract; 400 for bad ids; /api 404`.

### Task 8: One ticket access rule everywhere (Y4, D2, T15, I9, owner's agent scope)

Re-verified: lists are scoped by `getVisibleTasksForUser` (`storage:401-500`) but `?assigneeId=` bypasses it (`routes:409`); GET/PATCH/comments/attachments/download/auto-response/feedback/add-to-learning check only customers; `/api/activity` is a global feed; `/api/stats/global` has no role check; managers edit any ticket regardless of department; agents can change status/priority on any ticket.

**Files:** Create `server/permissions/ticketAccess.ts`, tests `unit/ticketAccess.test.ts`, `integration/isolation.matrix.test.ts`; modify `server/storage/index.ts` (`getVisibleTasksForUser` uses `ticketVisibilityWhere`; `getRecentActivity(user)` scoped), `server/permissions/tickets.ts` (`canUpdateTicket` = access + role field table; agent fields only on accessible tickets; manager only inside managed departments), every ticket-scoped handler in `server/routes/index.ts`.

**Interfaces — Produces:**

```ts
// server/permissions/ticketAccess.ts
import { type SQL } from "drizzle-orm";
import { normalizeRole } from "./roles";
import { HttpError } from "../http/errors";
export interface AccessUser { id: string; role: unknown }
/** The one visibility rule. admin: all. manager: assigned/created by them, queued to teams in departments
 *  they manage, or assigned to members of those teams. agent: assigned/created by them, queued to a team
 *  they belong to, or assigned to a teammate. customer: created by them. Unknown role: nothing. */
export function ticketVisibilityWhere(user: AccessUser): SQL;
/** SELECT 1 FROM tasks WHERE id=$1 AND <ticketVisibilityWhere(user)> */
export async function canAccessTask(user: AccessUser, taskId: number): Promise<boolean>;
/** 404 if the ticket does not exist, 403 if it exists but is outside the user's scope. */
export async function assertTaskAccess(user: AccessUser, taskId: number): Promise<void>;
```

- [ ] **Step 1: Failing tests.** `isolation.matrix.test.ts` builds: department D1 (manager M1), D2 (manager M2); team T1 in D1 with agents A1, A2; team T2 in D2 with agent A3; customers C1, C2; tickets: t1 by C1 queued to T1, t2 by C2 assigned to A3, t3 by C1 assigned to A2. `describe.each` over routes `[GET /api/tasks/:id, PATCH /api/tasks/:id (status), GET/POST /api/tasks/:id/comments, GET /api/tasks/:id/attachments, GET /api/tasks/:id/history (Task 10), GET /api/tasks/:id/auto-response, POST /api/tasks/:id/feedback, POST /api/tasks/:id/add-to-learning]` × users `[A1,A2,A3,M1,M2,C1,C2,admin]` × tickets, with the expected allow/deny table written out in the test (e.g. A3 → t1: 403; A1 → t3: allowed (teammate's ticket); C2 → t1: 403; M2 → t1: 403). Also: `GET /api/tasks?assigneeId=<A3>` as A1 → only rows A1 may see; list ids for each user equal the set of ids that user gets 200 on by id (Review Focus 1); `/api/activity` as C1 → only events of C1's tickets; `/api/stats/global` as agent → 403.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `ticketVisibilityWhere` (extract from `getVisibleTasksForUser`, add "created by me" for staff), `assertTaskAccess` at the top of every ticket-scoped handler, AND the `assigneeId` branch with the predicate. **Step 4:** PASS. **Commit** `fix(security): one ticket access rule for lists, ids, comments, attachments and AI routes`.

### Task 9: Ticket create, update, workflow (T1, T2, T3, T7, T10, T12, owner's workflow)

Re-verified: T1 create looks fixed (`ticketNumber` server-generated) — re-probe; create accepts empty title, any category, client-set `status`/`resolvedAt`/`closedAt`/`actualHours`; PATCH category is `z.string()`; the transition guard never runs (`routes:1106` tests `"status" in result`); ticket number = string-sorted max + 1 with no lock (`storage:296-319`); search is case-sensitive `like` (`storage:432,618`).

**Files:** Create `server/permissions/workflow.ts`, `server/services/tickets/schemas.ts` (create/update zod schemas with the enums from Global Constraints; categories from `shared/constants.ts` or the categories table — whichever the UI uses), `migrations/0011_ticket_number_sequence.sql` (a per-year counter table or `SELECT ... FOR UPDATE` on a counter row; idempotent; backfills from existing max numerically). Modify create/PATCH handlers, `storage.getNextTicketNumber`, search to `ilike`. Tests: `integration/tickets.create.test.ts`, `integration/tickets.workflow.test.ts`, `integration/ticketNumber.concurrency.test.ts`, `unit/workflow.test.ts`.

```ts
// server/permissions/workflow.ts — owner decision 2026-10-01
export const STATUSES = ["open", "in_progress", "on_hold", "resolved", "closed"] as const;
export type Status = (typeof STATUSES)[number];
const STAFF_TRANSITIONS: Record<Status, Status[]> = {
  open: ["in_progress", "on_hold", "resolved", "closed"],
  in_progress: ["open", "on_hold", "resolved", "closed"],
  on_hold: ["open", "in_progress", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};
/** Customers may only reopen their own resolved/closed ticket. */
export function assertTransition(role: Role, from: Status, to: Status, isCreator: boolean): void;
```

- [ ] **Step 1: Failing tests:** create returns 201 with `ticketNumber` `/^TKT-\d{4}-\d{4,}$/`, `status:"open"`, `createdBy` = caller (T1); missing title, `"   "` title, `priority:"critical"`, unknown category → 400 with `details`, and the row count unchanged (T2); body `status:"closed"`, `resolvedAt`, `closedAt`, `createdBy` or `ticketNumber` → 400 (the create schema is `.strict()`; these are server-owned), while `estimatedHours`, `actualHours`, `dueDate` and `tags` are accepted and read back unchanged (T18); 20 parallel creates → 20 distinct numbers (Review Focus 4); `TKT-2026-9999` then next → `TKT-2026-10000` (numeric, not string max); workflow: agent closes an accessible ticket → 200 and `closedAt` set; customer closes own ticket → 403; customer reopens own closed ticket → 200, status `open`, `closedAt`/`resolvedAt` cleared; customer reopens someone else's → 403; agent `resolved→on_hold` → 409 `invalid_transition`; search `"PRINTER"` finds a ticket titled "printer jam".
- [ ] **Step 2–4:** FAIL → implement → PASS. **Commit** `fix(tickets): validated create and update, enforced workflow, safe ticket numbers, case-insensitive search`.

### Task 10: Delete, history, comments (T16, T17, T13, D-1, duplicate routes)

Re-verified: every delete 500s (non-cascading FKs from task_comments, task_history, task_attachments, ticket_auto_responses, learning_queue, ticket_complexity_scores, ai_feedback, ai_usage; `storage:781`); no history read endpoint while the client calls `/api/tasks/:id/history` (`ticket-detail.tsx:63`); empty comments accepted (`routes:1252`); shadowed duplicate handlers (`/api/users` `:1302`, comments `:1566-1600`, `/api/admin/knowledge` `:4510` vs `:5594`, `/api/knowledge/search` `:4475` vs `:5821`).

**Files:** Modify `storage.deleteTask` (one transaction: delete comments, history, attachments (and collect S3 keys), auto-responses, complexity scores, learning-queue rows; set `ai_feedback.ticket_id` and `ai_usage.ticket_id` to NULL so cost records survive; then the task; delete S3 objects after commit, logging failures), add `storage.getTaskHistory(taskId)` (actor public name, field, old, new, at), routes (DELETE → 204; `GET /api/tasks/:id/history`; comment body `trim().min(1).max(10000)`), delete every shadowed duplicate route after confirming which copy Express serves (keep the served one's behaviour, plus fixes). Migration `0012_ai_cost_rows_keep_on_ticket_delete.sql` only if `ai_feedback`/`ai_usage` `ticket_id` is NOT NULL today (make it nullable; idempotent). Tests: `integration/tickets.delete.test.ts`, `integration/tickets.history.test.ts`, `integration/comments.test.ts`, `unit/noDuplicateRoutes.test.ts` (walks `app._router.stack` and fails on any method+path registered twice).

- [ ] **Step 1: Failing tests:** admin deletes a ticket that has comments, history, an attachment and an AI usage row → 204; GET → 404; child rows gone; the AI usage row remains with `ticket_id` NULL; agent/customer/manager (flag off) → 403 and the ticket remains. History: create, change status, reassign → `GET /history` lists 3+ entries with actor, field, old, new, at, oldest first; a customer outside the ticket → 403. Comments: `""` and `"   "` → 400; 10001 chars → 400. No duplicate method+path.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Commit** `fix(tickets): delete works and keeps cost records; history endpoint; no empty comments; remove shadowed routes`.

### Task 11: Dashboard and stats (D1, D3)

Re-verified: high-priority filter fixed; `on_hold` missing from `getTaskStats` (`storage:1417-1424`); admin "urgent" counts only open+urgent (`:1168-1171`); `/api/stats` scope differs from list scope (`routes:1527`).

**Files:** `storage.getTaskStats(user)` computed with `ticketVisibilityWhere(user)`; `getAdminStats`; route. Test `integration/stats.test.ts`: for each role, the per-status counts equal the counts of `GET /api/tasks?status=X` paged to the end; `on_hold` present; urgent = all non-closed urgent tickets (document the definition in the test name).
- [ ] FAIL → implement → PASS. **Commit** `fix(dashboard): stats use the list's visibility and count every status`.

---

## Phase 3 — AI and knowledge (WP8, WP9)

### Task 12: AI routes honour settings, access and authorship (I2, I3, I6 follow-ups)

Re-verified: AI settings API exists, but create hard-codes `confidence >= 0.7` and never reads `getAISettings` (`routes:954-980`); auto-response comments are authored as the customer and failures are swallowed (`:985-994`); `/api/ai/analyze-ticket` and `/generate-response` take free text, no 404, any role, no quota (`:5385-5460`); `POST /api/tasks/:id/auto-response/generate` any role on any ticket (`:4373-4427`); `/api/ai/status` any user.

**Files:** routes, `server/services/ai/*` (read settings at create), seed/migration for one system user `ai-assistant` (role `agent`, inactive for login, used as comment author) — migration `0013_ai_system_user.sql` idempotent `INSERT ... ON CONFLICT DO NOTHING`. Tests `integration/ai.routes.test.ts` with the Bedrock client mocked (`server/__tests__/mocks/aws-bedrock.mock.ts`).
- [ ] **Failing tests:** AI disabled in settings → create makes no Bedrock call; threshold 0.9 and confidence 0.8 → no auto-response; auto-response comment author = system user, not the customer; Bedrock throwing → ticket still 201 and the error logged (spy); analyze-ticket/generate-response take `{ ticketId }`, 404 for missing, 403 for inaccessible, 403 for customers; auto-response/generate on an inaccessible ticket → 403; `/api/ai/status` customer → 403.
- [ ] FAIL → implement → PASS. **Commit** `fix(ai): settings honoured at create; AI acts as its own user; AI routes need ticket access`.

### Task 13: Help, policies, guides and input sanitising (Y1, K5, K6, K7, Y7, Y8)

Re-verified: `/api/help`, `/api/help/search`, `/api/help/:id` anonymous (`routes:2318-2345`); `includeInactive` honoured for anyone and inactive policies fetchable/downloadable (`:3138-3330`); `sanitizeInput` runs before `express.json` so it never sees a body (`server/index.ts:11-15`) and only touches top-level strings; guide HTML rendered raw with `dangerouslySetInnerHTML` (`user-guides.tsx:136,144`), CSP allows `'unsafe-inline'` scripts.

**Files:** routes; `server/index.ts` order (body parsers before sanitising); `server/security/validation.ts` (recursive, but do NOT HTML-escape ticket text twice — sanitise HTML only for fields that are rendered as HTML: guide/article content, via `sanitize-html` with an allow-list on write AND on read); CSP `script-src 'self'` (keep `'unsafe-inline'` only for `style-src` if the UI needs it; verify the built app loads in Task 23). Client renders sanitised HTML only. Tests `integration/help.policies.test.ts`, `unit/sanitizeHtml.test.ts`.
- [ ] **Failing tests:** anonymous `/api/help*` → 401; customer `?includeInactive=true` → inactive excluded; inactive policy by id/download → 404 for non-admin; guide saved with `<img src=x onerror=alert(1)><script>alert(2)</script><p>ok</p>` → stored and returned as `<img src="x" /><p>ok</p>` (no handler, no script); a JSON body's nested string reaches the sanitiser (unit test on the middleware order using supertest); `Content-Security-Policy` header has no `'unsafe-inline'` in `script-src`. Email enumeration: `/api/auth/check-email` (if present) returns the same response shape and timing class for existing and missing emails, or is removed if unused by the client.
- [ ] FAIL → implement → PASS. **Commit** `fix(security): help and policies need sign-in; guide HTML sanitised; sanitiser sees bodies; strict script CSP`.

---

## Phase 4 — Notifications, email, teams (WP10, WP11, WP12)

### Task 14: Real-time over an authenticated WebSocket (E5)

Re-verified: broadcasts are called but reach nobody — `clients.set(userId, ws)` is commented out (`routes:5326`) and identity comes from a client message (`:5323`).

**Files:** routes WebSocket setup → move to `server/realtime/ws.ts`: authenticate the upgrade with the session cookie (run the session middleware on the upgrade request), `Map<string, Set<WebSocket>>`, remove on close, broadcast only to users who can access the ticket (`canAccessTask`). Client hook `client/src/hooks/useWebSocket.tsx` stops sending a userId. Test `integration/realtime.test.ts` using `ws` client with the login cookie.
- [ ] **Failing tests:** an unauthenticated upgrade → socket closed (code 1008); A1 connected, ticket t1 (visible to A1) updated → A1 receives `{type:"ticket_updated", ticketId}` within 2 s; A3 (no access) receives nothing; a forged `{type:"auth", userId:<admin>}` message changes nothing; two tabs of A1 both receive.
- [ ] FAIL → implement → PASS. **Commit** `fix(realtime): WebSocket identity from the session; updates reach the right users`.

### Task 15: Teams webhook and team management (E4, G1)

Re-verified: any user can save a Teams webhook URL that receives every ticket (`routes:~4196`, fan-out `1029-1049`, `1176`), plain `fetch` (SSRF); `POST /api/teams` has no role check and makes the creator team admin (`teams.ts:142`, `storage:789-795`).

**Files:** routes, `server/services/microsoftTeams.ts`, `server/routes/teams.ts`. Tests `integration/teamsWebhook.test.ts` (fetch mocked), `integration/teams.manage.test.ts`.
- [ ] **Failing tests:** customer/agent saving webhook settings → 403; admin with `https://evil.example/hook` → 400; `https://<tenant>.webhook.office.com/...` accepted; a new ticket notifies only webhooks of users who can access it (mock records calls); redirects not followed and private/link-local targets refused; customer/agent `POST /api/teams` → 403; manager may create only in a department they manage; admin anywhere.
- [ ] FAIL → implement → PASS. **Commit** `fix(security): Teams webhooks admin-only, allow-listed, scoped; team creation needs manager or admin`.

### Task 16: Inbound email to tickets (E6)

Not present on this branch. Design: SES receipt rule → SNS → `POST /api/email/inbound` (SNS HTTPS subscription). The endpoint verifies the SNS message signature (cert URL host must be `sns.<region>.amazonaws.com`), confirms subscriptions, parses the raw MIME (`mailparser` is NOT allowed without asking — use the SES "content" payload with a minimal MIME parser for text/plain + subject + from + In-Reply-To / `[TKT-YYYY-NNNN]` subject tag; if a proper MIME parser is needed, ask the owner before adding a dependency). New ticket from a known active customer email → ticket with `createdBy` = that user, category from settings; reply whose subject carries an existing ticket number the sender can access → comment; unknown sender → no ticket, logged (configurable later). Attachments: out of scope for this task (logged).

**Files:** Create `server/services/email/inbound.ts`, `server/services/email/snsVerify.ts`, route in `server/routes/email.ts` (mounted from `registerRoutes`), test fixtures `server/__tests__/fixtures/ses/*.json` (made-up addresses), tests `unit/snsVerify.test.ts` (sign fixtures with a test key pair; verifier takes an injectable cert fetcher), `integration/email.inbound.test.ts`.
- [ ] **Failing tests:** valid signed notification from a known customer → 201-equivalent (200 to SNS) and a new ticket with subject/body; reply with `[TKT-2026-0001]` → a comment on that ticket by the sender; reply to a ticket the sender cannot access → no comment; bad signature → 403 and nothing created; cert URL on a non-AWS host → 403; `SubscriptionConfirmation` → confirmation fetch called (mock); duplicate SNS `MessageId` → processed once.
- [ ] FAIL → implement → PASS. **Commit** `feat(email): inbound SES email creates tickets and comments (SNS-verified)`.

### Task 17: Remaining contract items (T5, T6, T8, T9, T18, K2, I4, A7, A9)

Gap rank 31 and requirements not owned by another task. Re-verified: K2 — a PATCH with no body does not toggle publish; I4 — feedback on a ticket without an auto-response returns 500; T18 — `dueDate:null` cannot clear the date.

**Files:** routes (knowledge publish, AI feedback, tasks list/my), `server/permissions/tickets.ts` (`dueDate` nullable, `tags`, `estimatedHours`, `actualHours` in the update schema with role rules: staff only for hours), storage. Tests `integration/contract.minor.test.ts`.
- [ ] **Failing tests:** `PATCH /api/admin/knowledge/:id/publish` with no body flips `isPublished` both ways; `GET /api/knowledge/search` never returns unpublished articles (K2). `POST /api/tasks/:id/auto-response/feedback` on a ticket with no auto-response → 404 `{error:"not_found"}`; `POST /api/ai-feedback` then `GET /api/ai-feedback/:type/:referenceId` returns the stored rating (I4). PATCH `dueDate:null` clears it; `tags` round-trip; customer setting `actualHours` → field ignored and listed in `ignoredFields` (T18). `GET /api/tasks?status=open`, `?category=<c>`, `?assigneeId=<id>` return only matching visible tickets (T6); `limit=2&offset=0` then `offset=2` → no overlap, at most 2 each (T8); `GET /api/tasks/my` → only tickets assigned to the caller (T9); every list row carries number, title, status, priority, assignee (T5). Admin `PATCH /api/admin/users/:id` with `role` changes it and login returns it; self-registration defaults to `customer` (A7). `GET /api/sso/status` reports configured/not configured without secrets; `GET /api/auth/microsoft` redirects to `login.microsoftonline.com` when configured, 404/503 JSON when not (A9; the Microsoft callback itself is external and is listed as such in Task 24's table).
- [ ] FAIL → implement → PASS. **Commit** `fix(api): publish toggle, AI feedback 404, clearable due date, list filters and pagination, role changes`.

---

## Phase 5 — Admin, API keys, secrets in settings (WP13, WP14)

### Task 18: Hashed, admin-issued API keys; SSO/SES secrets masked (S3, S6, E1)

Re-verified: API keys from `Math.random`, `keyHash` = plaintext, `getApiKeyByHash` never called and ignores expiry, `/api/api-keys` open to every user with caller-chosen `permissions` (`storage:1640-1650`, `routes:1892-1908`); `/api/sso/config` (admin) returns `clientSecret`.

**Files:** Create `server/services/auth/apiKeys.ts`, `migrations/0014_api_keys_hashed.sql` (deactivate legacy rows `UPDATE api_keys SET is_active=false WHERE key_hash NOT LIKE 'sha256:%'`, unique index on `key_hash`; idempotent), modify routes, storage, `client/src/pages/admin/Integrations/DeveloperResources.tsx` (issue for a chosen user, show plaintext once). Tests `integration/apiKeys.test.ts`, `integration/sso.secrets.test.ts`.

```ts
// server/services/auth/apiKeys.ts
export function generateApiKey(): { plaintext: string; hash: string } // plaintext "tfk_" + randomBytes(32).base64url; hash "sha256:" + hex
export async function findActiveKey(plaintext: string): Promise<{ keyId: number; user: User } | null> // active, unexpired, owner isActive && isApproved; updates lastUsedAt
```

- [ ] **Failing tests:** non-admin `POST /api/api-keys` → 403; admin issues a key for customer C1 → response has `tfk_...` once; the stored row has `sha256:` and not the plaintext; `permissions` from the body ignored (server sets `["mcp:tickets"]`); default expiry 90 days; `GET /api/sso/config` → `clientSecret` absent, `hasClientSecret: true`.
- [ ] FAIL → implement → PASS. **Commit** `fix(security): API keys hashed and admin-issued; SSO secret never returned`.

### Task 19: Bearer authentication for REST (prerequisite of MCP; M2)

**Files:** Create `server/services/auth/bearer.ts`; install in `setupAuth` right after `passport.session()`. Accepts `Authorization: Bearer tfk_...` (via `findActiveKey`) and `Bearer <JWT>` only when `JWT_SECRET` is set (no fallback; reload the user by id; ignore the token's role). Sets `req.user`; a present-but-invalid bearer → 401 even with a valid cookie. Tests `integration/bearer.test.ts`.
- [ ] **Failing tests:** valid key → `GET /api/auth/user` 200 as the key's owner and `GET /api/tasks` scoped to that owner; garbage/expired/revoked/inactive-owner key → 401; JWT with a forged `role:"admin"` for a customer → still customer scope.
- [ ] FAIL → implement → PASS. **Commit** `feat(auth): bearer API keys and JWT for REST`.

---

## Phase 6 — MCP (WP15–WP18, M1–M9)

Design reference: Streamable HTTP, stateless, `POST /api/mcp` on the same Express app, mounted after `registerRoutes` and before the `/api` 404, `serveStatic` and `setupVite`; GET/DELETE `/api/mcp` → 405. Every tool calls the shared ticket service with `req.user`; the MCP layer holds no role logic.

### Task 20: Ticket service extraction + MCP server, tool list, auth (M1, M2)

**Files:** Create `server/services/tickets/{ticketService,serializers,notifier}.ts` (REST ticket handlers become thin adapters over it — same behaviour, now tested by Tasks 8–10's suites), `server/mcp/{router,server,tools,errors}.ts`. `package.json`: `@modelcontextprotocol/sdk@1.31.0`, zod `^3.25`. Tests `unit/mcp/toolsList.test.ts` (SDK `InMemoryTransport` + `Client`), `integration/mcp/auth.test.ts`, `integration/mcp/listTickets.pagination.test.ts`.

```ts
// server/services/tickets/ticketService.ts — the one place ticket rules live
export class TicketError extends Error { constructor(public code: "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE", message: string, public details?: unknown) { super(message); } }
export async function createTicket(user: User, input: unknown): Promise<TicketDTO>;
export async function getTicket(user: User, id: number, opts?: { includeComments?: boolean }): Promise<TicketDTO>;
export async function listTickets(user: User, q: ListQuery): Promise<{ tickets: TicketDTO[]; limit: number; offset: number; returned: number; hasMore: boolean }>;
export async function updateTicket(user: User, id: number, patch: unknown): Promise<{ ticket: TicketDTO; appliedFields: string[]; ignoredFields: string[] }>;
export async function closeTicket(user: User, id: number): Promise<TicketDTO>;
export async function reopenTicket(user: User, id: number): Promise<TicketDTO>;
export async function deleteTicket(user: User, id: number, confirm: boolean): Promise<{ deleted: true; id: number; ticketNumber: string }>;
export async function addComment(user: User, id: number, content: unknown): Promise<CommentDTO>;
```

- [ ] **Failing tests:** `tools/list` returns exactly `create_ticket, get_ticket, list_tickets, update_ticket, close_ticket, reopen_ticket, delete_ticket, add_comment`, each with a description and an object input schema (M1). No credential / garbage / expired / revoked key → HTTP 401 with `WWW-Authenticate: Bearer` and the ticket row count unchanged (M2); the same key works on `GET /api/auth/user`. `list_tickets` with 60 visible tickets, `limit:25` → `hasMore:true`; paging by offset reaches all 60 exactly once (Review Focus 5).
- [ ] FAIL → implement → PASS. **Commit** `feat(mcp): ticket service and MCP server with authenticated tool listing`.

### Task 21: MCP create/get/list/update/close/reopen (M3–M7)

**Files:** `server/mcp/tools.ts`; tests `integration/mcp/createGetList.test.ts`, `integration/mcp/updateCloseReopen.test.ts`.
- [ ] **Failing tests:** `create_ticket` valid → ticket with `ticketNumber`, `createdBy` = caller; `GET /api/tasks/:id` shows it (M3); invalid priority → `isError` with `code:"VALIDATION"` and no row (M3). `get_ticket`/`list_tickets` return the same ids in the same order as REST for customer, agent, manager, admin across every filter/limit/offset (M4, M5); invented status `"Waiting for Review"` → VALIDATION, never an empty list. `update_ticket` changes only supplied fields, writes the same `task_history` rows as a REST PATCH on a twin ticket, reports `ignoredFields` for fields the role may not change (M6). `close_ticket` twice → second INVALID_STATE; customer close → FORBIDDEN; `reopen_ticket` by the customer creator → open; by another customer → FORBIDDEN (M7, owner's workflow).
- [ ] FAIL → implement → PASS. **Commit** `feat(mcp): create, get, list, update, close and reopen tools`.

### Task 22: MCP delete, add_comment, isolation for every tool (M8, M9)

**Files:** `server/mcp/tools.ts`; tests `integration/mcp/deleteComment.test.ts`, `integration/mcp/isolation.test.ts`.
- [ ] **Failing tests:** `delete_ticket` without `confirm:true` → VALIDATION and the ticket remains; admin with confirm → deleted and REST GET 404; agent/customer/manager (flag off) with confirm → FORBIDDEN (M8). `add_comment` → visible in `GET /api/tasks/:id/comments`; empty → VALIDATION; inaccessible ticket → FORBIDDEN (M9). `describe.each` over all 8 tools: customer B and unrelated agent U against A's ticket → FORBIDDEN and snapshots (ticket row, comment count, history count) unchanged; B's `list_tickets` search for A's unique word → none. Every tool: success, validation, unauthenticated, forbidden, not-found. A walk of every tool output finds no secret keys (`findSecrets`).
- [ ] FAIL → implement → PASS. **Commit** `feat(mcp): delete with confirmation, comments, and isolation tests for every tool`.

---

## Phase 7 — Browser end-to-end and finish

### Task 23: Playwright end-to-end

**Files:** `playwright.config.ts` (webServer: build + start against the test Postgres with `SEED_DEMO_DATA=true` and generated passwords from env; baseURL `http://localhost:5055`), `e2e/tickets.spec.ts`, `e2e/isolation.spec.ts`, `package.json` script `"e2e": "playwright test"`.
- [ ] **Tests:** customer logs in, creates a ticket (sees `TKT-` number), adds a comment, sees an agent's reply; agent closes it; customer reopens it; customer B cannot open customer A's ticket URL (sees not-found/forbidden page) and does not see it in the list; the app loads with the strict CSP (no console CSP violations).
- [ ] `npm run e2e` → PASS. **Commit** `test(e2e): Playwright flows for create, comment, close, reopen and isolation`.

### Task 24: Whole-branch verification and docs

- [ ] `npm run check` (0), `npm run lint` (0 errors), `npm test` (all projects green; list skips by name), `npm run build`, `npm run e2e`.
- [ ] Update `API_ENDPOINTS_REFERENCE.md` and the Postman collection for changed endpoints (error shape, 204 delete, history, API keys, MCP, inbound email) — P3.
- [ ] Re-run the requirement table: for each ID in `ticketflow-requirements.md`, the test that proves it (file::test) or "external" with the reason; save as `docs/dc4-validation-2026-10-01/requirements-status-after-fixes.md`.
- [ ] Final review by a fresh reviewer on the most capable model over the whole branch diff.
- [ ] **Commit** `docs: endpoint reference, Postman collection and requirement status after the fix program`.
