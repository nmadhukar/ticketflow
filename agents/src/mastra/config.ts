import type { AgentId } from './session-token.ts';

/**
 * Sidecar settings, read from the environment. Validation that must stop the service lives in
 * server-config.ts (agentsConfigIssues); this file only parses.
 */

/** The model providers this sidecar supports, and the key each one needs. */
export const PROVIDER_KEYS = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
} as const;
export type ModelProvider = keyof typeof PROVIDER_KEYS;

export const DEFAULT_PROVIDER: ModelProvider = 'openrouter';
/** The provider's own model id (OpenRouter: "vendor/model"). */
export const DEFAULT_MODEL = 'openai/gpt-5-mini';
export const MODEL_FORMAT = /^[a-z0-9-]+(\/[A-Za-z0-9._:-]+)*$/;

/** Per-agent model overrides; unset means ASSISTANT_MODEL. */
export const AGENT_MODEL_SETTINGS: Record<AgentId, string> = {
  'support-assistant': 'ASSISTANT_SUPPORT_MODEL',
  'ticket-assistant': 'ASSISTANT_STAFF_MODEL',
};

/** Local development default: the app's internal listener on this machine. */
const DEV_MCP_URL = 'http://127.0.0.1:5100/internal/mcp';

function trimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? '';
}

export function readProvider(env: NodeJS.ProcessEnv = process.env): string {
  return trimmed(env, 'ASSISTANT_MODEL_PROVIDER') || DEFAULT_PROVIDER;
}

/** The provider's model id for an agent: its override, else ASSISTANT_MODEL, else the default. */
export function readModel(agentId: AgentId, env: NodeJS.ProcessEnv = process.env): string {
  return trimmed(env, AGENT_MODEL_SETTINGS[agentId]) || trimmed(env, 'ASSISTANT_MODEL') || DEFAULT_MODEL;
}

/** Mastra's model-router id, "provider/model": the only place the two are joined. */
export function modelRouterId(agentId: AgentId, env: NodeJS.ProcessEnv = process.env): `${string}/${string}` {
  return `${readProvider(env)}/${readModel(agentId, env)}`;
}

export function readMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
  return trimmed(env, 'ASSISTANT_MCP_URL') || DEV_MCP_URL;
}

/** Current ASSISTANT_AGENT_SECRET first, then the previous one during a rotation. */
export function readAgentSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const current = trimmed(env, 'ASSISTANT_AGENT_SECRET');
  if (!current) return [];
  const previous = trimmed(env, 'ASSISTANT_AGENT_SECRET_PREVIOUS');
  return previous ? [current, previous] : [current];
}
