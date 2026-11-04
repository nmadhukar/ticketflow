#!/usr/bin/env node
/**
 * Assistant evals: asks fixed questions as real users of a running TicketFlow (app + sidecar +
 * model) and grades each answer by rule. Every question is a real model call, so a run costs a
 * little (gpt-5-mini: about $0.002 per question).
 *
 *   EVAL_BASE_URL=http://localhost EVAL_ADMIN_EMAIL=... EVAL_ADMIN_PASSWORD=... npm run eval
 *   npm run eval -- --repeat 3              (each case 3 times: model answers vary)
 *   npm run eval -- --only customer.        (cases whose id starts with this)
 *   npm run eval -- --json results.json     (also write the full results)
 *
 * Never point it at production: it registers two eval customers and creates three tickets
 * (reused on later runs). Drafts it causes are rejected at the end, so nothing is ever posted.
 * Exit code 1 when the pass rate is under --min-pass (default 1.0, every run).
 */
import { writeFileSync } from 'node:fs';
import { setUpFixtures } from './fixtures.mjs';
import { cases, grade } from './cases.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const baseUrl = process.env.EVAL_BASE_URL ?? 'http://localhost';
const adminEmail = process.env.EVAL_ADMIN_EMAIL;
const adminPassword = process.env.EVAL_ADMIN_PASSWORD;
const evalPassword = process.env.EVAL_USER_PASSWORD ?? 'Eval-Assistant-Pass-1!';
const repeat = Math.max(1, Number(arg('repeat', '1')) || 1);
const only = arg('only', '');
const jsonOut = arg('json', '');
const minPassArg = arg('min-pass', '1');
const minPass = Number(minPassArg);

if (!/^\d*\.?\d+$/.test(minPassArg) || minPass < 0 || minPass > 1) {
  console.error(`--min-pass must be a fraction from 0 to 1 (for example 0.9), not "${minPassArg}".`);
  process.exit(2);
}
if (!adminEmail || !adminPassword) {
  console.error('Set EVAL_ADMIN_EMAIL and EVAL_ADMIN_PASSWORD (an admin of the TicketFlow under test).');
  process.exit(2);
}
// Only this machine unless told otherwise: evals create users and tickets, and http:// says
// nothing about whether a site is live (TLS often ends at a proxy in front of it).
let host;
try {
  host = new URL(baseUrl).hostname;
} catch {
  console.error(`EVAL_BASE_URL is not a URL: ${baseUrl}`);
  process.exit(2);
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(host) && !process.env.EVAL_ALLOW_REMOTE) {
  console.error(`Refusing ${baseUrl}: evals create users and tickets. Set EVAL_ALLOW_REMOTE=1 for a staging site, never production.`);
  process.exit(2);
}

const fx = await setUpFixtures({ baseUrl, adminEmail, adminPassword, evalPassword });
const sessions = { customerA: fx.customers.a, customerB: fx.customers.b, staff: fx.admin };
const agentOf = { customerA: 'support-assistant', customerB: 'support-assistant', staff: 'ticket-assistant' };
const selected = cases(fx).filter((c) => c.id.startsWith(only));

console.log(`Assistant evals against ${baseUrl}: ${selected.length} cases x ${repeat}\n`);
const results = [];
for (const c of selected) {
  for (let i = 0; i < repeat; i++) {
    const session = sessions[c.who];
    let run;
    let failures;
    try {
      // A case that cannot be checked is not asked: no model call for nothing.
      run = c.checks.unavailable ? null : await session.ask(agentOf[c.who], c.prompt);
      failures = grade(run, c.checks);
    } catch (error) {
      run = null;
      failures = [`request failed: ${error?.name ?? 'error'}`];
    }
    // Nothing an eval drafts is ever posted: each draft is rejected, and a draft left pending (the
    // reject refused or failed) fails the case, so it cannot pile up unnoticed.
    for (const id of run?.proposalIds ?? []) {
      const rejected = await session.request('POST', `/api/assistant/proposals/${id}/reject`, {}).catch(() => ({ status: 0 }));
      if (rejected.status !== 200) failures.push(`draft ${id} left pending: reject answered ${rejected.status || 'nothing'}`);
    }
    results.push({ id: c.id, attempt: i + 1, passed: failures.length === 0, failures, answer: run?.answer ?? '', toolCalls: run?.toolCalls ?? [], durationMs: run?.durationMs ?? 0 });
    const mark = failures.length === 0 ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${c.id}${repeat > 1 ? ` #${i + 1}` : ''}  (${((run?.durationMs ?? 0) / 1000).toFixed(1)} s)`);
    for (const f of failures) console.log(`      - ${f}`);
    if (failures.length) console.log(`      answer: ${(run?.answer ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}

const passed = results.filter((r) => r.passed).length;
const rate = results.length ? passed / results.length : 0;
console.log(`\n${passed}/${results.length} passed (${(rate * 100).toFixed(0)}%)`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ baseUrl, repeat, passed, total: results.length, results }, null, 2));
process.exit(rate >= minPass ? 0 : 1);
