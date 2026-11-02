import { createHmac, hkdfSync, randomUUID } from 'node:crypto';

export const AGENT_SECRET = 'agent-hop-test-secret-with-32-characters!';

/**
 * Signs claims the way the app does (server/assistant/sessionToken.ts). `hop` picks the key label,
 * so a test can produce an MCP-hop token and show that this service refuses it.
 */
export function signClaims(claims, { secret = AGENT_SECRET, hop = 'agent' } = {}) {
  const info = hop === 'agent' ? 'ticketflow-assistant-agent-v1' : 'ticketflow-assistant-mcp-v1';
  const key = Buffer.from(hkdfSync('sha256', secret, '', info, 32));
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

export function agentToken({ agentId = 'support-assistant', sub = 'user-1', now = Date.now(), ...rest } = {}) {
  const iat = Math.floor(now / 1000);
  return signClaims(
    { v: 1, sub, aud: `ticketflow-agent:${agentId}`, iss: 'ticketflow-assistant', iat, exp: iat + 300, jti: randomUUID() },
    rest,
  );
}

export function request(path, { method = 'POST', mcpToken = 'opaque-mcp-token' } = {}) {
  const headers = mcpToken ? { 'x-ticketflow-mcp-session': mcpToken } : {};
  return new Request(`http://127.0.0.1:4111${path}`, { method, headers });
}

export const VALID_ENV = {
  NODE_ENV: 'production',
  ASSISTANT_ENABLED: 'true',
  ASSISTANT_AGENT_SECRET: AGENT_SECRET,
  ASSISTANT_MCP_URL: 'http://app:5100/internal/mcp',
  OPENROUTER_API_KEY: 'sk-or-test',
};
