/**
 * What the agents service reports about saved staff conversations (its public /ready).
 *
 * The app sends staff runs only their newest message when memory holds the rest, so it must not
 * rely on its own ASSISTANT_STAFF_HISTORY alone: if the sidecar has no memory (switched off there,
 * or its store is down), every turn would start from nothing. History counts as on only when both
 * the app's switch and the sidecar say so. Cached briefly, so runs do not each pay for a probe.
 */
export interface SidecarHistory {
  on: boolean;
  retentionDays: number | null;
}

const OFF: SidecarHistory = { on: false, retentionDays: null };

export function createSidecarHistoryStatus(
  agentUrl: string,
  opts: { fetch?: typeof fetch; ttlMs?: number; failureTtlMs?: number; now?: () => number } = {},
): () => Promise<SidecarHistory> {
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { until: number; value: SidecarHistory } | null = null;
  let pending: Promise<SidecarHistory> | null = null;

  const probe = async (): Promise<SidecarHistory> => {
    try {
      const res = await fetchImpl(new URL("/ready", agentUrl), { signal: AbortSignal.timeout(3000) });
      const body = (await res.json().catch(() => ({}))) as { checks?: { history?: unknown }; historyRetentionDays?: unknown };
      const on = res.ok && body.checks?.history === "ok";
      const days = body.historyRetentionDays;
      const value = on ? { on, retentionDays: Number.isInteger(days) ? (days as number) : null } : OFF;
      cached = { until: now() + (opts.ttlMs ?? 60_000), value };
      return value;
    } catch {
      cached = { until: now() + (opts.failureTtlMs ?? 10_000), value: OFF };
      return OFF;
    }
  };

  return async () => {
    if (cached && now() < cached.until) return cached.value;
    // One probe at a time; concurrent callers share it.
    pending ??= probe().finally(() => {
      pending = null;
    });
    return pending;
  };
}
