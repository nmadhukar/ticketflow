import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_CASES, CUSTOMER_CASES, STAFF_CASES, MISSING_TICKET } from '../src/mastra/datasets/cases.ts';
import { answerText, calledTools, scoreCase } from '../src/mastra/datasets/scorers.ts';

const byId = (id) => ALL_CASES.find((c) => c.id === id);

test('every case has a unique id and a prompt', () => {
  const ids = ALL_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  for (const c of ALL_CASES) assert.ok(c.prompt.trim().length > 0, c.id);
});

test('every case asserts something, so a pass means something', () => {
  for (const c of ALL_CASES) {
    const checks = [c.mustInclude, c.mustIncludeAny, c.mustNotInclude, c.expectTools, c.expectToolsAny, c.forbidTools].filter(
      (v) => v && v.length > 0,
    );
    assert.ok(checks.length > 0, `${c.id} has no assertion`);
  }
});

test('the two agents have their own cases', () => {
  assert.ok(STAFF_CASES.length >= 15, `staff cases: ${STAFF_CASES.length}`);
  assert.ok(CUSTOMER_CASES.length >= 7, `customer cases: ${CUSTOMER_CASES.length}`);
});

test('a correct answer passes every scorer', () => {
  const c = byId('staff-facts-status');
  const scores = scoreCase(c, { text: 'TKT-EVAL-0001 is open.', toolCalls: [{ toolName: 'get_ticket' }] });
  // must-include and expected-tools apply to this case; must-not-include no longer does.
  assert.deepEqual(scores.map((s) => s.scorerId), ['must-include', 'expected-tools']);
  assert.ok(scores.every((s) => s.score === 1));
});

test('an invented status fails, and the reason names the rule', () => {
  const c = byId('staff-facts-status');
  const scores = scoreCase(c, { text: 'That ticket is closed.', toolCalls: [{ toolName: 'get_ticket' }] });
  const failed = scores.filter((s) => s.score === 0);
  assert.deepEqual(failed.map((s) => s.scorerId), ['must-include']);
  assert.match(failed[0].reason, /missing: open/);
});

test('a correct answer that mentions the opposite word still passes', () => {
  // "open, not closed yet" is right; a bare substring check must not fail it.
  const c = byId('staff-facts-status');
  const scores = scoreCase(c, { text: 'TKT-2099-0001 is open. It has not been closed or resolved.', toolCalls: [{ toolName: 'get_ticket' }] });
  assert.ok(scores.every((s) => s.score === 1), JSON.stringify(scores));
});

test('a refusal passes in any of its usual phrasings', () => {
  const c = byId('staff-facts-missing-ticket');
  for (const text of [
    'That ticket was not found for you.',
    "I couldn't find TKT-2099-9999 among the tickets you can access.",
    'I could not find that ticket.',
  ]) {
    const scores = scoreCase(c, { text, toolCalls: [{ toolName: 'get_ticket' }] });
    assert.ok(scores.every((s) => s.score === 1), `${text} -> ${JSON.stringify(scores)}`);
  }
  // Claiming it does not exist is still refused.
  const bad = scoreCase(c, { text: 'That ticket does not exist.', toolCalls: [{ toolName: 'get_ticket' }] });
  assert.ok(bad.some((s) => s.score === 0));
});

test('the wrong tool fails the tool-choice scorer', () => {
  const c = byId('staff-tools-list-own');
  const scores = scoreCase(c, { text: 'Here are your tickets.', toolCalls: [{ toolName: 'get_ticket' }] });
  const failed = scores.filter((s) => s.score === 0);
  assert.deepEqual(failed.map((s) => s.scorerId), ['expected-tools']);
});

test('a forbidden tool fails even when the answer reads well', () => {
  const c = byId('staff-tools-no-write');
  const scores = scoreCase(c, { text: 'I cannot close tickets.', toolCalls: [{ toolName: 'propose_comment' }] });
  const failed = scores.filter((s) => s.score === 0);
  assert.deepEqual(failed.map((s) => s.scorerId), ['forbidden-tools']);
});

test('claiming a comment was posted fails the business-rule check', () => {
  const c = byId('staff-rules-propose-on-request');
  const scores = scoreCase(c, { text: 'The comment has been posted.', toolCalls: [{ toolName: 'propose_comment' }] });
  const failed = scores.filter((s) => s.score === 0);
  assert.deepEqual(failed.map((s) => s.scorerId), ['must-not-include']);
});

test('a missing ticket must be "not found", never "does not exist"', () => {
  const c = byId('staff-facts-missing-ticket');
  assert.ok(c.prompt.includes(MISSING_TICKET));
  const good = scoreCase(c, { text: 'That ticket was not found for you.', toolCalls: [{ toolName: 'get_ticket' }] });
  assert.ok(good.every((s) => s.score === 1));
  const bad = scoreCase(c, { text: 'That ticket does not exist.', toolCalls: [{ toolName: 'get_ticket' }] });
  assert.ok(bad.some((s) => s.score === 0));
});

test('tool names are read from the run output, with the server prefix stripped', () => {
  assert.deepEqual(calledTools({ toolCalls: [{ toolName: 'ticketflow_get_ticket' }] }), ['get_ticket']);
  assert.deepEqual(calledTools({ parts: [{ type: 'tool-call', name: 'list_tickets' }] }), ['list_tickets']);
  assert.deepEqual(calledTools('plain text'), []);
});

test('the answer is read from a string, a message, or nothing', () => {
  assert.equal(answerText('hello'), 'hello');
  assert.equal(answerText({ text: 'hello' }), 'hello');
  assert.equal(answerText({ content: 'hello' }), 'hello');
  assert.equal(answerText(undefined), '');
});
