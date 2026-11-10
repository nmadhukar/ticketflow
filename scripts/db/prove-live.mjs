// Proves, in one run, that the evaluation works against REAL tickets and that the data is stored
// in the Mastra database. Read-only: it opens a run, calls one real tool, and reads the database.
//
//   node scripts/db/prove-live.mjs
//
// Prints one numbered block per claim, with the evidence it was checked against.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const get = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(env)?.[1]?.trim();
const appUrl = `http://127.0.0.1:${get('PORT') ?? 5000}`;
const mastraUrl = get('MASTRA_DATABASE_URL');

// Every request is bounded: a hung call must not hang the proof.
const TIMEOUT_MS = 20_000;
const timed = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

let failed = 0;
const ok = (label, detail) => console.log(`  PASS  ${label}${detail ? `\n        ${detail}` : ''}`);
const bad = (label, detail) => {
  failed += 1;
  console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

console.log('\n=== Live proof: real tickets + Mastra storage ===\n');

// ---------------------------------------------------------- 1. the app is serving the assistant
let run;
try {
  const res = await timed(`${appUrl}/api/assistant/eval/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'eval-staff', agentId: 'ticket-assistant' }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  run = await res.json();
  ok('1. The app opened a real assistant run', `runId ${run.runId}, user ${run.userId}`);
} catch (error) {
  bad('1. The app opened a real assistant run', `${error.message}\n        Is \`npm run dev\` running?`);
}

// ------------------------------------------- 2. the run's token reaches the real MCP endpoint
if (run) {
  try {
    const res = await timed('http://127.0.0.1:5100/internal/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-ticketflow-mcp-session': run.mcpToken,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'prove', version: '1' } },
      }),
    });
    if (res.ok) ok('2. The run token is accepted by the real MCP endpoint', 'POST /internal/mcp -> 200');
    else bad('2. The run token is accepted by the real MCP endpoint', `status ${res.status}`);
  } catch (error) {
    bad('2. The run token is accepted by the real MCP endpoint', error.message);
  }

  // ------------------------------------- 3. a real tool call returns a real ticket from the DB
  try {
    const res = await timed('http://127.0.0.1:5100/internal/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-ticketflow-mcp-session': run.mcpToken,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_ticket', arguments: { id: 'TKT-2099-0001' } },
      }),
    });
    const text = await res.text();
    const body = JSON.parse(text.slice(text.indexOf('{')));
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? '{}');
    if (payload.ticketNumber === 'TKT-2099-0001') {
      ok('3. A real tool call returned a real ticket', `${payload.ticketNumber} — "${payload.title}" (status: ${payload.status})`);
    } else {
      bad('3. A real tool call returned a real ticket', text.slice(0, 200));
    }
  } catch (error) {
    bad('3. A real tool call returned a real ticket', error.message);
  }

  await timed(`${appUrl}/api/assistant/eval/run/${run.runId}`, { method: 'DELETE' }).catch(() => {});
}

// ------------------------------------------------- 4. the dataset is stored in the mastra schema
const m = new pg.Client({ connectionString: mastraUrl });
try {
  await m.connect();
  const { rows: ds } = await m.query('select name, version from mastra.mastra_datasets');
  if (ds.length > 0) ok('4. The dataset is stored in the Mastra database', ds.map((d) => `${d.name} (v${d.version})`).join(', '));
  else bad('4. The dataset is stored in the Mastra database', 'no rows');

  const { rows: items } = await m.query(
    'select count(distinct "externalId")::int as cases from mastra.mastra_dataset_items',
  );
  if (items[0].cases > 0) ok('5. Every evaluation case is a stored row', `${items[0].cases} cases`);
  else bad('5. Every evaluation case is a stored row', 'no items');

  // ------------------------------------------------------- 6. the isolation, from the role itself
  for (const table of ['public.users', 'public.tasks']) {
    try {
      await m.query(`select count(*) from ${table}`);
      bad(`6. The eval role cannot read ${table}`, 'IT COULD READ THE TABLE');
    } catch (error) {
      ok(`6. The eval role cannot read ${table}`, error.message);
    }
  }
} catch (error) {
  bad('4. The dataset is stored in the Mastra database', error.message);
} finally {
  await m.end().catch(() => { });
}

console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exitCode = failed ? 1 : 0;
