import { readMcpUrl } from './config.ts';
import { agentsConfigIssues } from './config-issues.ts';

/**
 * Whether this sidecar can serve the assistant now, as opposed to /health, which says only that
 * the process answers. Ready needs a valid configuration and an app MCP endpoint that answers.
 * Any HTTP answer counts: the endpoint refuses a GET without a token, and that refusal proves the
 * route between the two containers. No model call is made: it would cost money.
 */
export type AssistantReadiness =
  | { status: 'ready'; checks: { configuration: 'ok'; mcp: 'reachable' } }
  | { status: 'not_ready'; checks: { configuration: 'ok'; mcp: 'unreachable' } }
  | { status: 'not_ready'; checks: { configuration: 'invalid' }; settings: string[] };

interface ReadinessOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function assistantReadiness(
  env: NodeJS.ProcessEnv = process.env,
  { fetch: fetchImpl = fetch, timeoutMs = 3000 }: ReadinessOptions = {},
): Promise<AssistantReadiness> {
  const issues = agentsConfigIssues(env);
  if (issues.length > 0) {
    return {
      status: 'not_ready',
      checks: { configuration: 'invalid' },
      settings: [...new Set(issues.map((issue) => issue.setting))],
    };
  }
  try {
    await fetchImpl(readMcpUrl(env), { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    return { status: 'ready', checks: { configuration: 'ok', mcp: 'reachable' } };
  } catch {
    return { status: 'not_ready', checks: { configuration: 'ok', mcp: 'unreachable' } };
  }
}
