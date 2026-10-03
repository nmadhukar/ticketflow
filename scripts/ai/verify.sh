#!/usr/bin/env bash
# Runtime/design gate. Requires only bash, Docker CLI, and a sandbox DOCKER_HOST.
# All tests/services execute in containers; nothing is installed on the host.
# Validation is deliberately read-only outside this file: product defects fail the gate.
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="tfverify_${GATE_NONCE:-local}_$$"
PROJECT="$(printf '%s' "$PROJECT" | tr -cd 'a-zA-Z0-9_-')"
NETWORK="${PROJECT}_default"
# Unique project/volumes avoid touching other sandbox validations.
PREFIX="tfv_${GATE_NONCE:-local}_$$"
PREFIX="$(printf '%s' "$PREFIX" | tr -cd 'a-zA-Z0-9_-')"
NODE_IMAGE=node:20-slim
BROWSER_IMAGE=mcr.microsoft.com/playwright:v1.55.0-noble
PASS=0
FAIL=0
TEST_PASSED=0
TEST_SKIPPED=0
REPORT_VALID=0
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
cleanup() {
  printf '%s\n' '--- CLEANUP ---'
  docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  # Only uniquely named resources created by this invocation are removed.
  docker volume rm "${PREFIX}_deps" "${PREFIX}_npm" "${PREFIX}_reports" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  printf '%s\n' 'Cleanup complete.'
}
trap finish EXIT

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
  exit 1
else
  ok 'Docker daemon available'
fi

printf '%s\n' '--- STEP 1: stack ---'
# Compose app/database expose fixed host ports. If another sandbox validation
# owns those ports, record an environment failure rather than joining its stack.
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
if app_curl http://localhost:5000/ >/dev/null 2>&1; then ok 'UI entry point responds'; else bad 'UI entry point unavailable'; fi
printf 'Stack images: %s; %s\n' "$NODE_IMAGE" "$BROWSER_IMAGE"
docker compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" ps || true

