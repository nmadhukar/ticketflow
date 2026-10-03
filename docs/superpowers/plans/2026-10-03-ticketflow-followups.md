# TicketFlow Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Land the DC4 gate work, fix every follow-up the 2026-10-02 fix program deferred, and close the 16 requirements that had no test.

**Architecture:** Branch `fix/followups-2026-10-03` from `main` (1311e5d, the merged fix program). Tasks run in parallel git worktrees with one test database each, then merge here. After a final review, the branch lands on `main` through a PR merged by the DeepSeek Harness GitHub App. The owner approved this route on 2026-10-02.

**Tech Stack:** TypeScript ESM, Express 4, React/Vite, drizzle-orm (node-postgres), passport sessions, zod, Jest + supertest, Playwright, Docker.

**Spec / sources (binding):**
- `docs/ticketflow-fix-program-release-notes.md` section 5 "Follow-ups". Every line is in scope unless a ruling below excludes it.
- `docs/dc4-validation-2026-10-01/requirements-status-after-fixes.md`. The 16 "Not covered" rows: A4, I5, I6, I8, I9, K4, K8, G2, G3, G5, S2, S4, S5, Y9, P2, P3.
- `docs/dc4-validation-2026-10-01/ticketflow-requirements.md`, for the requirement wording.
- Branch `dc4/gate` (e1de508), the harness gate: `Dockerfile`, `docker-compose.yml`, `docker/db.ts`, `scripts/ai/verify.sh`. It is built on the OLD main (15621d1).

## Owner decisions
- 2026-10-03: "merge dc4 work in this.. and then fix the #2 issues and then merge all and git commit git push remote", then "complete end to end".
- Standing: auto-approved, no waiting.
- Earlier owner decisions still hold: role `user` is an agent; agent scope is own tickets + team queue + teammates; staff close; staff and the creating customer reopen.

## Global Constraints
- Same as the fix program (`docs/superpowers/plans/2026-10-01-ticketflow-fix-program.md`, lines 21-31).
  - Stage explicit paths only.
  - Never edit an applied migration. New migrations continue after `0019`, check the highest number first, and must be idempotent.
  - No secrets in commits.
  - Error contract `{error, message, details?}`.
  - Closed status and priority sets.
  - No secret user fields in responses.
  - No new runtime dependencies without a ruling.
- Production applies the schema with `db:migrate-sql` and then `drizzle-kit push` (Rulings R10, R32). Every schema change goes in `shared/schema.ts`, plus an idempotent SQL file.
- Never stage `API_Documentation.md` or `API_DOCUMENTATION.md`; they collide on Windows.
- Every task ends green:
  - `npm run check`
  - `npx eslint .` (0 errors)
  - `npx jest --runInBand`
  - the unit project with no DB env
  - then a commit

## Rulings for this plan
- **R36:** Emailed tickets and unassigned customer tickets go to `DEFAULT_TRIAGE_TEAM_ID` when it is set. The team must exist (checked at startup; on a bad id, log and ignore). When it is unset, they stay admin-triage, as today. This closes M2 without widening the visibility rule.
- **R37:** Whitespace and line-ending churn items are NOT changed: Task 3 CRLF, whitespace-only lines, and the CRLF in `seedUsers` and `storage.inteface`. They change no behaviour, and churn hurts blame and merges.
- **R38:** A requirement whose endpoint was deliberately not ported, or is not used by any client (I8 Bedrock KB sync per R5, K8 presigned URL if no client calls it), is closed as "superseded" with the reason. The real path that replaces it gets a test (for example, attachment upload with S3 mocked). No dead endpoint is re-added.
- **R39:** The gate's Docker files must not replace the production `Dockerfile` and `docker-compose.yml` (R35, R32).
  - They move to `docker/gate/` (`Dockerfile.gate`, `docker-compose.gate.yml`; `docker/db.ts` stays if still needed).
  - `scripts/ai/verify.sh` is adapted to them and to the current app: Node 24, `APP_BASE_URL`, `db:migrate-sql` before push, the current test commands, and the e2e image matching `@playwright/test` 1.63.
  - The harness runs `scripts/ai/verify.sh`, so that path stays.
