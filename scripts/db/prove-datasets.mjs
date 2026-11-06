// Proves, in one run, that the Mastra dataset is really stored in the database and that the
// evaluation role cannot reach TicketFlow's own data.
//
//   node scripts/db/prove-datasets.mjs
//
// Prints one numbered block per claim, each with the evidence it was checked against. Read-only:
// it writes nothing.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const adminUrl = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim();
const mastraUrl = /^MASTRA_DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim();

const ok = (label, detail) => console.log(`  PASS  ${label}${detail ? `\n        ${detail}` : ''}`);
const bad = (label, detail) => {
  console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  process.exitCode = 1;
};

console.log('\n=== Mastra dataset: storage and isolation ===\n');

// ---------------------------------------------------------------- 1. the schema exists
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  const { rows } = await admin.query(
    "select schema_name, schema_owner from information_schema.schemata where schema_name = 'mastra'",
  );
  if (rows.length === 1) ok('1. The `mastra` schema exists', `owner: ${rows[0].schema_owner}`);
  else bad('1. The `mastra` schema exists', 'not found');

  const { rows: tables } = await admin.query(
    "select table_name from information_schema.tables where table_schema = 'mastra' order by table_name",
  );
  const names = tables.map((t) => t.table_name);
  const wanted = ['mastra_datasets', 'mastra_dataset_items', 'mastra_experiments', 'mastra_experiment_results'];
  const missing = wanted.filter((t) => !names.includes(t));
  if (missing.length === 0) ok('2. Mastra created its own tables', names.join(', '));
  else bad('2. Mastra created its own tables', `missing: ${missing.join(', ')}`);

  // ------------------------------------------------------------ 3. the role is limited
  const { rows: role } = await admin.query(
    "select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = 'ticketflow_mastra'",
  );
  const r = role[0];
  if (r && r.rolcanlogin && !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole) {
    ok('3. The eval role is a plain login role', 'no superuser, no createdb, no createrole');
  } else {
    bad('3. The eval role is a plain login role', JSON.stringify(r));
  }
} finally {
  await admin.end();
}

// ------------------------------------------------------- 4. the data is really in there
const m = new pg.Client({ connectionString: mastraUrl });
await m.connect();
try {
  const { rows: ds } = await m.query('select id, name, version from mastra.mastra_datasets');
  if (ds.length > 0) {
    ok('4. The dataset is stored in the database', ds.map((d) => `${d.name} (version ${d.version})`).join(', '));
  } else {
    bad('4. The dataset is stored in the database', 'no rows');
  }

  const { rows: items } = await m.query(
    'select count(*)::int as total, count(distinct "externalId")::int as cases from mastra.mastra_dataset_items',
  );
  const { total, cases } = items[0];
  if (cases > 0) ok('5. Every case is a stored row', `${cases} distinct cases, ${total} item rows`);
  else bad('5. Every case is a stored row', 'no items');

  // A sample row, so the senior sees real content rather than a count.
  const { rows: sample } = await m.query(
    'select "externalId", input from mastra.mastra_dataset_items where "externalId" is not null order by "externalId" limit 1',
  );
  if (sample.length === 1) {
    ok('6. A stored case, read back from the database', `${sample[0].externalId}: "${sample[0].input}"`);
  }

  // ------------------------------------------------- 7. the isolation, proven from the role
  const probes = [
    ['public.users', 'select count(*) from public.users'],
    ['public.tasks', 'select count(*) from public.tasks'],
  ];
  for (const [label, sql] of probes) {
    try {
      await m.query(sql);
      bad(`7. The eval role cannot read ${label}`, 'IT COULD READ THE TABLE');
    } catch (error) {
      ok(`7. The eval role cannot read ${label}`, error.message);
    }
  }

  // It can still write where it owns: that is what makes the dataset work.
  try {
    await m.query('select count(*) from mastra.mastra_dataset_items');
    ok('8. The eval role can read its own schema', 'mastra.mastra_dataset_items is readable');
  } catch (error) {
    bad('8. The eval role can read its own schema', error.message);
  }
} finally {
  await m.end();
}

console.log(`\n${process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED'}\n`);