printf '%s\n' '--- STEP 2: genuine ticket workflow ---'
# Use Node's built-in fetch, so no curl/python/jq are needed on the host.
# Run each assertion independently: one failed create must not conceal the
# later-stage persistence, authorisation and session-security evidence.
workflow_probe() {
  docker run --rm --network "$NETWORK" -e GATE_NONCE="${GATE_NONCE:-local}" \
    "$NODE_IMAGE" node -e '
(async()=>{
 const b="http://app:5000",headers={"content-type":"application/json"};
 const check=async(method,path,body,cookie)=>{
  const response=await fetch(b+path,{method,headers:{...headers,...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,90)}};
  return {status:response.status,data,cookie:response.headers.get("set-cookie")?.split(";")[0]};
 };
 const assert=(condition,message)=>{if(!condition)throw Error(message)};
 const login=await check("POST","/api/auth/login",{email:"admin@ticketflow.local",password:"Admin123!"});
 assert(login.status===200&&login.cookie,"seeded admin login/session failed: "+JSON.stringify(login.data));
 const cookie=login.cookie, nonce=process.env.GATE_NONCE||"local";
 const first=await check("POST","/api/tasks",{title:"Gate "+nonce,description:"Entered only once",category:"bug",priority:"high"},cookie);
 if(first.status!==201)console.error("Documented create without ticketNumber: HTTP "+first.status+" "+JSON.stringify(first.data));
 // Continue the workflow without weakening the create assertion: send the
 // otherwise-invalid client ticketNumber to expose subsequent defects.
 const created=first.status===201?first:await check("POST","/api/tasks",{ticketNumber:"client-unused",title:"Gate "+nonce,description:"Entered only once",category:"bug",priority:"high"},cookie);
 assert(created.status===201,"fallback create HTTP "+created.status+" "+JSON.stringify(created.data));
 const id=created.data.id;
 const assigned=await check("PATCH","/api/tasks/"+id,{assigneeId:login.data.id},cookie);
 assert(assigned.status===200&&assigned.data.assigneeId===login.data.id,"assignment failed");
 const mine=await check("GET","/api/tasks/my",undefined,cookie);
 assert(mine.status===200&&mine.data.some(t=>t.id===id),"assignment not visible in My Tasks");
 const commented=await check("POST","/api/tasks/"+id+"/comments",{content:"Progress on original description"},cookie);
 assert(commented.status===201,"comment failed");
 for(const status of ["in_progress","on_hold","resolved","closed","open"]){
  const changed=await check("PATCH","/api/tasks/"+id,{status},cookie);
  assert(changed.status===200,"stage "+status+" HTTP "+changed.status);
  assert(changed.data.status===status&&changed.data.description==="Entered only once","early details lost at "+status);
  if(status==="resolved")assert(changed.data.resolvedAt,"resolvedAt not stamped");
  if(status==="closed")assert(changed.data.closedAt,"closedAt not stamped");
 }
 const reread=await check("GET","/api/tasks/"+id,undefined,cookie);
 assert(reread.status===200&&reread.data.description==="Entered only once","early details not retained on GET");
 assert(first.status===201,"documented create rejected with HTTP "+first.status);
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
if docker run --rm --network "$NETWORK" "$NODE_IMAGE" node -e '
(async()=>{const b="http://app:5000",h={"content-type":"application/json"};
 const anon=await fetch(b+"/api/tasks");if(anon.status!==401)throw Error("anonymous tasks HTTP "+anon.status);
 const bad=await fetch(b+"/api/auth/login",{method:"POST",headers:h,body:JSON.stringify({email:"admin@ticketflow.local",password:"incorrect"})});
 if(bad.status!==401)throw Error("wrong password HTTP "+bad.status);
 const good=await fetch(b+"/api/auth/login",{method:"POST",headers:h,body:JSON.stringify({email:"admin@ticketflow.local",password:"Admin123!"})});
 if(good.status!==200)throw Error("login HTTP "+good.status);
 const cookie=good.headers.get("set-cookie")?.split(";")[0];if(!cookie)throw Error("session cookie missing");
 const who=await fetch(b+"/api/auth/user",{headers:{cookie}});if(who.status!==200)throw Error("session user HTTP "+who.status);
 const out=await fetch(b+"/api/auth/logout",{method:"POST",headers:{cookie}});if(out.status!==200)throw Error("logout HTTP "+out.status);
 const expired=await fetch(b+"/api/auth/user",{headers:{cookie}});if(expired.status!==401)throw Error("logout session still active");
 console.log("anonymous / invalid login / session / logout assertions passed");
})().catch(e=>{console.error(e.message);process.exit(1)})'; then
  ok 'Authentication and anonymous isolation runtime probes'
else
  bad 'Authentication and anonymous isolation runtime probes'
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
# Read only Jest's own JSON report. A missing report fails, never fabricates
# test results. Runner-reported zero tests is honest when config never loads.
# A config-loading failure cannot be interpreted as an empty successful suite.
COUNTS="$(run_node node -e '
const fs=require("fs");let r;try{r=JSON.parse(fs.readFileSync("/gate-reports/jest.json","utf8"))}catch(e){console.error(`no valid Jest JSON: ${e.message}`);process.exit(1)}
for(const k of ["numPassedTests","numPendingTests","numFailedTests","numTotalTests"]){if(!Number.isSafeInteger(r[k])||r[k]<0)throw Error(`invalid ${k}`)}
if(r.numPassedTests+r.numPendingTests+r.numFailedTests!==r.numTotalTests)throw Error("inconsistent runner counts");
console.log(`${r.numPassedTests} ${r.numPendingTests}`);
')" && REPORT_VALID=1
if [ "$REPORT_VALID" -eq 1 ]; then
  read -r TEST_PASSED TEST_SKIPPED <<< "$COUNTS"
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

# EXIT trap removes all gate-owned resources before printing final result.
exit 0
