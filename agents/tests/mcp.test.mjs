import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensureFreshToken,
  loadRunTools,
  sanitizeOptionalToolArguments,
  sessionFetch,
  tokenExpiry,
} from '../src/mastra/mcp.ts';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const NOW_S = Math.floor(NOW / 1000);

/** An MCP-hop token as the app shapes it; the signature is irrelevant here (never verified). */
const tokenExpiring = (exp) => `${Buffer.from(JSON.stringify({ v: 1, exp })).toString('base64url')}.sig`;

const userWith = (token) => ({ kind: 'ticketflow', id: 'user:u1', userId: 'u1', agentId: 'support-assistant', runId: 'r', mcp: { token } });
const contextFor = (user) => ({ getRaw: (key) => (key === 'mastra__user' ? user : undefined) });

function recordingFetch(respond = () => new Response('{}', { status: 200 })) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: new Headers(init.headers) });
    return respond(String(url), init);
  };
  return { calls, fetchImpl };
}

test('reads a token expiry without trusting it, and null for anything else', () => {
  assert.equal(tokenExpiry(tokenExpiring(123)), 123);
  assert.equal(tokenExpiry('garbage'), null);
  assert.equal(tokenExpiry(`${Buffer.from('{"exp":"soon"}').toString('base64url')}.x`), null);
});

test('does not renew a token with more than a minute left', async () => {
  const user = userWith(tokenExpiring(NOW_S + 61));
  const { calls, fetchImpl } = recordingFetch();
  await ensureFreshToken(user, { fetchImpl, now: () => NOW, renewUrl: new URL('http://app:5100/internal/assistant/renew') });
  assert.equal(calls.length, 0);
});

test('renews a token about to expire, once for concurrent calls, and swaps it in place', async () => {
  const old = tokenExpiring(NOW_S + 30);
  const user = userWith(old);
  const { calls, fetchImpl } = recordingFetch(() => Response.json({ token: 'fresh.token' }));
  const opts = { fetchImpl, now: () => NOW, renewUrl: new URL('http://app:5100/internal/assistant/renew') };
  await Promise.all([ensureFreshToken(user, opts), ensureFreshToken(user, opts), ensureFreshToken(user, opts)]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'http://app:5100/internal/assistant/renew');
  assert.equal(calls[0].headers.get('x-ticketflow-mcp-session'), old);
  assert.equal(user.mcp.token, 'fresh.token');
});

test('keeps the current token when the app refuses or cannot be reached', async () => {
  const token = tokenExpiring(NOW_S + 30);
  for (const respond of [() => new Response('{"reason":"renew_too_early"}', { status: 409 }), () => Promise.reject(new TypeError('fetch failed'))]) {
    const user = userWith(token);
    await ensureFreshToken(user, { fetchImpl: async () => respond(), now: () => NOW, renewUrl: new URL('http://app/renew') });
    assert.equal(user.mcp.token, token);
  }
});

test('every MCP request carries its own run token and never an Authorization header', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const send = sessionFetch(fetchImpl);
  const fresh = tokenExpiring(Math.floor(Date.now() / 1000) + 300);
  await send('http://app:5100/internal/mcp', { method: 'POST', headers: { authorization: 'Bearer tfk_leaked' } }, contextFor(userWith(fresh)));
  await send('http://app:5100/internal/mcp', { method: 'POST' }, contextFor(userWith('other.token')));
  assert.equal(calls[0].headers.get('x-ticketflow-mcp-session'), fresh);
  assert.equal(calls[0].headers.get('authorization'), null);
  assert.equal(calls[1].headers.get('x-ticketflow-mcp-session'), 'other.token');
});

test('refuses to call TicketFlow, or load tools, without a run', async () => {
  const { calls, fetchImpl } = recordingFetch();
  await assert.rejects(sessionFetch(fetchImpl)('http://app:5100/internal/mcp', {}, null), /No assistant run/);
  await assert.rejects(sessionFetch(fetchImpl)('http://app:5100/internal/mcp', {}, contextFor({ kind: 'studio', id: 'studio' })), /No assistant run/);
  assert.equal(calls.length, 0);
  await assert.rejects(loadRunTools({ requestContext: contextFor(undefined) }), /No assistant run/);
});

test('drops nulls the schema does not allow, and keeps the ones it does', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'number' }, status: { type: 'string' }, note: { type: ['string', 'null'] }, tag: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  };
  assert.deepEqual(sanitizeOptionalToolArguments({ id: null, status: null, note: null, tag: null, limit: 5 }, schema), {
    id: null,
    note: null,
    tag: null,
    limit: 5,
  });
  assert.equal(sanitizeOptionalToolArguments('text', schema), 'text');
});
