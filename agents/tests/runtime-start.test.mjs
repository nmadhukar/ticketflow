import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { assistantMode, startStandbyServer } from '../runtime/start.mjs';

test('serves only when ASSISTANT_ENABLED is exactly "true"', () => {
  assert.equal(assistantMode({ ASSISTANT_ENABLED: 'true' }), 'serve');
  for (const value of [undefined, '', 'TRUE', '1', 'yes']) assert.equal(assistantMode({ ASSISTANT_ENABLED: value }), 'standby');
});

test('standby is alive but never ready, and serves nothing else', async () => {
  const server = startStandbyServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    const run = await fetch(`${base}/api/agents/support-assistant/stream`, { method: 'POST' });
    assert.equal(run.status, 503);
    assert.deepEqual(await run.json(), { error: 'The assistant is not enabled.' });
  } finally {
    server.close();
  }
});
