# AI triage agent — resolution of the seven reported defects

Branch `feat/ai-triage-routing`, commit `0fd9bb7`, 2026-10-21.

Each defect below has a test that **fails against the code before the fix and passes after it**.
That is the point of the table: the tests were not written to match whatever the code does, they
were written to detect the defect.

## Summary

| # | Defect | Before | After |
|---|--------|--------|-------|
| 1 | Hindsight memory broke every auto-reply | **fail** | **pass** |
| 2 | Routing overwrote an agent's assignment | **fail** | **pass** |
| 3 | Routed tickets never notified the new team | **fail** | **pass** |
| 4 | Truncated output failed on every operation | **fail** | **pass** |
| 5 | Providers refusing the reasoning field broke all JSON calls | **fail** | **pass** |
| 6 | A low-confidence guess moved the ticket anyway | **fail** | **pass** |
| 7 | Search dropped non-English words | **fail** | **pass** |

## The defects

### Bug 1 — Hindsight memory broke every auto-reply

**What was wrong.** a recalled memory has no article id; resolveCitedArticles produced NaN, which failed the schema and discarded the whole analysis

**Regression test.** `a recalled memory does not break the reply` in `server/__tests__/integration/hindsightMemory.test.ts`

**Evidence.** Against the pre-fix code the test fails; against the fixed code it passes.

```
before fix : 1 failed, 4 skipped, 5 total   -> FAIL
after fix  : 4 skipped, 1 passed, 5 total   -> PASS
```

### Bug 2 — Routing overwrote an agent's assignment

**What was wrong.** the decision was taken on the row as created and written seconds later, clearing an assignment a person had made

**Regression test.** `re-reads before writing` in `server/__tests__/integration/ticketRouting.test.ts`

**Evidence.** Against the pre-fix code the test fails; against the fixed code it passes.

```
before fix : 1 failed, 9 skipped, 10 total   -> FAIL
after fix  : 9 skipped, 1 passed, 10 total   -> PASS
```

### Bug 3 — Routed tickets never notified the new team

**What was wrong.** the write bypassed afterTicketUpdated, so the realtime broadcast and Teams webhooks saw the old triage assignment

**Regression test.** `notifies the new team through the normal update hooks` in `server/__tests__/integration/ticketRouting.test.ts`

**Evidence.** Against the pre-fix code the test fails; against the fixed code it passes.

```
before fix : 1 failed, 9 skipped, 10 total   -> FAIL
after fix  : 9 skipped, 1 passed, 10 total   -> PASS
```

### Bug 4 — Truncated output failed on every operation

**What was wrong.** finish_reason 'length' was fatal for all calls, including the help chat and the 50-token connection test

**Regression test.** `rejects a cut-off answer only when the caller needs complete output` in `server/__tests__/unit/openRouterClient.test.ts`

**Evidence.** Against the pre-fix code the test fails; against the fixed code it passes.

```
before fix : 1 failed, 16 skipped, 17 total   -> FAIL
after fix  : 16 skipped, 1 passed, 17 total   -> PASS
```

### Bug 5 — Providers refusing the reasoning field broke all JSON calls

**What was wrong.** the field was sent unconditionally with no fallback

**Regression test.** `retries once without the reasoning field` in `server/__tests__/unit/openRouterClient.test.ts`

**Evidence.** Against the pre-fix code the test fails; against the fixed code it passes.

```
before fix : 1 failed, 16 skipped, 17 total   -> FAIL
after fix  : 16 skipped, 1 passed, 17 total   -> PASS
```

### Bug 6 — A low-confidence guess moved the ticket anyway

**What was wrong.** confidence was parsed but never compared, so a 5% guess reassigned the ticket

**Regression test.** `a low-confidence guess does not move the ticket out of triage` in `server/__tests__/integration/ticketRouting.test.ts`

**Evidence.** Against the pre-fix code the test fails; against the fixed code it passes.

```
before fix : 1 failed, 9 skipped, 10 total   -> FAIL
after fix  : 9 skipped, 1 passed, 10 total   -> PASS
```

### Bug 7 — Search dropped non-English words

**What was wrong.** the tokenizer split on [^a-z0-9], so accented and non-Latin tickets produced no search terms at all

**Regression test.** `keeps an accented word` in `server/__tests__/unit/aiAutoResponse.test.ts`

**Evidence.** Against the pre-fix code the test fails; against the fixed code it passes.

```
before fix : 1 failed, 24 skipped, 25 total   -> FAIL
after fix  : 24 skipped, 1 passed, 25 total   -> PASS
```

## Wider regression run

Beyond the seven targeted tests, the full suites pass on the fixed commit:

| Suite | Result |
|-------|--------|
| TypeScript (`npx tsc --noEmit`) | clean |
| Lint | 0 errors |
| Unit | 660 passed |
| Integration | 1703 passed (91 suites) |
| Client | 56 passed |

## Reproducing this

The targeted tests need the integration test database up for bugs 1, 2, 3 and 6:

```powershell
npm.cmd run test:db:up       # start the test Postgres (port 55433)
npm.cmd run test:db:push     # apply the schema to it
npm.cmd run test:integration # 91 suites, 1703 tests
npm.cmd run test:unit        # 660 tests, no database needed
npm.cmd run test:client      # 56 tests
```

A single defect can be re-checked on its own, for example bug 6:

```powershell
npx.cmd jest --selectProjects integration --runInBand server/__tests__/integration/ticketRouting.test.ts -t "a low-confidence guess"
```

## Two things this does not prove

- **Bug 5 against a live provider.** The retry fires on HTTP 400/422. No live model was available to
  confirm which status a real provider returns when it refuses the `reasoning` field, so that fix is
  reasoned rather than observed. If the real provider uses a different status, it is a one-line change.
- **Bug 4 is a behaviour decision, not a pure fix.** A truncated reply from the help chat is now
  returned as a short answer instead of an error. That was the intent, but it is a deliberate change
  worth confirming.
