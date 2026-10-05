/**
 * Unit tests for AI cost monitoring.
 *
 * Usage and limits live in the database behind `storage`, so storage is mocked
 * here and each test states exactly which rows the module would read.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

jest.mock("../storage", () => ({
  storage: {
    getAIUsage: jest.fn(),
    recordAIUsage: jest.fn(),
    deleteAIUsage: jest.fn(),
    getAISettings: jest.fn(),
    updateAISettings: jest.fn(),
  },
}));
jest.mock("../storage/db", () => ({ db: {} }));
jest.mock("../services/ai/openRouterPricing", () => ({
  estimateCostUsd: (input: number, output: number, price: { promptUsdPerToken: number; completionUsdPerToken: number }) => input * price.promptUsdPerToken + output * price.completionUsdPerToken,
  createOpenRouterPricing: () => ({ getModelPrice: async () => ({ promptUsdPerToken: 0.000001, completionUsdPerToken: 0.000002 }) }),
}));

import { storage } from "../storage";
import {
  estimateTokens,
  estimatePromptTokensForBudget,
  recordUsage,
  shouldBlockRequest,
  getDailyUsage,
  getMonthlyUsage,
  resetUsageData,
  exportUsageData,
  loadCostLimits,
  saveCostLimits,
} from "../services/ai/costMonitoring";

const mocked = storage as unknown as Record<string, jest.Mock<any>>;

const HAIKU = "anthropic.claude-3-haiku-20240307-v1:0";

function row(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: new Date("2024-01-15T10:00:00.000Z"),
    modelId: HAIKU,
    inputTokens: 1000,
    outputTokens: 500,
    estimatedCost: "0.001",
    operation: "analyze-ticket",
    userId: null,
    ticketId: null,
    ...overrides,
  };
}

describe("Cost Monitoring", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mocked.getAIUsage.mockResolvedValue([]);
    mocked.getAISettings.mockResolvedValue(undefined);
    mocked.recordAIUsage.mockResolvedValue(undefined);
    mocked.deleteAIUsage.mockResolvedValue(undefined);
  });

  describe("estimateTokens", () => {
    it("estimates one token per four characters, rounding up", () => {
      expect(estimateTokens("Hello world! This is a test.")).toBe(7);
      expect(estimateTokens("abc")).toBe(1);
      expect(estimateTokens("a".repeat(1000))).toBe(250);
      expect(estimateTokens("")).toBe(0);
    });
  });

  describe("recordUsage", () => {
    it("stores the usage with its estimated cost", async () => {
      await recordUsage({ modelId: HAIKU, inputTokens: 1000, outputTokens: 500, estimatedCost: 0.000875, operation: "op", userId: "user-1", ticketId: "42", generationId: "gen-123", requestedModelId: "requested/model" });

      expect(mocked.recordAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: HAIKU,
          inputTokens: 1000,
          outputTokens: 500,
          operation: "op",
          userId: "user-1",
          ticketId: 42,
          generationId: "gen-123",
          requestedModelId: "requested/model",
        })
      );
      const saved = mocked.recordAIUsage.mock.calls[0][0] as any;
      expect(Number(saved.estimatedCost)).toBeCloseTo(0.000875, 6);
    });

    it("stores a null user for system calls so the foreign key holds", async () => {
      await recordUsage({ modelId: HAIKU, inputTokens: 10, outputTokens: 10, estimatedCost: 0.00003, operation: "op", userId: "system" });
      expect(mocked.recordAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null, ticketId: null })
      );
    });

    it("reports storage failure so usage cannot silently disappear", async () => {
      mocked.recordAIUsage.mockRejectedValue(new Error("db down"));
      await expect(recordUsage({ modelId: HAIKU, inputTokens: 10, outputTokens: 10, estimatedCost: 0.00003, operation: "op" })).rejects.toThrow("db down");
    });
  });

  describe("loadCostLimits / saveCostLimits", () => {
    it("returns the defaults when no settings row exists", async () => {
      expect(await loadCostLimits()).toEqual({
        dailyLimitUSD: 50,
        monthlyLimitUSD: 100,
        maxTokensPerRequest: 3000,
      });
    });

    it("reads the limits from the stored settings", async () => {
      mocked.getAISettings.mockResolvedValue({
        dailyLimitUsd: "5.00",
        monthlyLimitUsd: "20.00",
        maxTokensPerRequest: 1000,
      });
      expect(await loadCostLimits()).toEqual({
        dailyLimitUSD: 5,
        monthlyLimitUSD: 20,
        maxTokensPerRequest: 1000,
      });
    });

    it("writes the limits back as strings and ints", async () => {
      mocked.getAISettings.mockResolvedValue({ id: 1 });
      await saveCostLimits(
        { dailyLimitUSD: 7, monthlyLimitUSD: 30, maxTokensPerRequest: 500 },
        "admin-1"
      );
      expect(mocked.updateAISettings).toHaveBeenCalledWith(
        expect.objectContaining({ dailyLimitUsd: "7", monthlyLimitUsd: "30", maxTokensPerRequest: 500 }),
        "admin-1"
      );
    });

    it("reports a failed limit save to the caller", async () => {
      mocked.updateAISettings.mockRejectedValueOnce(new Error("database unavailable"));
      await expect(saveCostLimits(
        { dailyLimitUSD: 7, monthlyLimitUSD: 30, maxTokensPerRequest: 500 },
        "admin-1"
      )).rejects.toThrow("database unavailable");
    });
  });

  it("estimates preflight prompt tokens using UTF-8 bytes and chat framing", () => {
    expect(estimatePromptTokensForBudget("abc")).toBe(18);
    expect(estimatePromptTokensForBudget("😀")).toBe(18);
  });

  describe("shouldBlockRequest", () => {
    beforeEach(() => {
      mocked.getAISettings.mockResolvedValue({
        dailyLimitUsd: "5.00",
        monthlyLimitUsd: "50.00",
        maxTokensPerRequest: 1000,
      });
    });

    it("allows a small request when nothing has been spent", async () => {
      const result = await shouldBlockRequest(HAIKU, 100, 50, "test");
      expect(result.blocked).toBe(false);
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it("blocks a request that would push the day over its limit", async () => {
      // Daily and monthly queries both see $4.99 already spent.
      mocked.getAIUsage.mockResolvedValue([row({ estimatedCost: "4.99" })]);
      const result = await shouldBlockRequest(HAIKU, 100000, 100000, "test");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Daily cost limit exceeded");
    });

    it("blocks on the monthly limit when the day is still under", async () => {
      // First call is the daily window, second the monthly window.
      mocked.getAIUsage
        .mockResolvedValueOnce([row({ estimatedCost: "0.01" })])
        .mockResolvedValueOnce([row({ estimatedCost: "49.99999" })]);
      const result = await shouldBlockRequest(HAIKU, 100, 50, "test");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Monthly cost limit exceeded");
    });

    it("blocks a request over the per-request token cap", async () => {
      const result = await shouldBlockRequest(HAIKU, 600, 600, "test");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Request exceeds max tokens per request");
    });
  });

  describe("getDailyUsage / getMonthlyUsage", () => {
    it("is empty when there are no records", async () => {
      const usage = await getDailyUsage("2024-01-15");
      expect(usage).toEqual({
        date: "2024-01-15",
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        totalEstimatedCost: 0,
        totalVerifiedCost: 0,
        requestCount: 0,
        operations: {},
      });
    });

    it("sums tokens and cost and counts operations", async () => {
      mocked.getAIUsage.mockResolvedValue([
        row(),
        row({
          inputTokens: 2000,
          outputTokens: 1000,
          estimatedCost: "0.002",
          operation: "generate-response",
        }),
      ]);
      const usage = await getDailyUsage("2024-01-15");
      expect(usage.totalInputTokens).toBe(3000);
      expect(usage.totalOutputTokens).toBe(1500);
      expect(usage.totalCost).toBeCloseTo(0.003, 6);
      expect(usage.requestCount).toBe(2);
      expect(usage.operations).toEqual({
        "analyze-ticket": 1,
        "generate-response": 1,
      });
    });

    it("queries the whole day for a daily summary", async () => {
      await getDailyUsage("2024-01-15");
      const { startDate, endDate } = mocked.getAIUsage.mock.calls[0][0] as any;
      expect(endDate.getTime() - startDate.getTime()).toBeGreaterThan(
        23 * 3600 * 1000
      );
    });

    it("labels a monthly summary YYYY-MM and queries the whole month", async () => {
      const usage = await getMonthlyUsage(2024, 2);
      expect(usage.date).toBe("2024-02");
      const { startDate, endDate } = mocked.getAIUsage.mock.calls[0][0] as any;
      expect(startDate.getUTCMonth()).toBe(1);
      expect(endDate.getUTCDate()).toBe(29); // 2024 is a leap year
    });
  });

  describe("resetUsageData", () => {
    it("deletes the stored usage", async () => {
      await resetUsageData();
      expect(mocked.deleteAIUsage).toHaveBeenCalledTimes(1);
    });

    it("does not throw when storage fails", async () => {
      mocked.deleteAIUsage.mockRejectedValue(new Error("db down"));
      await expect(resetUsageData()).resolves.toBeUndefined();
    });
  });

  describe("exportUsageData", () => {
    it("passes the date range through and maps rows to records", async () => {
      mocked.getAIUsage.mockResolvedValue([row({ userId: "u1", ticketId: 7 })]);
      const records = await exportUsageData("2024-01-01", "2024-01-31");

      const filters = mocked.getAIUsage.mock.calls[0][0] as any;
      expect(filters.startDate).toEqual(new Date("2024-01-01"));
      expect(filters.endDate).toEqual(new Date("2024-01-31"));
      expect(records).toEqual([
        {
          timestamp: "2024-01-15T10:00:00.000Z",
          modelId: HAIKU,
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.001,
          operation: "analyze-ticket",
          userId: "u1",
          ticketId: "7",
        },
      ]);
    });
  });
});
