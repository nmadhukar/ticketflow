import {
  AGENT_MODEL_SETTINGS,
  MODEL_FORMAT,
  PROVIDER_KEYS,
  readModel,
  readProvider,
  readStorageUrl,
  staffHistoryEnabled,
} from './config.ts';
import { AGENT_IDS } from './session-token.ts';

/** One reason this service must not serve, with the setting it concerns. Never a value. */
export interface AgentsConfigIssue {
  setting: string;
  message: string;
}

export const MIN_SECRET_LENGTH = 32;

function secretIssues(env: NodeJS.ProcessEnv): AgentsConfigIssue[] {
  const issues: AgentsConfigIssue[] = [];
  const add = (setting: string, message: string) => issues.push({ setting, message });
  const current = env.ASSISTANT_AGENT_SECRET?.trim() ?? '';
  const previous = env.ASSISTANT_AGENT_SECRET_PREVIOUS?.trim() ?? '';
  const studio = env.MASTRA_STUDIO_TOKEN?.trim() ?? '';

  if (!current) add('ASSISTANT_AGENT_SECRET', 'ASSISTANT_AGENT_SECRET is required; it must equal the app\'s value.');
  else if (current.length < MIN_SECRET_LENGTH) add('ASSISTANT_AGENT_SECRET', `ASSISTANT_AGENT_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  if (previous) {
    if (!current) add('ASSISTANT_AGENT_SECRET_PREVIOUS', 'ASSISTANT_AGENT_SECRET_PREVIOUS is set without ASSISTANT_AGENT_SECRET.');
    else if (previous.length < MIN_SECRET_LENGTH) add('ASSISTANT_AGENT_SECRET_PREVIOUS', `ASSISTANT_AGENT_SECRET_PREVIOUS must be at least ${MIN_SECRET_LENGTH} characters.`);
    else if (previous === current) add('ASSISTANT_AGENT_SECRET_PREVIOUS', 'ASSISTANT_AGENT_SECRET_PREVIOUS must differ from ASSISTANT_AGENT_SECRET.');
  }

  // The MCP-hop secret stays in the app: with it this service could act as any user.
  for (const appOnly of ['ASSISTANT_SESSION_SECRET', 'ASSISTANT_SESSION_SECRET_PREVIOUS']) {
    if (env[appOnly]?.trim()) add(appOnly, `${appOnly} must not be given to the agents service; it belongs to the app only.`);
  }
  // Production runs act only as the signed-in user. An API key here would be a standing credential.
  if (env.NODE_ENV === 'production' && env.TICKETFLOW_MCP_KEY?.trim()) {
    add('TICKETFLOW_MCP_KEY', 'TICKETFLOW_MCP_KEY must not be set in production; the assistant acts only as the signed-in user.');
  }

  if (studio && env.NODE_ENV === 'production') {
    add('MASTRA_STUDIO_TOKEN', 'MASTRA_STUDIO_TOKEN must not be set in production; Studio is for local development only.');
  } else if (studio) {
    if (studio.length < MIN_SECRET_LENGTH) add('MASTRA_STUDIO_TOKEN', `MASTRA_STUDIO_TOKEN must be at least ${MIN_SECRET_LENGTH} characters.`);
    else if (studio === current || studio === previous) add('MASTRA_STUDIO_TOKEN', 'MASTRA_STUDIO_TOKEN must differ from ASSISTANT_AGENT_SECRET.');
  }
  return issues;
}

function modelIssues(env: NodeJS.ProcessEnv): AgentsConfigIssue[] {
  const provider = readProvider(env);
  // hasOwn, not `in`: "constructor" or "toString" must not pass as a provider.
  if (!Object.hasOwn(PROVIDER_KEYS, provider)) {
    return [{
      setting: 'ASSISTANT_MODEL_PROVIDER',
      message: `ASSISTANT_MODEL_PROVIDER "${provider}" is not supported; use ${Object.keys(PROVIDER_KEYS).join(' or ')}.`,
    }];
  }
  const issues: AgentsConfigIssue[] = [];
  for (const agentId of AGENT_IDS) {
    if (!MODEL_FORMAT.test(readModel(agentId, env))) {
      const setting = env[AGENT_MODEL_SETTINGS[agentId]]?.trim() ? AGENT_MODEL_SETTINGS[agentId] : 'ASSISTANT_MODEL';
      issues.push({ setting, message: `${setting} is not a valid model id.` });
    }
  }
  const keyName = PROVIDER_KEYS[provider as keyof typeof PROVIDER_KEYS];
  if (!env[keyName]?.trim()) issues.push({ setting: keyName, message: `${keyName} is required for ASSISTANT_MODEL_PROVIDER ${provider}.` });
  // A model id may repeat for both agents; report each bad setting once.
  return issues.filter((issue, i) => issues.findIndex((other) => other.setting === issue.setting) === i);
}

function mcpIssues(env: NodeJS.ProcessEnv): AgentsConfigIssue[] {
  const value = env.ASSISTANT_MCP_URL?.trim();
  if (!value) {
    return env.NODE_ENV === 'production'
      ? [{ setting: 'ASSISTANT_MCP_URL', message: 'ASSISTANT_MCP_URL is required in production; it is the app\'s internal /internal/mcp address.' }]
      : [];
  }
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    // Not a URL: reported below with the rest.
  }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    return [{ setting: 'ASSISTANT_MCP_URL', message: 'ASSISTANT_MCP_URL must be an HTTP(S) URL without credentials, a query or a fragment.' }];
  }
  return [];
}

function historyIssues(env: NodeJS.ProcessEnv): AgentsConfigIssue[] {
  const issues: AgentsConfigIssue[] = [];
  const raw = env.ASSISTANT_HISTORY_RETENTION_DAYS?.trim();
  if (raw && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 365)) {
    issues.push({ setting: 'ASSISTANT_HISTORY_RETENTION_DAYS', message: 'ASSISTANT_HISTORY_RETENTION_DAYS must be an integer from 1 to 365.' });
  }
  return issues;
}

/**
 * The assistant role's URL, checked whenever it is set: Mastra keeps its own state there (datasets
 * and experiments) whether or not staff history is on, so a bad value would silently fall back to
 * an in-memory store and lose that state on restart. Required only while history is on; with
 * history off an unset value is fine, and a bad one is not fatal (the customer assistant would go
 * down with it): storage.ts warns that retention is not running instead.
 */
function storageIssues(env: NodeJS.ProcessEnv): AgentsConfigIssue[] {
  const value = readStorageUrl(env);
  let url: URL | null = null;
  try {
    url = value ? new URL(value) : null;
  } catch {
    // Not a URL: reported below.
  }
  const usable = !!url && ['postgres:', 'postgresql:'].includes(url.protocol) && !!url.username && !!url.password;
  if (usable) return [];
  if (!staffHistoryEnabled(env)) return [];
  return [{
    setting: 'MASTRA_DATABASE_URL',
    message: "MASTRA_DATABASE_URL must be the assistant role's postgres:// URL, with user and password, when ASSISTANT_STAFF_HISTORY=true.",
  }];
}

/**
 * Everything that stops this service serving the assistant. Mirrors the app's
 * server/assistant/config.ts for the settings both read, checked independently here.
 */
export function agentsConfigIssues(env: NodeJS.ProcessEnv = process.env): AgentsConfigIssue[] {
  return [...secretIssues(env), ...modelIssues(env), ...mcpIssues(env), ...historyIssues(env), ...storageIssues(env)];
}

export function agentsConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  return agentsConfigIssues(env).map((issue) => issue.message);
}
