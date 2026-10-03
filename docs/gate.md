# The verification gate

`scripts/ai/verify.sh` is the runtime and design gate the DeepSeek Harness runs against a candidate
change. It builds the app, starts it against a real PostgreSQL, exercises it over HTTP, and runs lint,
the type checks, every Jest suite and the Playwright browser suite. It needs only `bash` and the Docker
CLI; nothing is installed on the host. A product defect fails the gate: fix the product, never the gate.

## What it checks

1. **Stack.** Builds `docker/gate/Dockerfile.gate` (Node 24, the same bundle as production), starts
   PostgreSQL 16, applies the schema the way production does (`npm run db:migrate-sql`, then
   `npm run db:push`), starts the app with the environment a production boot requires
   (`NODE_ENV`, `APP_BASE_URL`, `SESSION_SECRET`, `JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`), and waits
   for `/health`, `/api/security/health` and `/` to answer.
2. **Ticket workflow over HTTP.** Logs in as the bootstrap admin through `/api/auth/login`, creates a ticket
   (no client-supplied `ticketNumber`), assigns it, finds it in `/api/tasks/my`, comments, then walks
   `in_progress`, `on_hold`, `resolved`, `closed`, `open`, asserting the original description survives every
   stage and that `resolvedAt` and `closedAt` are stamped.
3. **Authentication probes.** Anonymous `/api/tasks` is 401; a wrong password is 401; both answer the error
   contract `{error, message}`; login, `/api/auth/user` (no password hash in the body) and logout work; the
   session is dead after logout.
4. **Frozen install, lint, type check.** `npm ci`, `npm run lint`, `npm run check`.
5. **Jest.** Applies the schema to a throwaway database, then runs `jest --runInBand` over every project
   (unit, AI, integration against PostgreSQL, client). The counts come from Jest's own JSON report.
6. **Playwright.** In `mcr.microsoft.com/playwright:v1.63.0-noble`, against its own throwaway database, runs
   `npm run e2e` (the production bundle, strict CSP). Keep the image tag equal to `@playwright/test` in
   `package.json`.

The gate never touches the production `Dockerfile` or `docker-compose.yml`; its own files are
`docker/gate/Dockerfile.gate` and `docker/gate/docker-compose.gate.yml`.

## How the harness runs it

The harness sets `GATE_NONCE` in the environment and runs `bash scripts/ai/verify.sh`. The script's last
lines are, in this order:

```
TESTS[<GATE_NONCE>]: <n> passed, <m> skipped
RESULT: PASS
```

(or `RESULT: FAIL`). `<n>` and `<m>` are Jest's passed and pending counts, so they equal the totals of
`npx jest --runInBand`. `RESULT: PASS` needs every check above to pass and a valid Jest report. The exit
status is 0 on PASS and 1 on FAIL. Do not change these two lines or their order.

Isolation: the compose project, the network and the volumes are named from `GATE_NONCE` and the process id,
publish no host ports, and are removed by the `EXIT` trap, so concurrent gate runs and a developer's own
stack do not collide. Secrets (database password, session and JWT secrets, admin password) are generated
inside the script on every run and never printed or committed.

## Running it locally

Requirements: bash (Git Bash on Windows), Docker Desktop running.

```bash
GATE_NONCE=local bash scripts/ai/verify.sh
```

It takes 15 to 30 minutes on a laptop (image build, `npm ci` twice, the full Jest and Playwright suites). It copies the
working tree (without `node_modules` and `.git`) into the containers, so uncommitted changes are tested.
To gate exactly what you will push, run it from a clean checkout of the commit:

```bash
git worktree add -q --detach /tmp/verify HEAD
(cd /tmp/verify && bash scripts/ai/verify.sh)
git worktree remove --force /tmp/verify
```

`.gitattributes` keeps `scripts/ai/verify.sh` and `docker/gate/*` on LF line endings, which bash needs.
