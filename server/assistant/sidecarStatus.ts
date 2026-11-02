/**
 * What the agents service says about saved staff conversations (its public /ready).
 *
 * Its `checks.history` decides, whatever the overall status: "ok" means the agent has memory, "off"
 * means it has none. Both are definitive. Anything else (unreachable, timed out, a configuration
 * fault, history "unreachable") is UNKNOWN: a blip must not flip how runs are built, so the last
 * definitive answer stands until a new one arrives.
 *
 *   - `state` (current): on / off / unknown. The history routes and availability need "on".
 *   - `memory` (for building runs): the current definitive answer, else the last one, else null
 *     (never heard): the caller then uses its own switch.
 *
 * Cached: a definitive answer for 60 s, an unknown one for 10 s; one probe at a time.
 */
export type HistoryState = "on" | "off" | "unknown";

export interface SidecarHistory {
  state: HistoryState;
  /** Whether the sidecar's agent has memory, as last definitively reported; null if never. */
  memory: boolean | null;
  retentionDays: number | null;
  /** The provider and each agent's model, as last reported (usage and cost are recorded against them). */
  provider: string | null;
  models: Record<string, string>;
}

export function createSidecarHistoryStatus(
  agentUrl: string,
  opts: { fetch?: typeof fetch; ttlMs?: number; unknownTtlMs?: number; timeoutMs?: number; now?: () => number } = {},
): () => Promise<SidecarHistory> {
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { until: number; value: SidecarHistory } | null = null;
  let pending: Promise<SidecarHistory> | null = null;
  let lastDefinitive: { memory: boolean; retentionDays: number | null } | null = null;
  let lastModels: { provider: string | null; models: Record<string, string> } = { provider: null, models: {} };

  const settle = (state: HistoryState, retentionDays: number | null): SidecarHistory => {
    if (state !== "unknown") lastDefinitive = { memory: state === "on", retentionDays };
    const value: SidecarHistory = {
      state,
      memory: lastDefinitive?.memory ?? null,
      retentionDays: state === "on" ? retentionDays : null,
      ...lastModels,
    };
    cached = { until: now() + (state === "unknown" ? (opts.unknownTtlMs ?? 10_000) : (opts.ttlMs ?? 60_000)), value };
    return value;
  };

  const probe = async (): Promise<SidecarHistory> => {
    try {
      // Longer than the sidecar's own checks (its MCP and store probes, 3 s each, in parallel).
      const res = await fetchImpl(new URL("/ready", agentUrl), { signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
      const body = (await res.json().catch(() => ({}))) as {
        checks?: { history?: unknown };
        historyRetentionDays?: unknown;
        provider?: unknown;
        models?: unknown;
      };
      if (typeof body.provider === "string" && body.models && typeof body.models === "object") {
        const models = Object.fromEntries(Object.entries(body.models).filter(([, v]) => typeof v === "string")) as Record<string, string>;
        lastModels = { provider: body.provider, models };
      }
      const history = body.checks?.history;
      const days = Number.isInteger(body.historyRetentionDays) ? (body.historyRetentionDays as number) : null;
      if (history === "ok") return settle("on", days);
      if (history === "off") return settle("off", null);
      return settle("unknown", null);
    } catch {
      return settle("unknown", null);
    }
  };

  return async () => {
    if (cached && now() < cached.until) return cached.value;
    pending ??= probe().finally(() => {
      pending = null;
    });
    return pending;
  };
}
