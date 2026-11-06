import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Runs ONE evaluation case and prints its result as JSON on stdout.
 *
 * It is a separate process on purpose: a hung model call can block the event loop, so an in-process
 * timeout never fires. The parent (run.ts) starts this, waits with a deadline, and kills it if the
 * deadline passes. That is the only reliable way to bound a call that stops responding.
 *
 *   node --experimental-strip-types one.ts <caseId>
 */

const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

const caseId = process.argv[2];
if (!caseId) {
  console.error('usage: one.ts <caseId>');
  process.exit(2);
}

const { runOneCase } = await import('./run.ts');

try {
  const result = await runOneCase(caseId);
  process.stdout.write(`\n__RESULT__${JSON.stringify(result)}\n`);
} catch (error) {
  // Always report a result, never crash: the parent reads __RESULT__ and would otherwise see only
  // a stack trace and record a vague failure.
  const reason = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `\n__RESULT__${JSON.stringify({ id: caseId, group: 'facts', answer: '', scores: [{ scorerId: 'run', score: 0, reason }], passed: false })}\n`,
  );
}
