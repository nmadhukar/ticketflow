import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelRouterId } from '../src/mastra/config.ts';
import { assistantReadiness } from '../src/mastra/readiness.ts';
import { agentsConfigIssues } from '../src/mastra/config-issues.ts';
import { createServerConfig } from '../src/mastra/server-config.ts';
import { AGENT_SECRET, VALID_ENV } from './helpers.mjs';

const settings = (env) => agentsConfigIssues(env).map((issue) => issue.setting);

test('a complete production configuration has no issues', () => {
  assert.deepEqual(agentsConfigIssues(VALID_ENV), []);
});

test('the agent secret is required, strong, and distinct from the previous one', () => {
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_AGENT_SECRET: '' }), ['ASSISTANT_AGENT_SECRET']);
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_AGENT_SECRET: 'short' }), ['ASSISTANT_AGENT_SECRET']);
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_AGENT_SECRET_PREVIOUS: AGENT_SECRET }), ['ASSISTANT_AGENT_SECRET_PREVIOUS']);
});

test('refuses the app-only MCP-hop secret and, in production, a standing API key', () => {
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_SESSION_SECRET: 'x'.repeat(40) }), ['ASSISTANT_SESSION_SECRET']);
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_SESSION_SECRET_PREVIOUS: 'x'.repeat(40) }), ['ASSISTANT_SESSION_SECRET_PREVIOUS']);
  assert.deepEqual(settings({ ...VALID_ENV, TICKETFLOW_MCP_KEY: 'tfk_abc' }), ['TICKETFLOW_MCP_KEY']);
  assert.deepEqual(settings({ ...VALID_ENV, NODE_ENV: 'development', TICKETFLOW_MCP_KEY: 'tfk_abc' }), []);
});

test('Studio is refused in production and must be strong elsewhere', () => {
  const studio = 'studio-token-for-tests-with-32-characters!';
  assert.deepEqual(settings({ ...VALID_ENV, MASTRA_STUDIO_TOKEN: studio }), ['MASTRA_STUDIO_TOKEN']);
  assert.deepEqual(settings({ ...VALID_ENV, NODE_ENV: 'development', MASTRA_STUDIO_TOKEN: studio }), []);
  assert.deepEqual(settings({ ...VALID_ENV, NODE_ENV: 'development', MASTRA_STUDIO_TOKEN: 'short' }), ['MASTRA_STUDIO_TOKEN']);
  assert.deepEqual(settings({ ...VALID_ENV, NODE_ENV: 'development', MASTRA_STUDIO_TOKEN: AGENT_SECRET }), ['MASTRA_STUDIO_TOKEN']);
});

test('the model: a supported provider, its key, and valid ids', () => {
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_MODEL_PROVIDER: 'anthropic' }), ['ASSISTANT_MODEL_PROVIDER']);
  assert.deepEqual(settings({ ...VALID_ENV, OPENROUTER_API_KEY: '' }), ['OPENROUTER_API_KEY']);
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', ASSISTANT_MODEL: 'gpt-5-mini' }), []);
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_MODEL: 'bad model' }), ['ASSISTANT_MODEL']);
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_STAFF_MODEL: 'Bad/Model' }), ['ASSISTANT_STAFF_MODEL']);
});

test('model router ids: the default, ASSISTANT_MODEL, and per-agent overrides', () => {
  assert.equal(modelRouterId('support-assistant', {}), 'openrouter/openai/gpt-5-mini');
  const env = { ASSISTANT_MODEL: 'meta-llama/llama-3.3-70b-instruct', ASSISTANT_STAFF_MODEL: 'anthropic/claude-haiku-5.5' };
  assert.equal(modelRouterId('support-assistant', env), 'openrouter/meta-llama/llama-3.3-70b-instruct');
  assert.equal(modelRouterId('ticket-assistant', env), 'openrouter/anthropic/claude-haiku-5.5');
  assert.equal(modelRouterId('ticket-assistant', { ASSISTANT_MODEL_PROVIDER: 'openai', ASSISTANT_MODEL: 'gpt-5-mini' }), 'openai/gpt-5-mini');
});

test('the MCP URL: required in production, plain HTTP(S) only', () => {
  assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_MCP_URL: '' }), ['ASSISTANT_MCP_URL']);
  assert.deepEqual(settings({ ...VALID_ENV, NODE_ENV: 'development', ASSISTANT_MCP_URL: '' }), []);
  for (const bad of ['ftp://app/mcp', 'http://u:p@app/mcp', 'http://app/mcp?key=1', 'http://app/mcp#x', 'not a url']) {
    assert.deepEqual(settings({ ...VALID_ENV, ASSISTANT_MCP_URL: bad }), ['ASSISTANT_MCP_URL'], bad);
  }
});

test('issues name settings, never values', () => {
  const secret = 'leaky-secret-value';
  const text = agentsConfigIssues({ ...VALID_ENV, ASSISTANT_AGENT_SECRET: secret, ASSISTANT_SESSION_SECRET: secret }).map((i) => i.message).join(' ');
  assert.equal(text.includes(secret), false);
});

test('the server answers no cross-origin request and exposes a public /ready', () => {
  const config = createServerConfig(VALID_ENV);
  assert.equal(config.cors, false);
  assert.equal(config.port, 4111);
  assert.deepEqual(config.apiRoutes.map((route) => [route.path, route.method]), [['/ready', 'GET']]);
});

test('readiness: invalid configuration names settings; otherwise the MCP route decides', async () => {
  assert.deepEqual(await assistantReadiness({ ...VALID_ENV, OPENROUTER_API_KEY: '' }), {
    status: 'not_ready',
    checks: { configuration: 'invalid' },
    settings: ['OPENROUTER_API_KEY'],
  });
  const answered = async () => new Response(null, { status: 405 });
  const refused = async () => {
    throw new TypeError('fetch failed');
  };
  assert.equal((await assistantReadiness(VALID_ENV, { fetch: answered })).status, 'ready');
  assert.deepEqual((await assistantReadiness(VALID_ENV, { fetch: refused })).checks, { configuration: 'ok', mcp: 'unreachable' });
});
