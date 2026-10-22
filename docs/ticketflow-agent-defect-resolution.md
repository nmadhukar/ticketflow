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

---

# Second review round ? three findings

Branch `feat/ai-triage-routing`. Same rule as above: each finding has a test that detects it.

## Summary

| # | Finding | Before | After |
|---|---------|--------|-------|
| A | Hindsight memories were shared across customers | **fail** | **pass** |
| B | The create-time hooks announced the pre-routing assignment | **fail** | **pass** |
| C | The reasoning retry had no headroom for hidden reasoning | **fail** | **pass** |

## A ? Hindsight memory crossed customers

**What was wrong.** Every resolved ticket was stored as one memory in a single bank with no
per-customer scope, and recall pulled from that whole bank. A ticket from customer B could
therefore have customer A's earlier resolution quoted back into its reply.

**The fix.** A memory now carries a `customer:{userId}` scope tag on retain, and recall sends that
same tag as a strict filter (`tags: [...], tags_match: "any_strict"`), so one customer's resolutions
can only ever be recalled for that same customer. A caller with no customer (a background job) still
gets the unscoped recall it always had.

**Regression tests.**
- `scopes a recall to one customer, and leaves an unscoped call unfiltered` ? `server/__tests__/unit/hindsight.test.ts`
- `stores a resolved ticket's memory with the creator's scope tag` ? `server/__tests__/unit/hindsight.test.ts`
- `scopes recall and retain to the same customer, so memories cannot leak across customers` ? `server/__tests__/integration/hindsightMemory.test.ts`

**Honest note on the "internal comments" half of the finding.** This app has no internal-note flag
on `task_comments` (the table is id / taskId / userId / content / createdAt) and no "internal
comment" concept anywhere in the code, so the retained memory could not be filtering a flag that
does not exist. What it does retain is the ticket title, description and its last three comments,
which for a resolved ticket are the resolution thread. The cross-customer leak was real and is fixed;
if a private-comment feature is later added, this retain query will need the same filter.

## B ? The create-time hooks announced the pre-routing assignment

**What was wrong.** Routing runs inside `runTicketCreatedHooks`, after the row is written. The
broadcaster and the Teams "created" webhook were still handed the row as it was created, and
`POST /api/tasks` returned that same row in its 201. So a client received the routing "updated"
event before the "created" event, and "created" showed the triage queue the ticket had already left.
Webhook recipients are worked out from the ticket, so the team the ticket actually landed on could
be left out.

**The fix.** `runTicketCreatedHooks` now re-reads the ticket after the AI step and returns that row;
the broadcast, the webhook and the caller's 201 all use it. A re-read that finds nothing (a delete
racing the create) falls back to the row that came in.

**Regression tests.**
- `the create response carries the routed row, not the triage snapshot it was created with` ? `server/__tests__/integration/ticketRouting.test.ts`
- `the created broadcast and webhook see the routed row` ? `server/__tests__/integration/ticketRouting.test.ts`

## C ? The reasoning retry could still come back cut off

**What was wrong.** When a provider rejects the `reasoning` field the client retries without it.
That gets past the HTTP 400, but a model that reasons by default then spends hidden reasoning tokens
out of `max_tokens`, and the structured operations reject `finish_reason: "length"`. A small cap
(`analyzeTicket` asks for 500 tokens) could be spent thinking, so the retry failed anyway.

**The fix.** The retry now asks for headroom (up to +1000 tokens) on top of the original allowance,
clamped to the per-request ceiling, so prompt plus retry still fits `maxTokensPerRequest`. The
budget preflight now checks that same ceiling (only for a call that sends the reasoning field, the
only ones that can retry), so the larger retry is covered by the request and cost limits; the call
without a retry still checks its own allowance.

**Regression tests.**
- `gives the reasoning retry headroom so hidden reasoning cannot eat the answer` ? `server/__tests__/unit/openRouterClient.test.ts`
- `never lets the reasoning retry ask for less than the first attempt` ? `server/__tests__/unit/openRouterClient.test.ts`

## Full run after these three

| Suite | Result |
|-------|--------|
| `tsc --noEmit` | clean |
| `npm run lint` | 0 errors |
| Unit | 665 passed |
| Integration | 1706 passed (91 suites) |
| Client | 56 passed |

## Third review round ? budget, test-type and ceiling findings

| # | Finding | Severity | Before | After |
|---|---------|----------|--------|-------|
| D | Retry tokens could exceed the cost limits | High | **fail** | **pass** |
| E | Two test types did not compile | Medium | **fail** | **pass** |
| F | A missing ceiling produced an unbudgeted bump | Low | **fail** | **pass** |

**D.** The reasoning retry may ask for up to 1000 tokens more than the first attempt, but the budget
preflight checked only the first attempt's allowance, so a retry could spend past the daily or
monthly limit. The preflight now checks `ceilingOutputTokens` ? and only a call that sends the
reasoning field (the only ones that can retry) carries that headroom; a call without one still
checks its own allowance. Regression test: "pages the retry ceiling into the daily and monthly
preflight" in `server/__tests__/unit/aiBudget.test.ts`.

**E.** Two test types went stale when the hooks changed: the inbound-email transaction test mocked
`runTicketCreatedHooks` as resolving `undefined` (it returns a `Task` now), and the memory test
helper's item type lacked `tags`. Both now type-check; `npm run check` is clean on all three
configs.

**F.** When `maxOutputTokensCeiling` was omitted, the retry added 1000 tokens to an allowance nobody
budgeted. It now falls back to the original allowance. Regression test: "never lets the reasoning
retry ask for less than the first attempt" plus the zero-usage default in the unit client suite.

## One thing this does not prove

- **Finding C against a live provider.** The retry fires on HTTP 400/422, the same reasoned trigger
  as bug 5 above. No live model was available to confirm a real provider's refusal status, so the
  headroom is reasoned rather than observed; the clamp and the headroom amount are one-line changes.
