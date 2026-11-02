import { recordRun, type RunContext, type UsageDeps } from "../../../assistant/usage";
import type { RunSummary } from "../../../assistant/runTracking";

const run: RunContext = {
  runId: "3f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01",
  userId: "staff-1",
  agentId: "ticket-assistant",
  provider: "openrouter",
  model: "openai/gpt-5-mini",
  startedAt: new Date("2026-11-02T10:00:00Z"),
};

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  status: "completed",
  errorCategory: null,
  toolNames: ["get_ticket"],
  proposalCount: 0,
  stepCount: 2,
  inputTokens: 1000,
  outputTokens: 200,
  durationMs: 4200.4,
  ...over,
});

function fakeDeps(over: Partial<UsageDeps> = {}) {
  const usage: unknown[] = [];
  const cost: unknown[] = [];
  const deps: UsageDeps = {
    insertUsageEvent: async (row) => void usage.push(row),
    recordCost: async (row) => void cost.push(row),
    price: async () => ({ promptUsdPerToken: 0.25e-6, completionUsdPerToken: 2e-6 }),
    ...over,
  };
  return { deps, usage, cost };
}

describe("assistant run usage", () => {
  it("records the run, and its cost in ai_usage, priced from OpenRouter, linked by run id", async () => {
    const { deps, usage, cost } = fakeDeps();
    await recordRun(deps, run, summary());
    expect(usage).toEqual([
      expect.objectContaining({ runId: run.runId, agentId: "ticket-assistant", userId: "staff-1", model: "openai/gpt-5-mini", status: "completed", durationMs: 4200, stepCount: 2, toolNames: ["get_ticket"] }),
    ]);
    expect(cost).toEqual([
      { modelId: "openai/gpt-5-mini", inputTokens: 1000, outputTokens: 200, operation: "assistant.staff", estimatedCost: 1000 * 0.25e-6 + 200 * 2e-6, userId: "staff-1", assistantRunId: run.runId },
    ]);
  });

  it("writes no cost row for a run that used no tokens, and records refusals", async () => {
    const { deps, usage, cost } = fakeDeps();
    await recordRun(deps, run, summary({ inputTokens: 0, outputTokens: 0, status: "stopped" }));
    await recordRun(deps, { ...run, runId: "4f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01" }, { status: "refused", errorCategory: "daily_budget" });
    expect(cost).toEqual([]);
    expect(usage).toEqual([
      expect.objectContaining({ status: "stopped" }),
      expect.objectContaining({ status: "refused", errorCategory: "daily_budget", toolNames: [], durationMs: 0 }),
    ]);
  });

  it("records tokens at cost 0 when the model has no known price, or the provider is not OpenRouter", async () => {
    const noPrice = fakeDeps({ price: async () => null });
    await recordRun(noPrice.deps, run, summary());
    expect(noPrice.cost).toEqual([expect.objectContaining({ estimatedCost: 0, inputTokens: 1000 })]);
    const openai = fakeDeps();
    await recordRun(openai.deps, { ...run, provider: "openai", model: "gpt-5-mini" }, summary());
    expect(openai.cost).toEqual([expect.objectContaining({ estimatedCost: 0, modelId: "gpt-5-mini" })]);
  });

  it("never throws: a failed write is logged and the run goes on", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = fakeDeps({
      insertUsageEvent: async () => {
        throw new Error("db down");
      },
      recordCost: async () => {
        throw new Error("db down");
      },
    });
    await expect(recordRun(deps, run, summary())).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it("keeps at most 50 tool names", async () => {
    const { deps, usage } = fakeDeps();
    await recordRun(deps, run, summary({ toolNames: Array.from({ length: 80 }, () => "get_ticket") }));
    expect((usage[0] as { toolNames: string[] }).toolNames).toHaveLength(50);
  });
});
