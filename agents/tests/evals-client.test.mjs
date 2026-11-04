import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Session } from '../evals/client.mjs';

// The eval client against a stand-in TicketFlow: no app, no model.
async function standIn(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('keeps each cookie by name, as a browser does: a later Set-Cookie does not drop the session', async () => {
  const seen = [];
  const { server, url } = await standIn((req, res) => {
    seen.push(req.headers.cookie ?? '');
    if (req.url === '/api/auth/login') res.setHeader('Set-Cookie', ['connect.sid=s1; Path=/; HttpOnly']);
    if (req.url === '/pref') res.setHeader('Set-Cookie', ['theme=dark; Path=/']);
    res.setHeader('Content-Type', 'application/json');
    res.end('{}');
  });
  try {
    const s = await new Session(url).login('a@b.test', 'pw');
    await s.request('GET', '/pref');
    await s.request('GET', '/check');
    assert.equal(seen.at(-1), 'connect.sid=s1; theme=dark');
  } finally {
    server.close();
  }
});

test('a run cut off by the timeout still reports what it did, its drafts included', async () => {
  const { server, url } = await standIn((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"RUN_STARTED"}\n\n');
    res.write('data: {"type":"TOOL_CALL_START","toolCallName":"ticketflow_propose_comment"}\n\n');
    res.write(`data: ${JSON.stringify({ type: 'TOOL_CALL_RESULT', content: JSON.stringify({ proposalId: 'p-123', action: 'add_comment' }) })}\n\n`);
    // ...and then the stream stalls: no RUN_FINISHED.
  });
  try {
    const run = await new Session(url).ask('ticket-assistant', 'hi', { timeoutMs: 300 });
    assert.equal(run.timedOut, true);
    assert.equal(run.finished, false);
    assert.deepEqual(run.toolCalls, ['propose_comment']);
    assert.deepEqual(run.proposalIds, ['p-123']);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
