#!/usr/bin/env bash
# Runtime/design gate. Requires only bash, Docker CLI, and a sandbox DOCKER_HOST.
# All tests/services execute in containers; nothing is installed on the host.
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="tfverify_${GATE_NONCE:-local}_$$"
PROJECT="$(printf '%s' "$PROJECT" | tr -cd 'a-zA-Z0-9_-')"
NETWORK="${PROJECT}_default"
PREFIX="tfv_${GATE_NONCE:-local}_$$"
PREFIX="$(printf '%s' "$PREFIX" | tr -cd 'a-zA-Z0-9_-')"
NODE_IMAGE=node:20-slim
BROWSER_IMAGE=mcr.microsoft.com/playwright:v1.55.0-noble
PASS=0
FAIL=0
TEST_PASSED=0
TEST_SKIPPED=0
REPORT_VALID=0

ok() { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup() {
  printf '%s\n' '--- CLEANUP ---'
  docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  # Docker volumes are created exclusively by this invocation of the gate.
  docker volume rm "${PREFIX}_deps" "${PREFIX}_npm" "${PREFIX}_reports" >/dev/null 2>&1 || true
  printf '%s\n' 'Cleanup complete.'
}
trap cleanup EXIT

# Prevent overlapping jobs from being joined or deleted by a different gate run.
run_node() {
  docker run --rm --network "$NETWORK" -v "$REPO_DIR:$REPO_DIR:ro" \
    -v "${PREFIX}_deps:$REPO_DIR/node_modules" -v "${PREFIX}_npm:/root/.npm" \
    -v "${PREFIX}_reports:/gate-reports" -w "$REPO_DIR" \
    -e GATE_NONCE="${GATE_NONCE:-local}" "$NODE_IMAGE" "$@"
}
app_curl() { docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" exec -T app curl -fsS "$@"; }

printf '%s\n' '=== TicketFlow design-conformance gate ==='
printf 'Repository: %s\n' "$REPO_DIR"
if ! docker info >/dev/null 2>&1; then
  bad 'Docker daemon unavailable'
else
  ok 'Docker daemon available'
fi

printf '%s\n' '--- STEP 1: stack ---'
if docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" build app && \
   docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" up -d postgres; then
  ok 'Compose app built and PostgreSQL started'
else
  bad 'Compose build/database start'
fi
# Push schema before app startup; the app seeds users and templates immediately.
PG_HEALTH=0
for i in $(seq 1 30); do
  if docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" exec -T postgres \
    pg_isready -U ticketflow >/dev/null 2>&1; then PG_HEALTH=1; break; fi
  sleep 2
done
if [ "$PG_HEALTH" -eq 1 ]; then
  ok 'PostgreSQL healthy'
else
  bad 'PostgreSQL unhealthy'
fi
SCHEMA_COUNT=0
if docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" run --rm -T --no-deps app npx drizzle-kit push --force; then
  SCHEMA_COUNT="$(docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" exec -T postgres \
    psql -U ticketflow -d ticketflow -Atc "select count(*) from information_schema.tables where table_name='users'" 2>/dev/null || printf 0)"
fi
if [ "$SCHEMA_COUNT" = 1 ]; then
  ok 'Database schema pushed'
else
  bad 'Database schema push'
fi
if docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" up -d app; then
  ok 'Application container started'
else
  bad 'Application container start'
fi
HEALTH=0
for i in $(seq 1 30); do
  if app_curl http://localhost:5000/api/security/health >/dev/null 2>&1; then HEALTH=1; break; fi
  sleep 2
done
if [ "$HEALTH" -eq 1 ]; then ok 'Application HTTP health responds'; else bad 'Application HTTP health unavailable'; fi
docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" ps || true

printf '%s\n' '--- STEP 2: genuine ticket workflow ---'
# Use Node's built-in fetch, so no curl/python/jq are needed on the host.
# A ticket created with the documented fields MUST succeed without supplying its server-generated number.
if docker run --rm --network "$NETWORK" "$NODE_IMAGE" node -e '
(async()=>{
 const base="http://app:5000";
 const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"admin@ticketflow.local",password:"Admin123!"})});
 if(login.status!==200)throw Error(`login HTTP ${login.status}`);
 const cookie=login.headers.get("set-cookie").split(";")[0];
 const post=await fetch(base+"/api/tasks",{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify({title:"Gate workflow",description:"Entered only once",category:"bug",priority:"high"})});
 if(post.status!==201)throw Error(`documented ticket create HTTP ${post.status}: ${await post.text()}`);
 const task=await post.json();
 for(const status of ["in_progress","on_hold","resolved","closed","open"]){
  const r=await fetch(base+"/api/tasks/"+task.id,{method:"PATCH",headers:{"content-type":"application/json",cookie},body:JSON.stringify({status})});
  if(r.status!==200)throw Error(`${status} HTTP ${r.status}`);
  const got=await r.json();if(got.description!=="Entered only once"||got.status!==status)throw Error(`lost early data at ${status}`);
  if(status==="resolved"&&!got.resolvedAt)throw Error("resolvedAt not stamped");
  if(status==="closed"&&!got.closedAt)throw Error("closedAt not stamped");
 }
 console.log(`ticket ${task.id}: all stages retain original input`);
})().catch(e=>{console.error(e.message);process.exit(1)})
'; then
  ok 'Create and walk all workflow stages without re-entry'
