import type { AssistantAgentId } from "@shared/assistant";
import type { RunSummary } from "./runTracking";
import { estimateCostUsd } from "../services/ai/openRouterPricing";

/**
 * The record of each assistant run (assistant_usage_events, migration 0033) and its cost.
 *
 * Cost lives in ai_usage only, the one record of AI spend that the AI budgets read: one row per run
 * that used tokens, linked by assistant_run_id, estimated from OpenRouter's price for the model the
 * sidecar reported. The usage row holds no content and no cost.
 *
 * Recording never fails a run: the browser has its answer already; a failure here is logged.
 */
export interface RunContext {
  runId: string;
  userId: string;
  agentId: AssistantAgentId;
  provider: string | null;
  /** The provider's model id, e.g. openai/gpt-5-mini (OpenRouter). */
  model: string | null;
  startedAt: Date;
}

export interface UsageDeps {
  insertUsageEvent: (row: {
    runId: string;
    agentId: string;
    userId: string;
    provider: string | null;
    model: string | null;
    startedAt: Date;
    durationMs: number;
    status: "completed" | "failed" | "stopped" | "refused";
    errorCategory: string | null;
    toolCallCount: number;
    toolNames: string[];
    proposalCount: number;
  }) => Promise<void>;
  /** costMonitoring.recordUsage in production. */
  recordCost: (usage: {
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    operation: string;
    estimatedCost: number;
    userId: string;
    assistantRunId: string;
  }) => Promise<void>;
  /** USD per token for an OpenRouter model id, or null when not known. */
  price: (model: string) => Promise<{ promptUsdPerToken: number; completionUsdPerToken: number } | null>;
}

const MAX_TOOLS = 50;

export const ASSISTANT_OPERATION: Record<AssistantAgentId, string> = {
  "support-assistant": "assistant.support",
  "ticket-assistant": "assistant.staff",
};

/** Records one finished (or refused) run, and its cost when it used tokens. Never throws. */
export async function recordRun(
  deps: UsageDeps,
  run: RunContext,
  summary: RunSummary | { status: "refused"; errorCategory: string },
): Promise<void> {
  const full: Omit<RunSummary, "status"> & { status: RunSummary["status"] | "refused" } =
    summary.status === "refused"
      ? { status: "refused", errorCategory: summary.errorCategory, toolNames: [], proposalCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 }
      : summary;
  // The model the run itself reported wins over the one the sidecar advertised.
  const reported: { provider?: string; model?: string } = summary.status === "refused" ? {} : summary;
  const provider = reported.provider ?? run.provider;
  const model = reported.model ?? run.model;
  try {
    await deps.insertUsageEvent({
      runId: run.runId,
      agentId: run.agentId,
      userId: run.userId,
      provider,
      model,
      startedAt: run.startedAt,
      durationMs: Math.max(0, Math.round(full.durationMs)),
      status: full.status,
      errorCategory: full.errorCategory,
      toolCallCount: full.toolNames.length,
      toolNames: full.toolNames.slice(0, MAX_TOOLS),
      proposalCount: full.proposalCount,
    });
  } catch (error) {
    console.error(`Assistant usage row not written [${error instanceof Error ? error.name : "error"}]`);
  }

  if (full.inputTokens + full.outputTokens === 0) return;
  try {
    // A model OpenRouter has no price for is recorded at 0 rather than not at all: the tokens show.
    const price = provider === "openrouter" && model ? await deps.price(model).catch(() => null) : null;
    const estimatedCost = price ? estimateCostUsd(full.inputTokens, full.outputTokens, price) : 0;
    await deps.recordCost({
      modelId: model ?? "unknown",
      inputTokens: full.inputTokens,
      outputTokens: full.outputTokens,
      operation: ASSISTANT_OPERATION[run.agentId],
      estimatedCost,
      userId: run.userId,
      assistantRunId: run.runId,
    });
  } catch (error) {
    console.error(`Assistant cost row not written [${error instanceof Error ? error.name : "error"}]`);
  }
}

/** The production dependencies, loaded on first use (they reach the database). */
export async function defaultUsageDeps(): Promise<UsageDeps> {
  const [{ db }, { assistantUsageEvents }, { recordUsage, getModelPrice }] = await Promise.all([
    import("../storage/db"),
    import("@shared/schema"),
    import("../services/ai/costMonitoring"),
  ]);
  return {
    insertUsageEvent: async (row) => {
      await db.insert(assistantUsageEvents).values(row).onConflictDoNothing({ target: assistantUsageEvents.runId });
    },
    recordCost: (usage) => recordUsage(usage),
    price: (model) => getModelPrice(model),
  };
}

/**
 * Whether the AI budgets (AI settings: daily and monthly USD limits) are already used up. The
 * assistant's own spend counts towards them through ai_usage. Checked before each run.
 */
export async function budgetExhausted(): Promise<string | null> {
  const { loadCostLimits, getBudgetSpend } = await import("../services/ai/costMonitoring");
  const [limits, spend] = await Promise.all([loadCostLimits(), getBudgetSpend()]);
  if (spend.dailyUsd >= limits.dailyLimitUSD) return "daily_budget";
  if (spend.monthlyUsd >= limits.monthlyLimitUSD) return "monthly_budget";
  return null;
}
