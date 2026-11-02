import { readMcpUrl, readRetentionDays, staffHistoryEnabled } from './config.ts';
import { agentsConfigIssues } from './config-issues.ts';

/**
 * Whether this sidecar can serve the assistant now, as opposed to /health, which says only that
 * the process answers. Ready needs a valid configuration, an app MCP endpoint that answers and,
 * with staff history on, a conversation store that answers. Any HTTP answer from the MCP route
 * counts: it refuses a GET without a token, and that refusal proves the route between the two
 * containers. No model call is made: it would cost money.
 */
export type AssistantReadiness =
  // historyRetentionDays: how long saved conversations are kept, for the app to tell staff.
  | { status: 'ready'; checks: { configuration: 'ok'; mcp: 'reachable'; history: 'ok' | 'off' }; historyRetentionDays?: number }
  | { status: 'not_ready'; checks: { configuration: 'ok'; mcp: 'reachable' | 'unreachable'; history: 'ok' | 'off' | 'unreachable' } }
  | { status: 'not_ready'; checks: { configuration: 'invalid' }; settings: string[] };

interface ReadinessOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Proves the conversation store answers; the default asks the staff memory for nothing. */
  checkHistory?: () => Promise<void>;
}

async function defaultHistoryCheck(): Promise<void> {
  const { staffMemory } = await import('./storage.ts');
  await staffMemory?.listThreads({ page: 0, perPage: 1, filter: { resourceId: 'readiness-probe' } });
}

export async function assistantReadiness(
  env: NodeJS.ProcessEnv = process.env,
  { fetch: fetchImpl = fetch, timeoutMs = 3000, checkHistory = defaultHistoryCheck }: ReadinessOptions = {},
): Promise<AssistantReadiness> {
  const issues = agentsConfigIssues(env);
  if (issues.length > 0) {
    return {
      status: 'not_ready',
      checks: { configuration: 'invalid' },
      settings: [...new Set(issues.map((issue) => issue.setting))],
    };
  }
  // Both checks at once, so /ready answers within one timeout (the app's probe waits a little longer).
  const mcpCheck = (async (): Promise<'reachable' | 'unreachable'> => {
    try {
      const response = await fetchImpl(readMcpUrl(env), { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      // Only that it answered matters. Discard the body so the connection is released, not held
      // until garbage collection, however often /ready is polled.
      await response.body?.cancel();
      return 'reachable';
    } catch {
      return 'unreachable';
    }
  })();
  const historyCheck: Promise<'ok' | 'off' | 'unreachable'> = staffHistoryEnabled(env)
    ? Promise.race([
        checkHistory().then(() => 'ok' as const),
        new Promise<'unreachable'>((resolve) => setTimeout(() => resolve('unreachable'), timeoutMs).unref()),
      ]).catch(() => 'unreachable' as const)
    : Promise.resolve('off' as const);
  const [mcp, history] = await Promise.all([mcpCheck, historyCheck]);
  if (mcp === 'reachable' && history !== 'unreachable') {
    return {
      status: 'ready',
      checks: { configuration: 'ok', mcp, history },
      ...(history === 'ok' ? { historyRetentionDays: readRetentionDays(env) } : {}),
    };
  }
  return { status: 'not_ready', checks: { configuration: 'ok', mcp, history } };
}
