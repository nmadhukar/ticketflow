import type { EvalCase } from './cases.ts';

/**
 * Deterministic scorers: no model call, so a run costs nothing to grade and the same answer always
 * gets the same score. An LLM judge is only worth adding for "did it invent a fact", which no
 * string check can decide; everything below is a rule the agents already state in rules.ts.
 *
 * Each scorer returns 1 (met) or 0 (not met) plus a reason, so a failure says which rule broke.
 */

export interface Score {
  scorerId: string;
  score: number;
  reason: string;
}

/** The agent's answer, as text. Mastra hands back a message or a string depending on the target. */
export function answerText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const text = (output as { text?: unknown }).text;
    if (typeof text === 'string') return text;
    const content = (output as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }
  return '';
}

/** Tool names the agent called, from the run's output. */
export function calledTools(output: unknown): string[] {
  const names = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    // Mastra's tool-call parts carry the name under `toolName`; some shapes use `name`.
    const name = record.toolName ?? (record.type === 'tool-call' ? record.name : undefined);
    if (typeof name === 'string') names.add(name.replace(/^ticketflow_/, ''));
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(output, 0);
  return [...names];
}

const lower = (s: string) => s.toLowerCase();

/** Every required substring is present. */
export function scoreMustInclude(testCase: EvalCase, answer: string): Score | null {
  const required = testCase.mustInclude ?? [];
  if (required.length === 0) return null;
  const text = lower(answer);
  const missing = required.filter((needle) => !text.includes(lower(needle)));
  return {
    scorerId: 'must-include',
    score: missing.length === 0 ? 1 : 0,
    reason: missing.length === 0 ? `contains ${required.join(', ')}` : `missing: ${missing.join(', ')}`,
  };
}

/** No forbidden substring appears. */
export function scoreMustNotInclude(testCase: EvalCase, answer: string): Score | null {
  const forbidden = testCase.mustNotInclude ?? [];
  if (forbidden.length === 0) return null;
  const text = lower(answer);
  const found = forbidden.filter((needle) => text.includes(lower(needle)));
  return {
    scorerId: 'must-not-include',
    score: found.length === 0 ? 1 : 0,
    reason: found.length === 0 ? 'no forbidden text' : `found: ${found.join(', ')}`,
  };
}

/** The agent called every tool it should have. */
export function scoreExpectedTools(testCase: EvalCase, tools: string[]): Score | null {
  const expected = testCase.expectTools ?? [];
  if (expected.length === 0) return null;
  const missing = expected.filter((name) => !tools.includes(name));
  return {
    scorerId: 'expected-tools',
    score: missing.length === 0 ? 1 : 0,
    reason: missing.length === 0 ? `called ${expected.join(', ')}` : `did not call: ${missing.join(', ')}`,
  };
}

/** The agent called none of the tools it must not. */
export function scoreForbiddenTools(testCase: EvalCase, tools: string[]): Score | null {
  const forbidden = testCase.forbidTools ?? [];
  if (forbidden.length === 0) return null;
  const called = forbidden.filter((name) => tools.includes(name));
  return {
    scorerId: 'forbidden-tools',
    score: called.length === 0 ? 1 : 0,
    reason: called.length === 0 ? 'no forbidden tool' : `called: ${called.join(', ')}`,
  };
}

/** Every scorer that applies to this case, in a fixed order. */
export function scoreCase(testCase: EvalCase, output: unknown): Score[] {
  const answer = answerText(output);
  const tools = calledTools(output);
  return [
    scoreMustInclude(testCase, answer),
    scoreMustNotInclude(testCase, answer),
    scoreExpectedTools(testCase, tools),
    scoreForbiddenTools(testCase, tools),
  ].filter((score): score is Score => score !== null);
}
