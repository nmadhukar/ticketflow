import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssistantAuth, isHistoryRoute, TicketFlowSessionAuth } from '../src/mastra/auth.ts';
import { AGENT_SECRET, agentToken, request } from './helpers.mjs';

const auth = new TicketFlowSessionAuth([AGENT_SECRET]);

test('authenticates an app-minted agent-hop token and keeps the MCP token for the run', async () => {
  const user = await auth.authenticateToken(agentToken({ agentId: 'ticket-assistant', sub: 'u-7' }), request('/api/agents/ticket-assistant/stream', { mcpToken: 'mcp-abc' }));
  assert.equal(user.kind, 'ticketflow');
  assert.equal(user.userId, 'u-7');
  assert.equal(user.agentId, 'ticket-assistant');
  assert.match(user.runId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(user.mcp, { token: 'mcp-abc' });
  assert.equal(auth.mapUserToResourceId(user), 'user:u-7');
});

test('refuses a request without its MCP token, or with an oversized one', async () => {
  const token = agentToken();
  assert.equal(await auth.authenticateToken(token, request('/api/agents/support-assistant/stream', { mcpToken: null })), null);
  assert.equal(await auth.authenticateToken(token, request('/api/agents/support-assistant/stream', { mcpToken: 'x'.repeat(2049) })), null);
});

test('refuses a wrong secret, an MCP-hop token, an expired token and a foreign audience', async () => {
  const req = request('/api/agents/support-assistant/stream');
  assert.equal(await auth.authenticateToken(agentToken({ secret: 'another-secret-that-is-32-characters-long' }), req), null);
  assert.equal(await auth.authenticateToken(agentToken({ hop: 'mcp' }), req), null);
  assert.equal(await auth.authenticateToken(agentToken({ now: Date.now() - 301_000 }), req), null);
  assert.equal(await auth.authenticateToken('not-a-token', req), null);
});

test('accepts the previous secret during a rotation', async () => {
  const rotating = new TicketFlowSessionAuth(['new-secret-that-is-at-least-32-characters', AGENT_SECRET]);
  assert.ok(await rotating.authenticateToken(agentToken(), request('/api/agents/support-assistant/stream')));
});

test('a user may run only their own agent, and nothing else under it', async () => {
  const customer = await auth.authenticateToken(agentToken({ agentId: 'support-assistant' }), request('/'));
  assert.equal(auth.authorizeUser(customer, request('/api/agents/support-assistant/stream')), true);
  assert.equal(auth.authorizeUser(customer, request('/api/agents/support-assistant/generate')), true);
  assert.equal(auth.authorizeUser(customer, request('/api/agents/ticket-assistant/stream')), false);
  for (const path of ['/api/agents/support-assistant/model', '/api/agents/support-assistant/tools/x/execute', '/api/agents', '/api/tools']) {
    assert.equal(auth.authorizeUser(customer, request(path)), false, path);
  }
  assert.equal(auth.authorizeUser(customer, request('/api/agents/support-assistant/stream', { method: 'GET' })), false);
});

test('history routes are open to the staff agent only, for its own agentId', async () => {
  const staff = await auth.authenticateToken(agentToken({ agentId: 'ticket-assistant' }), request('/'));
  const customer = await auth.authenticateToken(agentToken({ agentId: 'support-assistant' }), request('/'));
  const list = request('/api/memory/threads?agentId=ticket-assistant', { method: 'GET' });
  assert.equal(auth.authorizeUser(staff, list), true);
  assert.equal(auth.authorizeUser(customer, list), false);
  assert.equal(auth.authorizeUser(staff, request('/api/memory/threads?agentId=support-assistant', { method: 'GET' })), false);
  assert.equal(auth.authorizeUser(staff, request('/api/memory/threads/t-1?agentId=ticket-assistant', { method: 'DELETE' })), true);
  // Creating or renaming a thread stays closed.
  assert.equal(auth.authorizeUser(staff, request('/api/memory/threads?agentId=ticket-assistant')), false);
  assert.equal(isHistoryRoute('PATCH', new URL('http://x/api/memory/threads/t-1?agentId=ticket-assistant')), false);
});

test('the Studio token works in development only, scoped to its own resource', async () => {
  const studioToken = 'studio-token-for-tests-with-32-characters!';
  const dev = createAssistantAuth({ ASSISTANT_AGENT_SECRET: AGENT_SECRET, MASTRA_STUDIO_TOKEN: studioToken, NODE_ENV: 'development' });
  const prod = createAssistantAuth({ ASSISTANT_AGENT_SECRET: AGENT_SECRET, MASTRA_STUDIO_TOKEN: studioToken, NODE_ENV: 'production' });
  const req = request('/api/agents/support-assistant/stream', { mcpToken: null });
  assert.equal((await dev.authenticateToken(studioToken, req))?.kind, 'studio');
  assert.equal(await prod.authenticateToken(studioToken, req), null);
});
