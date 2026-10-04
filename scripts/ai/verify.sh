#!/usr/bin/env bash
# Runtime/design gate. Requires only bash, the Docker CLI and a sandbox DOCKER_HOST.
# All tests and services run in containers; nothing is installed on the host.
# Validation is deliberately read-only outside this file: product defects fail the gate.
# See docs/gate.md.
#
# Contract with the harness (do not change): the last lines are
#   TESTS[<GATE_NONCE>]: <n> passed, <m> skipped
#   RESULT: PASS|FAIL
# <n> and <m> come from Jest's own JSON report. Every project, container and volume
# this script creates has a name unique to this invocation and is removed on exit.
set -uo pipefail
# Git Bash on Windows rewrites container paths such as /work into C:/Program Files/Git/work.
# Harmless everywhere else.
export MSYS_NO_PATHCONV=1
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# With path conversion off, Docker needs the host's own spelling (C:/Users/... on Windows;
# `pwd -W` does not exist elsewhere, where the plain path is already native).
HOST_DIR="$(cd "$REPO_DIR" && { pwd -W 2>/dev/null || pwd; })"
COMPOSE_FILE="$HOST_DIR/docker/gate/docker-compose.gate.yml"
PROJECT="tfverify_${GATE_NONCE:-local}_$$"
PROJECT="$(printf '%s' "$PROJECT" | tr -cd 'a-zA-Z0-9_-')"
NETWORK="${PROJECT}_default"
# Unique project/volumes avoid touching other sandbox validations.
PREFIX="tfv_${GATE_NONCE:-local}_$$"
PREFIX="$(printf '%s' "$PREFIX" | tr -cd 'a-zA-Z0-9_-')"
# Node 24 matches the production image and package.json engines (>=22.12).
NODE_IMAGE=node:24-slim
# Must match @playwright/test in package.json (1.63.0): the browsers are baked into the image.
BROWSER_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
PASS=0
FAIL=0
TEST_PASSED=0
TEST_SKIPPED=0
REPORT_VALID=0

# Secrets are generated here, per run, and only ever exported to the containers.
gen() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
GATE_DB_PASSWORD="$(gen)"
GATE_SESSION_SECRET="$(gen)"
GATE_JWT_SECRET="$(gen)"
GATE_ADMIN_PASSWORD="Gate-$(gen)"
export GATE_DB_PASSWORD GATE_SESSION_SECRET GATE_JWT_SECRET GATE_ADMIN_PASSWORD
ADMIN_EMAIL=gate-admin@example.test
# Two throwaway databases in the same PostgreSQL: one for Jest, one for Playwright.
# Their names contain "test", which the e2e config and the test helpers insist on.
JEST_DB=ticketflow_test_gate
E2E_DB=ticketflow_test_e2e
db_url() { printf 'postgresql://ticketflow:%s@postgres:5432/%s' "$GATE_DB_PASSWORD" "$1"; }

# Print the result after EXIT cleanup so the TESTS and RESULT lines remain last.
finish() {
  rc=$?
  trap - EXIT
  cleanup
  if [ "$rc" -ne 0 ]; then FAIL=$((FAIL+1)); fi
  printf '%s\n' '--- RESULTS ---'
  printf 'PASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
  printf 'TESTS[%s]: %s passed, %s skipped\n' "${GATE_NONCE:-0}" "$TEST_PASSED" "$TEST_SKIPPED"
  if [ "$FAIL" -eq 0 ] && [ "$REPORT_VALID" -eq 1 ]; then
    printf '%s\n' 'RESULT: PASS'
    exit 0
  fi
  printf '%s\n' 'RESULT: FAIL'
  exit 1
}

