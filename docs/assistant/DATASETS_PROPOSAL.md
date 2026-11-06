# Proposal: Mastra Datasets for TicketFlow assistants

**Status:** steps 1–4 built; step 5 (live mode) pending review
**Scope:** `agents/` (Mastra sidecar) + a test harness in the app process
**Goal:** a repeatable quality suite for `ticket-assistant` and `support-assistant`, so prompt/model changes can be measured instead of guessed.

---

## 1. What a dataset is

A dataset is a versioned list of test cases. Each item is an `input` (the prompt) plus an optional `groundTruth` (the expected result). An **experiment** runs every item through a target agent, and **scorers** grade each output 0–1.

```
dataset = [ item, item, item, ... ]
        → startExperiment({ targetType: 'agent', targetId, scorers })
        → per-item output + scores
```

Every mutation creates a new dataset version, so a past experiment can be reproduced exactly.

---

## 2. What we will test

Three groups, matching the rules the agents already carry in `agents/src/mastra/agents/rules.ts`:

| Group | Example case | Passes when |
|---|---|---|
| **Facts from tools** | "What is the status of TKT-2026-0151?" | Answer matches the mocked tool output; no invented status, date or count |
| **Tool choice** | "Show me my open tickets" | Calls `list_tickets`; does not call `propose_comment` |
| **Business rules** | "Post that reply" / "What's in ticket TKT-2026-9999?" | Proposes (never claims posted); says "not found for you" without guessing |

Target: ~15 items for `ticket-assistant`, ~8 for `support-assistant`.

---

## 3. Decisions (from review)

1. **Storage** — existing dev Postgres, dedicated `mastra` schema, initialised independently of staff chat history.
2. **Test auth** — dedicated test users with valid session tokens, one customer and one staff.
3. **Tool testing** — mocked MCP tools for automated runs.
4. **Integration testing** — opt-in real MCP calls against dedicated test tickets, cleaned up afterwards.
5. **No new infrastructure** — reuse the existing database, auth and sidecar.

---

## 4. Findings that shape the design

### 4.1 Storage is currently gated on staff history

`agents/src/mastra/storage.ts`:

```ts
export const storage = historyOn && url ? createStore(url, STORAGE_POOL_MAX) : undefined;
```

With `ASSISTANT_STAFF_HISTORY` off, Mastra falls back to an in-memory store and datasets are lost on restart.

**Change:** create the store from `MASTRA_DATABASE_URL` alone. Keep `staffMemory` gated on `historyOn` — memory and storage are separate concerns.

**Also required:** `config-issues.ts` validates `MASTRA_DATABASE_URL` only inside `historyIssues()` (line 103). That check must move out, or a bad URL silently returns us to in-memory datasets.

### 4.2 A minted token alone cannot call tools

`server/assistant/runAuth.ts` `authenticate()` requires the run to exist in an in-memory map:

```ts
const run = this.runs.get(claims.jti);
if (!run) return { ok: false, reason: "run_not_open", ...ids };
```

That map is only populated by `runs.start()`, called from `bridge.ts` line 410 — i.e. only when a real signed-in user sends a chat request. A token minted by a script is cryptographically valid but refused at the first tool call.

**Decision 2 as written therefore needs one adjustment.** Two options:

- **Option A (recommended):** the harness starts the app's internal listener in-process (`startInternalServer()`) and calls `assistantRuns().start(userId, agentId)` directly. Same object the bridge uses, so the run is genuinely open and every check (`loadUser`, `keyOwnerBlockReason`, role→agent mapping) runs for real. No new endpoints, no new infrastructure.
- **Option B:** a dev-only endpoint that opens a run. New attack surface; contradicts decision 5.

### 4.3 The harness must run in the app process

`config-issues.ts` lines 36–38 make the sidecar **refuse to start** if `ASSISTANT_SESSION_SECRET` is set. The MCP-hop secret never leaves the app. So the harness lives in the app process, which holds both secrets — not in `agents/`.

### 4.4 Test users must be active and approved

`keyOwnerBlockReason` → `loginBlockReason` refuses inactive, unapproved and system accounts. Role mapping (`shared/assistant.ts`): `customer` → `support-assistant`; `agent`/`manager`/`admin` → `ticket-assistant`.

### 4.5 The `mastra` role cannot read TicketFlow tables

`scripts/db/provision-assistant-db.mjs` revokes all access to `public`. This stays as is: datasets live in `mastra`, test users live in `public`, and only the app process touches both.

### 4.6 Mocks intercept execution, not discovery

`loadRunTools` discovers tools over HTTP as the run's user. The internal listener must be up even in mock mode; `toolMocks` + `unmockedToolPolicy: 'deny'` then prevent any real call.

---

## 5. Proposed implementation

| Step | Change | Files |
|---|---|---|
| 1 | Decouple storage from staff history | `agents/src/mastra/storage.ts`, `config-issues.ts`, `agents/tests/server-config.test.mjs` |
| 2 | Seed two test users (idempotent) | new `scripts/db/seed-eval-users.mjs` |
| 3 | Harness: internal listener + open run + `RequestContext` | new `server/__tests__/eval/harness.ts` |
| 4 | Dataset + ~23 items, mock mode | new `agents/src/mastra/datasets/` |
| 5 | Opt-in real-mode experiment with cleanup | same, behind a flag |

**Scorers, in order of preference:**

1. Deterministic — exact tool-call match (`extractToolCalls` in `preprocess`), forbidden-string check, ticket-number format check.
2. LLM judge — only for "did it invent a fact", where no deterministic check exists.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Real tickets touched by an experiment | Mock mode is the default; real mode is opt-in and uses dedicated test tickets only |
| Datasets written to a shared dev DB | `mastra` schema only; never production |
| Storage change alters existing history behaviour | `staffMemory` stays gated on `ASSISTANT_STAFF_HISTORY`; existing tests must pass unchanged |
| Model cost per run | Small dataset, deterministic scorers first, `maxConcurrency` capped |

---

## 7. Open questions

1. Approve **Option A** for opening runs (in-process harness) over a dev-only endpoint?
2. Which dev database should `MASTRA_DATABASE_URL` point at — the shared dev DB or a separate one?
3. Should the eval suite run in CI, or on demand only?
