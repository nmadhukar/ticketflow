import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantContentFilter, lastMessageText } from '../src/mastra/agents/content-guard.ts';

/**
 * Layer 2 of the content guard: the Studio agents' input processor.
 *
 * The copilot chat is guarded at the app's HTTP boundary (server/copilot/guard.ts). Studio's agent
 * chat is NOT behind that boundary - it talks to the sidecar directly - so the same rules must also
 * live inside the agent. Before this, the demo looked like the guardrail was broken: the copilot
 * refused a pasted password and Studio answered it.
 *
 * This proves both halves: the rules resolve from this package across the folder boundary (so
 * `mastra build` bundles them), and the processor aborts a blocked message.
 */

/** Calls processInput and reports whether it aborted. */
async function run(processor, text) {
  let aborted = false;
  try {
    await processor.processInput({
      messages: [{ role: 'user', content: text }],
      abort: () => {
        aborted = true;
        throw new Error('ABORTED');
      },
    });
  } catch (error) {
    if (error.message !== 'ABORTED') throw error;
  }
  return aborted;
}

test('reads the newest message, whatever shape it arrives in', () => {
  assert.equal(lastMessageText([{ role: 'user', content: 'hello' }]), 'hello');
  assert.equal(lastMessageText([{ role: 'user', content: { content: 'nested' } }]), 'nested');
  assert.equal(lastMessageText([{ role: 'user', content: [{ type: 'text', text: 'part' }] }]), 'part');
  assert.equal(lastMessageText([]), '');
});

test('is registered under the id Studio lists', () => {
  assert.equal(assistantContentFilter().id, 'ticketflow-content-guard');
});

test('blocks a pasted credential before the model is called', async () => {
  assert.equal(await run(assistantContentFilter(), 'my password is Hunter2Secret9'), true);
});

test('blocks abuse and a threat', async () => {
  for (const text of ['you are a stupid idiot', 'I will find you and beat you']) {
    assert.equal(await run(assistantContentFilter(), text), true, text);
  }
});

test('lets a normal support question through', async () => {
  assert.equal(await run(assistantContentFilter(), 'My VPN is not connecting since this morning'), false);
});