ok() { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
cleanup() {
  printf '%s\n' '--- CLEANUP ---'
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  # Only uniquely named resources created by this invocation are removed.
  docker volume rm "${PREFIX}_deps" "${PREFIX}_deps_e2e" "${PREFIX}_npm" "${PREFIX}_reports" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  printf '%s\n' 'Cleanup complete.'
}
trap finish EXIT

# Runs "$@" in a writable copy of the working tree (the mount itself is read-only, and
# the build and Playwright write into the tree). node_modules lives in a per-run volume.
# $1 = image, $2 = node_modules volume, rest = command.
in_tree() {
  local image="$1" deps="$2"; shift 2
  docker run --rm --ipc=host --network "$NETWORK" -v "$HOST_DIR:/src:ro" \
    -v "${deps}:/work/node_modules" -v "${PREFIX}_npm:/root/.npm" \
    -v "${PREFIX}_reports:/gate-reports" -w /work \
    -e GATE_NONCE="${GATE_NONCE:-local}" -e CI=true \
    -e DATABASE_URL -e TEST_DATABASE_URL \
    -e SESSION_SECRET="$GATE_SESSION_SECRET" -e JWT_SECRET="$GATE_JWT_SECRET" \
    "$image" sh -c 'tar -C /src --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./.env --exclude='./.env.*' -cf - . | tar -C /work -xf - && exec "$@"' sh "$@"
}
run_node() { in_tree "$NODE_IMAGE" "${PREFIX}_deps" "$@"; }
app_curl() { compose exec -T app curl -fsS "$@"; }

printf '%s\n' '=== TicketFlow design-conformance gate ==='
printf 'Repository: %s\n' "$REPO_DIR"
if ! docker info >/dev/null 2>&1; then
  bad 'Docker daemon unavailable'
  exit 1
else
  ok 'Docker daemon available'
fi

printf '%s\n' '--- STEP 1: stack ---'
# The stack publishes no host ports, so another validation cannot collide with it.
if compose build app && compose up -d postgres; then
  ok 'Compose app built and PostgreSQL started'
else
  bad 'Compose build/database start'
fi
PG_HEALTH=0
for i in $(seq 1 30); do
  if compose exec -T postgres pg_isready -U ticketflow -d ticketflow >/dev/null 2>&1; then PG_HEALTH=1; break; fi
  sleep 2
done
if [ "$PG_HEALTH" -eq 1 ]; then
  ok 'PostgreSQL healthy'
else
  bad 'PostgreSQL unhealthy'
fi
for name in "$JEST_DB" "$E2E_DB"; do
  compose exec -T postgres psql -U ticketflow -d ticketflow -qc "CREATE DATABASE $name" >/dev/null 2>&1 || true
done
# Schema before the app starts, the way production does it (R32): the hand-written
# idempotent migrations first, then drizzle-kit push. The app seeds at startup.
SCHEMA_COUNT=0
if compose run --rm -T --no-deps app sh -c 'npm run db:migrate-sql && npm run db:push -- --force'; then
  SCHEMA_COUNT="$(compose exec -T postgres \
    psql -U ticketflow -d ticketflow -Atc "select count(*) from information_schema.tables where table_name='users'" 2>/dev/null || printf 0)"
fi
if [ "$SCHEMA_COUNT" = 1 ]; then
  ok 'Database schema applied (db:migrate-sql, then db:push)'
else
  bad 'Database schema apply'
fi
if compose up -d app; then
  ok 'Application container started'
else
  bad 'Application container start'
fi
HEALTH=0
for i in $(seq 1 30); do
  if app_curl http://localhost:5000/health >/dev/null 2>&1; then HEALTH=1; break; fi
  sleep 2
done
if [ "$HEALTH" -eq 1 ]; then ok 'Application HTTP health responds'; else bad 'Application HTTP health unavailable'; fi
if app_curl http://localhost:5000/api/security/health >/dev/null 2>&1; then ok 'Security health responds'; else bad 'Security health unavailable'; fi
if app_curl http://localhost:5000/ >/dev/null 2>&1; then ok 'UI entry point responds'; else bad 'UI entry point unavailable'; fi
printf 'Stack images: %s; %s\n' "$NODE_IMAGE" "$BROWSER_IMAGE"
compose ps || true

# R67: the NODE_ENV boot guard is proven on the built bundle itself. The gate image's
# `node dist/index.js` with NODE_ENV empty and cwd `/` (not the app root) must refuse with
# exit 1 and the one "Refusing to start" line; the guard finds the app from its own path (R54).
# /app is WORKDIR in docker/gate/Dockerfile.gate. The shell's `|| rc=$?` keeps a refusal from
# tripping anything: it is the expected outcome.
GUARD_RC=0
GUARD_OUT="$(compose run --rm --no-deps -T -e NODE_ENV= -w / app node /app/dist/index.js 2>&1)" || GUARD_RC=$?
if [ "$GUARD_RC" -eq 1 ] && printf '%s' "$GUARD_OUT" | grep -q 'Refusing to start: NODE_ENV is not set'; then
  ok 'Built bundle refuses to start with NODE_ENV unset (exit 1, from cwd /)'
else
  bad "Built bundle did not refuse NODE_ENV unset (exit $GUARD_RC)"
  printf '%s\n' "$GUARD_OUT" | head -n 5
fi

printf '%s\n' '--- STEP 2: genuine ticket workflow ---'
# Use Node's built-in fetch, so no curl/python/jq are needed on the host.
# Run each assertion independently: one failed create must not conceal the
# later-stage persistence, authorisation and session-security evidence.
workflow_probe() {
  docker run --rm --network "$NETWORK" -e GATE_NONCE="${GATE_NONCE:-local}" \
    -e GATE_EMAIL="$ADMIN_EMAIL" -e GATE_PASSWORD="$GATE_ADMIN_PASSWORD" \
    "$NODE_IMAGE" node -e '
(async()=>{
 const b="http://app:5000",headers={"content-type":"application/json"};
 const check=async(method,path,body,cookie)=>{
  const response=await fetch(b+path,{method,headers:{...headers,...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,90)}};
  return {status:response.status,data,cookie:response.headers.get("set-cookie")?.split(";")[0]};
 };
 const assert=(condition,message)=>{if(!condition)throw Error(message)};
 const login=await check("POST","/api/auth/login",{email:process.env.GATE_EMAIL,password:process.env.GATE_PASSWORD});
 assert(login.status===200&&login.cookie,"bootstrap admin login/session failed: HTTP "+login.status);
 const cookie=login.cookie, nonce=process.env.GATE_NONCE||"local";
 const created=await check("POST","/api/tasks",{title:"Gate "+nonce,description:"Entered only once",category:"bug",priority:"high"},cookie);
 assert(created.status===201,"documented create (no ticketNumber) HTTP "+created.status+" "+JSON.stringify(created.data));
 const id=created.data.id;
 const assigned=await check("PATCH","/api/tasks/"+id,{assigneeId:login.data.id},cookie);
 assert(assigned.status===200&&assigned.data.assigneeId===login.data.id,"assignment failed: HTTP "+assigned.status+" "+JSON.stringify(assigned.data));
 const mine=await check("GET","/api/tasks/my",undefined,cookie);
 assert(mine.status===200&&Array.isArray(mine.data)&&mine.data.some(t=>t.id===id),"assignment not visible in My Tasks");
 const commented=await check("POST","/api/tasks/"+id+"/comments",{content:"Progress on original description"},cookie);
 assert(commented.status===201,"comment HTTP "+commented.status+" "+JSON.stringify(commented.data));
 for(const status of ["in_progress","on_hold","resolved","closed","open"]){
  const changed=await check("PATCH","/api/tasks/"+id,{status},cookie);
  assert(changed.status===200,"stage "+status+" HTTP "+changed.status+" "+JSON.stringify(changed.data));
  assert(changed.data.status===status&&changed.data.description==="Entered only once","early details lost at "+status);
  if(status==="resolved")assert(changed.data.resolvedAt,"resolvedAt not stamped");
  if(status==="closed")assert(changed.data.closedAt,"closedAt not stamped");
 }
 const reread=await check("GET","/api/tasks/"+id,undefined,cookie);
 assert(reread.status===200&&reread.data.description==="Entered only once","early details not retained on GET");
 console.log("Ticket "+id+" passed all workflow stages without re-entry");
})().catch(e=>{console.error(e.message);process.exit(1)})
  '
}
if workflow_probe; then
  ok 'Create and walk all workflow stages without re-entry'
else
  bad 'Create and walk all workflow stages without re-entry'
fi
# Independent checks are required even when the workflow has failed.
if docker run --rm --network "$NETWORK" -e GATE_EMAIL="$ADMIN_EMAIL" -e GATE_PASSWORD="$GATE_ADMIN_PASSWORD" \
  "$NODE_IMAGE" node -e '
(async()=>{const b="http://app:5000",h={"content-type":"application/json"};
 // Every error answers the contract {error, message}.
 const contract=async(res,what)=>{const j=await res.json().catch(()=>({}));if(typeof j.error!=="string"||typeof j.message!=="string")throw Error(what+" does not follow the error contract: "+JSON.stringify(j).slice(0,120))};
 const anon=await fetch(b+"/api/tasks");if(anon.status!==401)throw Error("anonymous tasks HTTP "+anon.status);await contract(anon,"anonymous 401");
 const bad=await fetch(b+"/api/auth/login",{method:"POST",headers:h,body:JSON.stringify({email:process.env.GATE_EMAIL,password:"incorrect"})});
 if(bad.status!==401)throw Error("wrong password HTTP "+bad.status);await contract(bad,"wrong password 401");
 const good=await fetch(b+"/api/auth/login",{method:"POST",headers:h,body:JSON.stringify({email:process.env.GATE_EMAIL,password:process.env.GATE_PASSWORD})});
 if(good.status!==200)throw Error("login HTTP "+good.status);
 const cookie=good.headers.get("set-cookie")?.split(";")[0];if(!cookie)throw Error("session cookie missing");
 const who=await fetch(b+"/api/auth/user",{headers:{cookie}});if(who.status!==200)throw Error("session user HTTP "+who.status);
 const body=await who.json();if("password" in body)throw Error("session user leaks the password hash");
 const out=await fetch(b+"/api/auth/logout",{method:"POST",headers:{cookie}});if(out.status!==200)throw Error("logout HTTP "+out.status);
 const expired=await fetch(b+"/api/auth/user",{headers:{cookie}});if(expired.status!==401)throw Error("logout session still active");
 console.log("anonymous / invalid login / session / logout / error-contract assertions passed");
})().catch(e=>{console.error(e.message);process.exit(1)})'; then
  ok 'Authentication, error contract and anonymous isolation runtime probes'
else
  bad 'Authentication, error contract and anonymous isolation runtime probes'
fi

printf '%s\n' '--- STEP 3: frozen install, lint, typecheck, unit/integration/e2e ---'
if run_node sh -c 'npm ci --no-audit --no-fund'; then ok 'npm ci frozen install'; else bad 'npm ci frozen install'; fi
if run_node sh -c 'npm run lint'; then ok 'lint'; else bad 'lint'; fi
if run_node sh -c 'npm run check'; then ok 'typecheck'; else bad 'typecheck'; fi
# Integration tests run against a real PostgreSQL: push the schema into the Jest database first.
TEST_DATABASE_URL="$(db_url "$JEST_DB")"; export TEST_DATABASE_URL
DATABASE_URL="$TEST_DATABASE_URL"; export DATABASE_URL
if run_node sh -c 'npm run db:migrate-sql && npm run db:push -- --force'; then
  ok 'Jest database schema applied'
else
  bad 'Jest database schema apply'
fi
# Keep the tracked Jest configuration unchanged; the runner JSON, not stdout,
# supplies the test counts. Every discovered test runs: unit, AI, integration
# (against PostgreSQL) and client.
if run_node sh -c 'npm exec --no -- jest --runInBand --json --outputFile=/gate-reports/jest.json'; then
  ok 'all Jest suites (unit, AI, integration, client)'
else
  bad 'all Jest suites (unit, AI, integration, client)'
fi
# Read only Jest's own JSON report. A missing report fails, never fabricates
# test results. A config-loading failure cannot be read as an empty successful suite.
COUNTS="$(run_node node -e '
const fs=require("fs");let r;try{r=JSON.parse(fs.readFileSync("/gate-reports/jest.json","utf8"))}catch(e){console.error(`no valid Jest JSON: ${e.message}`);process.exit(1)}
for(const k of ["numPassedTests","numPendingTests","numFailedTests","numTotalTests"]){if(!Number.isSafeInteger(r[k])||r[k]<0)throw Error(`invalid ${k}`)}
if(!(r.numPassedTests>0&&r.numFailedTests===0))throw Error("no passing tests or failing tests present");
if(r.numPassedTests+r.numPendingTests+r.numFailedTests+(r.numTodoTests||0)!==r.numTotalTests)throw Error("inconsistent runner counts");
console.log(`${r.numPassedTests} ${r.numPendingTests}`);
')" && REPORT_VALID=1
if [ "$REPORT_VALID" -eq 1 ]; then
  read -r TEST_PASSED TEST_SKIPPED <<< "$COUNTS"
  ok 'Jest runner report validated'
else
  bad 'Jest runner JSON report absent or invalid'
fi
# Playwright runs in the official image pinned to the @playwright/test version, against its
# own database. The config builds and starts the production bundle itself.
E2E_URL="$(db_url "$E2E_DB")"
DATABASE_URL="$E2E_URL"; TEST_DATABASE_URL="$E2E_URL"; export DATABASE_URL TEST_DATABASE_URL
if in_tree "$BROWSER_IMAGE" "${PREFIX}_deps_e2e" sh -c 'npm ci --no-audit --no-fund && npm run db:migrate-sql && npm run db:push -- --force && npm run e2e'; then
  ok 'official pinned-image browser e2e suite'
else
  bad 'official pinned-image browser e2e suite'
fi

# EXIT trap removes all gate-owned resources before printing final result.
exit 0