- Items the release notes mark "fixed by the final dispatch" are done; skip them.

---

### Task FU0: Merge the DC4 gate (branch dc4/gate)
- Merge `dc4/gate` into the branch, applying R39.
- Run `scripts/ai/verify.sh` locally under Docker Desktop. It must end `RESULT: PASS` with a `TESTS[...]` line that matches the Jest totals.
- Document the gate in `docs/` (how the harness and a developer run it).
- Commit: `chore(gate): merge the DC4 harness gate, relocated under docker/gate and updated for the current app`.

### Task FU1: Build, lint and test tooling follow-ups
- Every line under "Build, lint and test tooling", except the R37 churn items.
- Includes:
  - the discriminating `deleteTask` lock test;
  - noDuplicateRoutes also seeing `/health` and `/api/security/health`;
  - the e2e CSP listener attached before login, and a strict 404 matcher;
  - removing unused mocks and utils;
  - the jest regex escape;
  - the tsconfig.test cleanup;
  - an eslint `caughtErrors` decision (enable `all` and fix, or document).
- Commit: `chore(test): tooling follow-ups`.

### Task FU2: Authentication, sessions and accounts follow-ups
- Every line under "Authentication, sessions and accounts".
- Also the M8 system-user email clash: guard it like the AI user.
- Also delete `server/security/secureAuth.ts` and the dead `sanitizeForSQL` and `sanitizeText`.
- Duplicate email on register stays 400 `email_registered` (Task 13 made the answer uniform). Do NOT change it to 409.
- Commit: `fix(auth): follow-ups`.

### Task FU3: Ticket access, workflow, contract and list performance
- Every line under "Ticket access, workflow and API contract".
- M9: one joined query per page for REST and MCP lists, with the same results and order. The existing parity tests are the proof.
- Implement R36.
- Move the customer routing rewrite into ticketService.
- Single access check on REST by-id.
- Audit userId from `req.user.id`.
- Commit: `fix(tickets): follow-ups, R36 triage routing, joined list query`.

### Task FU4: AI, realtime, Teams, inbound email and MCP follow-ups
- Every line under "AI", "Realtime, Teams webhooks and inbound email" and "MCP".
- Also: Teams links for MCP-created and MCP-updated tickets, built from the APP_BASE_URL helper.
- The DNS-rebinding pin stays documented only. It would need a dependency, and this plan adds none.
- Commit: `fix(integrations): follow-ups`.

### Task FU5: Security hardening, deployment and docs follow-ups
- Every line under "Security hardening and deployment" and the deployment lines under "From the final whole-branch review":
  - production refuses to boot when `NODE_ENV` is unset and `dist` exists, or at least logs loudly; say which;
  - `pg` moves to `dependencies`;
  - the legacy ticket prefix longer than 6 characters: the settings tab can save other fields, and the prefix is validated only when changed;
  - the Dockerfile `CMD` comment plus a compose note;
  - the README and DEVELOPER_DOCUMENTATION compose command;
  - the migration NOT_RUN guidance in docs.
- Commit: `fix(deploy): follow-ups`.

### Task FU6: Close the 16 uncovered requirements
- For each of A4, I5, I6, I8, I9, K4, K8, G2, G3, G5, S2, S4, S5, Y9, P2, P3: read the row in the status doc and the requirement wording, then write the test that proves it.
  - If the behaviour is broken, fix it.
  - If R38 applies, close it as superseded and test the replacing path.
- Update `requirements-status-after-fixes.md` so every row is proven, external or superseded, each with a reason.
- Commit: `test: cover the remaining requirements`.

### Task FU7: Whole-branch verification, docs and landing
1. Run the following on the merged branch in a clean worktree:
   - `npm run check`
   - lint
   - jest
   - unit with no DB
   - build
   - e2e
   - `scripts/ai/verify.sh`
2. Update the release notes, adding a "Follow-ups round" section with:
   - new rulings R36-R39;
   - behaviour changes;
   - new env (`DEFAULT_TRIAGE_TEAM_ID`).
3. Remove the follow-up lines that are now done.
4. Run the final review on the most capable model.
5. Push the branch, open the PR, and merge it with the App, sha-pinned.
