import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '../index.ts';
import { MASTRA_USER_CONTEXT_KEY } from '../auth.ts';
import { CUSTOMER_CASES, STAFF_CASES, type EvalCase } from './cases.ts';
import { scoreCase, type Score } from './scorers.ts';

/** The seeded accounts (scripts/db/seed-eval-users.mjs). */
const EVAL_USER = { 'ticket-assistant': 'eval-staff', 'support-assistant': 'eval-customer' } as const;

/**
 * Opens a run for the case's agent and returns the request context the agent needs.
 *
 * The app-side harness (server/__tests__/eval/harness.ts) is the only thing that can open a run:
 * the registry lives in the app process, and the MCP-hop secret never leaves it. It is reached over
 * HTTP so this package keeps its own build context and imports no app code.
 */
async function openRun(agentId: 'ticket-assistant' | 'support-assistant'): Promise<{ requestContext: RequestContext; end: () => void }> {
  // The app's dev-only eval route (server/assistant/evalRuns.ts). It must be the app itself: the
  // run registry is per process, so a token opened anywhere else is refused as run_not_open.
  const base = process.env.EVAL_APP_URL?.trim() || 'http://127.0.0.1:5000';
  const response = await fetch(`${base}/api/assistant/eval/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: EVAL_USER[agentId], agentId }),
  });
  if (!response.ok) throw new Error(`The eval harness refused the run (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as { runId: string; userId: string; mcpToken: string };
  const requestContext = new RequestContext();
  requestContext.set(MASTRA_USER_CONTEXT_KEY, {
    kind: 'ticketflow',
    id: `user:${body.userId}`,
    userId: body.userId,
    agentId,
    runId: body.runId,
    mcp: { token: body.mcpToken },
  });
  return {
    requestContext,
    end: () => {
      void fetch(`${base}/api/assistant/eval/run/${body.runId}`, { method: 'DELETE' }).catch(() => undefined);
    },
  };
}

/**
 * Runs the evaluation cases through the real agents and grades the answers.
 *
 * Two modes, matching the two decisions on tool testing:
 *
 *   mock (default) - the agent's tools are replaced by canned answers, so a run is deterministic
 *                    and can never touch a ticket. This is what CI runs.
 *   live           - the agent calls the real TicketFlow MCP tools as the seeded eval user, against
 *                    the dedicated TKT-EVAL-* tickets. Opt-in, and only against a dev database.
 *
 * The dataset is created once and reused: items are matched by their `externalId` (the case id), so
 * re-running updates the same rows instead of piling up duplicates.
 */

export interface RunOptions {
  /** 'mock' (default) or 'live'. */
  mode?: 'mock' | 'live';
  /** Only these case ids. Default: every case. */
  only?: string[];
  /** Where to print progress. Default: console.log. */
  log?: (line: string) => void;
}

export interface CaseResult {
  id: string;
  group: EvalCase['group'];
  answer: string;
  scores: Score[];
  /** 1 when every scorer passed, 0 otherwise. */
  passed: boolean;
}

export interface RunSummary {
  datasetId: string;
  experimentId: string;
  mode: 'mock' | 'live';
  total: number;
  passed: number;
  failed: number;
  results: CaseResult[];
}

const DATASET_NAME = 'ticketflow-assistant-evals';

/** The dataset, created on first use and reused afterwards. */
async function ensureDataset() {
  const { datasets } = await mastra.datasets.list();
  const existing = datasets.find((d) => d.name === DATASET_NAME);
  if (existing) return mastra.datasets.get({ id: existing.id });
  return mastra.datasets.create({
    name: DATASET_NAME,
    description: 'Quality cases for the TicketFlow assistants: facts, tool choice, business rules, format.',
  });
}

/** Deletes the evaluation dataset, so the next run rebuilds it from cases.ts. */
export async function resetDataset(): Promise<string | null> {
  const { datasets } = await mastra.datasets.list();
  const existing = datasets.find((d) => d.name === DATASET_NAME);
  if (!existing) return null;
  await mastra.datasets.delete({ id: existing.id });
  return existing.id;
}

/**
 * Adds or updates one item per case, keyed by the case id.
 *
 * Items whose case no longer exists are left alone: deleting an item and re-adding the same
 * externalId in one pass conflicts with the dataset's versioning. A stale item is harmless (it is
 * never selected by `only`), and the count printed below is the number of cases, not of items.
 */
async function syncItems(dataset: Awaited<ReturnType<typeof ensureDataset>>, cases: EvalCase[]): Promise<void> {
  const listed = await dataset.listItems({ page: 0, perPage: 500 });
  const items = Array.isArray(listed) ? listed : listed.items;
  const byExternalId = new Map(items.map((item) => [item.externalId, item]));
  for (const testCase of cases) {
    const payload = {
      input: testCase.prompt,
      groundTruth: {
        mustInclude: testCase.mustInclude ?? [],
        mustNotInclude: testCase.mustNotInclude ?? [],
        expectTools: testCase.expectTools ?? [],
        forbidTools: testCase.forbidTools ?? [],
      },
      metadata: { group: testCase.group },
      externalId: testCase.id,
    };
    const existing = byExternalId.get(testCase.id);
    if (existing) await dataset.updateItem({ itemId: existing.id, ...payload });
    else await dataset.addItem(payload);
  }
}

/** How long one case may take before it is recorded as a failure. */
const CASE_TIMEOUT_MS = Number(process.env.EVAL_CASE_TIMEOUT_MS ?? 90_000);

/**
 * Runs one case in a child process and kills it if it overruns.
 *
 * A hung model call blocks the event loop, so no in-process timer can fire. A child process can
 * always be killed from outside, which is what makes the deadline real.
 */
function runCaseInChild(caseId: string): Promise<CaseResult> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fail = (reason: string): CaseResult => ({
    id: caseId,
    group: 'facts',
    answer: '',
    scores: [{ scorerId: 'run', score: 0, reason }],
    passed: false,
  });

  return new Promise((resolve) => {
    // execFile, not spawn: it buffers the output and enforces `timeout` itself, killing the child
    // with SIGTERM. A spawn whose pipes fill while the parent is busy can deadlock, which is what
    // made earlier runs stop after two cases.
    execFile(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', join(here, 'one.ts'), caseId],
      { timeout: CASE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const marker = stdout.lastIndexOf('__RESULT__');
        if (marker !== -1) {
          try {
            resolve(JSON.parse(stdout.slice(marker + '__RESULT__'.length).trim()) as CaseResult);
            return;
          } catch {
            // Fall through to the failure below.
          }
        }
        if (error && (error as { killed?: boolean }).killed) {
          resolve(fail(`timed out after ${Math.round(CASE_TIMEOUT_MS / 1000)}s`));
          return;
        }
        const last = stderr.trim().split(/\r?\n/).filter(Boolean).pop();
        resolve(fail(last ?? error?.message ?? 'no result'));
      },
    );
  });
}

/** Runs one case in this process. Used by one.ts, which the parent runs per case. */
export async function runOneCase(caseId: string): Promise<CaseResult> {
  const testCase = [...STAFF_CASES, ...CUSTOMER_CASES].find((c) => c.id === caseId);
  if (!testCase) throw new Error(`Unknown case: ${caseId}`);
  const agentId = STAFF_CASES.includes(testCase) ? 'ticket-assistant' : 'support-assistant';
  const agent = mastra.getAgent(agentId);
  // The agent's tools are discovered AS a run's user, so a run must be open first (mcp.ts
  // loadRunTools). The token comes from the app's dev-only eval route, which opens it in the app's
  // own registry; without one the agent refuses to load any tool.
  const run = await openRun(agentId);
  try {
    const output = await agent.generate(testCase.prompt, { requestContext: run.requestContext });
    const scores = scoreCase(testCase, output);
    return {
      id: testCase.id,
      group: testCase.group,
      answer: output.text ?? '',
      scores,
      passed: scores.every((s) => s.score === 1),
    };
  } finally {
    run.end();
  }
}

export async function runEvals({ mode = 'mock', only, log = console.log }: RunOptions = {}): Promise<RunSummary> {
  const cases = [...STAFF_CASES, ...CUSTOMER_CASES].filter((c) => !only || only.includes(c.id));
  if (cases.length === 0) throw new Error('No evaluation cases selected.');

  const dataset = await ensureDataset();
  await syncItems(dataset, cases);
  log(`dataset ${dataset.id}: ${cases.length} cases`);

  // Keeps the process alive between cases: execFile's child is the only pending handle, and Node
  // exits when the loop empties, which ended earlier runs after two cases.
  const keepAlive = setInterval(() => {}, 60_000);
  const results: CaseResult[] = [];
  try {
  for (const testCase of cases) {
    // Mock mode is not wired to the MCP client yet: it needs a run token, which lives in the app
    // process. Until then a mock run reports the case as skipped rather than calling a real tool.
    if (mode === 'mock') {
      results.push({ id: testCase.id, group: testCase.group, answer: '', scores: [], passed: false });
      log(`  ${testCase.id}: skipped (mock mode needs the app-side harness)`);
      continue;
    }
    // Each case runs in its own process: a hung model call blocks the event loop, so an in-process
    // timeout never fires. The parent can always kill a child.
    const result = await runCaseInChild(testCase.id);
    results.push(result);
    log(
      `  ${result.id}: ${result.passed ? 'pass' : 'FAIL'}${
        result.passed ? '' : ` (${result.scores.filter((s) => s.score === 0).map((s) => s.reason).join('; ')})`
      }`,
    );
  }

  } finally {
    clearInterval(keepAlive);
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    datasetId: dataset.id,
    experimentId: '',
    mode,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}
