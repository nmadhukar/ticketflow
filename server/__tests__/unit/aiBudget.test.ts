const mockGetAIUsage = jest.fn();
const mockGetGenerationCost = jest.fn();
const mockDbUpdate = jest.fn();
const mockRecordAIUsage = jest.fn();
const mockGenerate = jest.fn();
jest.mock("../../storage", () => ({ storage: { getAIUsage: (...args: unknown[]) => mockGetAIUsage(...args), recordAIUsage: (...args: unknown[]) => mockRecordAIUsage(...args) } }));
jest.mock("../../storage/db", () => ({ db: { update: (...args: unknown[]) => mockDbUpdate(...args) } }));
jest.mock("../../admin/aiSettings", () => ({ getAISettings: async () => ({ ...settings, modelId: "requested/model", isActive: true, openRouterKeyConfigured: true, maxTokens: 2000, temperature: 0.3 }) }));
jest.mock("../../services/ai/openRouterClient", () => ({ createOpenRouterClient: () => ({ generate: (...args: unknown[]) => mockGenerate(...args) }) }));
jest.mock("../../services/ai/openRouterPricing", () => ({
  estimateCostUsd: (input: number, output: number, price: { promptUsdPerToken: number; completionUsdPerToken: number }) => input * price.promptUsdPerToken + output * price.completionUsdPerToken,
  createOpenRouterPricing: () => ({ getGenerationCost: (...args: unknown[]) => mockGetGenerationCost(...args), getModelPrice: async () => price }),
}));

import { assertBudgetAvailable, getDailyUsage, reconcileGenerationCost } from "../../services/ai/costMonitoring";
import { AiModelError } from "../../services/ai/aiErrors";
import { runTicketAnalysisPrompt } from "../../services/ai/bedrockIntegration";

const settings: any = { dailyLimitUsd: 2, monthlyLimitUsd: 5, maxTokensPerRequest: 3000 };
const price = { promptUsdPerToken: 0.001, completionUsdPerToken: 0.001 };
const input = { promptTokens: 900, maxOutputTokens: 1200, price, settings, todayUsd: 0, monthUsd: 0 };

describe("AI budget", () => {
  it("uses prompt plus full completion cap for each request", () => {
    expect(() => assertBudgetAvailable({ ...input, settings: { ...settings, maxTokensPerRequest: 2000 } })).toThrow();
    expect(() => assertBudgetAvailable({ ...input, settings: { ...settings, maxTokensPerRequest: 2100 }, todayUsd: 0, monthUsd: 0 })).toThrow();
    expect(() => assertBudgetAvailable({ ...input, settings: { ...settings, dailyLimitUsd: 3 } })).not.toThrow();
  });

  it("rejects missing pricing and projected period limits", () => {
    expect(() => assertBudgetAvailable({ ...input, price: undefined })).toThrow(AiModelError);
    expect(() => assertBudgetAvailable({ ...input, price: undefined })).toThrow("price_unavailable");
    expect(() => assertBudgetAvailable({ ...input, settings: { ...settings, dailyLimitUsd: 3 }, todayUsd: 1 })).toThrow();
    expect(() => assertBudgetAvailable({ ...input, settings: { ...settings, dailyLimitUsd: 10 }, monthUsd: 3 })).toThrow();
  });

  it("counts verified cost once and retains estimated cost", async () => {
    mockGetAIUsage.mockResolvedValue([{ timestamp: new Date(), modelId: "test/model", inputTokens: 10, outputTokens: 5, estimatedCost: "0.010000", verifiedCostUsd: "0.008000", billingStatus: "verified", operation: "chat" }]);
    const usage = await getDailyUsage();
    expect(usage.totalCost).toBe(0.008);
    expect(usage.totalEstimatedCost).toBe(0.01);
    expect(usage.totalVerifiedCost).toBe(0.008);
  });

  it("applies billed cost only to estimated generation row", async () => {
    mockGetGenerationCost.mockResolvedValue({ generationId: "gen-123", totalCostUsd: 0.008, actualModel: "actual/model" });
    const returning = jest.fn().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    const where = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where }));
    mockDbUpdate.mockReturnValue({ set });
    expect(await reconcileGenerationCost("gen-123")).toBe(true);
    expect(await reconcileGenerationCost("gen-123")).toBe(false);
    expect(set).toHaveBeenCalledWith({ verifiedCostUsd: "0.008", billingStatus: "verified", modelId: "actual/model" });
    expect(where).toHaveBeenCalledTimes(2);
  });

  it("keeps estimate when delayed billing has no total", async () => {
    mockGetGenerationCost.mockResolvedValue(null);
    mockDbUpdate.mockClear();
    expect(await reconcileGenerationCost("gen-123")).toBe(false);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("persists provider usage once with requested and actual model", async () => {
    mockGetAIUsage.mockResolvedValue([]);
    mockGetGenerationCost.mockResolvedValue(null);
    mockRecordAIUsage.mockResolvedValue({ id: 1 });
    mockGenerate.mockResolvedValue({ text: "{}", requestedModel: "requested/model", actualModel: "actual/model", promptTokens: 123, completionTokens: 45, generationId: "gen-123", estimatedCostUsd: 0.0002 });
    const result = await runTicketAnalysisPrompt("Analyze ticket");
    expect(result.actualTokens).toEqual({ input: 123, output: 45 });
    expect(result.costEstimate.estimatedCost).toBe(0.0002);
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 1000 }));
    expect(mockRecordAIUsage).toHaveBeenCalledTimes(1);
    expect(mockRecordAIUsage).toHaveBeenCalledWith(expect.objectContaining({ modelId: "actual/model", requestedModelId: "requested/model", generationId: "gen-123", inputTokens: 123, outputTokens: 45, estimatedCost: "0.0002", billingStatus: "estimated" }));
  });

  it("reduces the output cap to fit a long prompt within the request limit", async () => {
    const originalLimit = settings.maxTokensPerRequest;
    settings.maxTokensPerRequest = 500;
    try {
      mockGetAIUsage.mockResolvedValue([]);
      mockGetGenerationCost.mockResolvedValue(null);
      mockRecordAIUsage.mockResolvedValue({ id: 1 });
      mockGenerate.mockClear();
      mockGenerate.mockResolvedValue({ text: "{}", requestedModel: "requested/model", actualModel: "actual/model", promptTokens: 100, completionTokens: 50, estimatedCostUsd: 0.15 });
      await runTicketAnalysisPrompt("x".repeat(200));
      expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 384 }));
    } finally {
      settings.maxTokensPerRequest = originalLimit;
    }
  });

  it("blocks oversized prompts before invoking provider", async () => {
    mockGetAIUsage.mockResolvedValue([]);
    mockGenerate.mockClear();
    await expect(runTicketAnalysisPrompt("x".repeat(10_000))).rejects.toMatchObject({ isBlocked: true });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