else
  bad 'Create and walk all workflow stages without re-entry'
fi

printf '%s\n' '--- STEP 3: frozen install, lint, typecheck, unit/integration/e2e ---'
if run_node sh -c 'npm ci --no-audit --no-fund'; then ok 'npm ci frozen install'; else bad 'npm ci frozen install'; fi
if run_node sh -c 'npm run lint'; then ok 'lint'; else bad 'lint'; fi
if run_node sh -c 'npm run check -- --noEmit'; then ok 'typecheck'; else bad 'typecheck'; fi
# Keep the tracked Jest configuration unchanged; the runner JSON, not stdout,
# supplies the test counts. Every discovered test runs, including unit, integration,
# AI, load, client and server end-to-end suites.
if run_node sh -c 'npm exec --no -- jest --config jest.config.js --runInBand --json --outputFile=/gate-reports/jest.json'; then
  ok 'all Jest suites (unit, integration, AI, load, e2e)'
else
  bad 'all Jest suites (unit, integration, AI, load, e2e)'
fi
# Read only Jest's own JSON report. Missing or invalid report is a failure,
# never interpreted as zero tests passing.
if run_node node -e '
const fs=require("fs");let r;try{r=JSON.parse(fs.readFileSync("/gate-reports/jest.json","utf8"))}catch(e){console.error(`no valid Jest JSON: ${e.message}`);process.exit(1)}
for(const k of ["numPassedTests","numPendingTests","numFailedTests","numTotalTests"]){if(!Number.isSafeInteger(r[k])||r[k]<0)throw Error(`invalid ${k}`)}
if(r.numPassedTests+r.numPendingTests+r.numFailedTests!==r.numTotalTests)throw Error("inconsistent runner counts");
console.log(`${r.numPassedTests} ${r.numPendingTests} ${r.numFailedTests} ${r.numTotalTests}`);
' >/dev/null; then
  COUNTS="$(run_node node -e 'const r=require("/gate-reports/jest.json");console.log(`${r.numPassedTests} ${r.numPendingTests}`)')"
  read -r TEST_PASSED TEST_SKIPPED <<< "$COUNTS"
  REPORT_VALID=1
  ok 'Jest runner report validated'
else
  bad 'Jest runner JSON report absent or invalid'
fi
# This repository has no Playwright dependency/spec or pinned browser version.
# Still invoke the official pinned browser image and check actual e2e script;
# the absence is a gate failure, not a skip or fabricated test count.
if docker run --rm --network "$NETWORK" -v "$REPO_DIR:$REPO_DIR:ro" -w "$REPO_DIR" \
  "$BROWSER_IMAGE" sh -c 'node -e '\''const p=require("./package.json");if(!p.scripts?.e2e)throw Error("no e2e script in package.json")'\'' && npm run e2e'; then
  ok 'official pinned-image browser e2e suite'
else
  bad 'official pinned-image browser e2e suite'
fi

printf '%s\n' '--- RESULTS ---'
printf 'PASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
# Exactly one runner-derived TESTS line, immediately before the RESULT line.
printf 'TESTS[%s]: %s passed, %s skipped\n' "${GATE_NONCE:-0}" "$TEST_PASSED" "$TEST_SKIPPED"
if [ "$FAIL" -eq 0 ] && [ "$REPORT_VALID" -eq 1 ]; then
  printf '%s\n' 'RESULT: PASS'
  exit 0
fi
printf '%s\n' 'RESULT: FAIL'
exit 1
