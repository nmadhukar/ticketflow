import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load agents/.env before anything reads the configuration: index.ts refuses to start without it.
// Built-in only (no dotenv dependency): KEY=VALUE lines, # comments, optional quotes.
const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(envPath)) {
  const { readFileSync } = await import('node:fs');
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    // A real environment variable wins, so CI can override the file.
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

/**
 * `npm run eval` in agents/.
 *
 *   npm run eval                 every case, mock mode (no ticket is touched)
 *   npm run eval -- --live       real MCP calls against the TKT-2099-* tickets
 *   npm run eval -- --only=staff-facts-status,staff-tools-list-own
 *   npm run eval -- --reset      delete the dataset first, then rebuild it from cases.ts
 *
 * Exits non-zero when any case fails, so CI can gate on it.
 */
const args = process.argv.slice(2);
const { runEvals, resetDataset } = await import('./run.ts');

// --reset rebuilds the dataset from cases.ts. Use it after editing cases, or if a run reports
// "dataset item identities conflict" (a half-applied change left the dataset inconsistent).
if (args.includes('--reset')) {
  const id = await resetDataset();
  console.log(id ? `deleted dataset ${id}` : 'no dataset to delete');
}

const mode = args.includes('--live') ? 'live' : 'mock';
const onlyArg = args.find((a) => a.startsWith('--only=')) ?? (args.includes('--only') ? `--only=${args[args.indexOf('--only') + 1] ?? ''}` : undefined);
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : undefined;

runEvals({ mode, only })
  .then((summary) => {
    console.log(`\n${summary.passed}/${summary.total} passed (${summary.mode} mode)`);
    if (summary.failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(`eval: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
