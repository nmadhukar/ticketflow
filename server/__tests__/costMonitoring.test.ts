/**
 * Unit Tests for AWS Bedrock Cost Monitoring
 *
 * Tests all cost monitoring functionality including:
 * - Cost estimation
 * - Token estimation
 * - Usage tracking
 * - Request blocking logic
 * - Data persistence
 * - Statistics generation
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  estimateCost,
  estimateTokens,
  recordUsage,
  shouldBlockRequest,
  getDailyUsage,
  getMonthlyUsage,
  getCostStatistics,
  resetUsageData,
  exportUsageData,
  loadCostLimits,
  saveCostLimits,
  UsageRecord,
  DailyUsage,
  CostLimits,
} from "../costMonitoring";

// Mock file system operations
jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

// Test data directory
const TEST_DATA_DIR = path.join(process.cwd(), "server", "data");
const TEST_USAGE_FILE = path.join(TEST_DATA_DIR, "bedrock-usage.json");
const TEST_LIMITS_FILE = path.join(TEST_DATA_DIR, "cost-limits.json");

describe("Cost Monitoring", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Mock file system to return empty arrays/files by default
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.readFileSync.mockReturnValue("[]");
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.mkdirSync.mockImplementation(() => undefined);
  });

  describe("estimateCost", () => {
    it("should calculate cost correctly for Claude Haiku", () => {
      const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
      const inputTokens = 1000;
      const outputTokens = 500;

      const cost = estimateCost(modelId, inputTokens, outputTokens);

      // Expected: (1000/1M * $0.25) + (500/1M * $1.25) = $0.00025 + $0.000625 = $0.000875
      expect(cost).toBeCloseTo(0.000875, 6);
    });

    it("should calculate cost correctly for Claude Sonnet", () => {
      const modelId = "anthropic.claude-3-sonnet-20240229-v1:0";
      const inputTokens = 1000;
      const outputTokens = 500;

      const cost = estimateCost(modelId, inputTokens, outputTokens);

      // Expected: (1000/1M * $3.00) + (500/1M * $15.00) = $0.003 + $0.0075 = $0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it("should calculate cost correctly for Claude Opus", () => {
      const modelId = "anthropic.claude-3-opus-20240229-v1:0";
      const inputTokens = 1000;
      const outputTokens = 500;

      const cost = estimateCost(modelId, inputTokens, outputTokens);

      // Expected: (1000/1M * $15.00) + (500/1M * $75.00) = $0.015 + $0.0375 = $0.0525
      expect(cost).toBeCloseTo(0.0525, 6);
    });

    it("should use Sonnet pricing for unknown models", () => {
      const modelId = "unknown-model";
      const inputTokens = 1000;
      const outputTokens = 500;

      const cost = estimateCost(modelId, inputTokens, outputTokens);

      // Should fallback to Sonnet pricing
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it("should handle zero tokens", () => {
      const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
      const cost = estimateCost(modelId, 0, 0);

      expect(cost).toBe(0);
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens correctly for English text", () => {
      const text = "Hello world! This is a test.";
      const tokens = estimateTokens(text);

      // 28 characters / 4 = 7 tokens
      expect(tokens).toBe(7);
    });

    it("should handle empty string", () => {
      const tokens = estimateTokens("");
      expect(tokens).toBe(0);
    });

    it("should handle very long text", () => {
      const text = "a".repeat(1000);
      const tokens = estimateTokens(text);

      expect(tokens).toBe(250); // 1000 / 4
    });

    it("should round up for partial tokens", () => {
      const text = "abc"; // 3 characters
      const tokens = estimateTokens(text);

      expect(tokens).toBe(1); // Math.ceil(3/4) = 1
    });
  });

  describe("recordUsage", () => {
    it("should record usage and save to file", () => {
      const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
      const inputTokens = 1000;
      const outputTokens = 500;
      const operation = "test-operation";
      const userId = "user-123";
      const ticketId = "ticket-456";

      recordUsage(
        modelId,
        inputTokens,
        outputTokens,
        operation,
        userId,
        ticketId
      );

      // Verify that writeFileSync was called
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        TEST_USAGE_FILE,
        expect.stringContaining(
          '"modelId":"anthropic.claude-3-haiku-20240307-v1:0"'
        ),
        "utf-8"
      );
    });

    it("should handle file write errors gracefully", () => {
      mockedFs.writeFileSync.mockImplementation(() => {
        throw new Error("Write error");
      });

      // Should not throw
      expect(() => {
        recordUsage("test-model", 100, 50, "test");
      }).not.toThrow();
    });
  });

  describe("shouldBlockRequest", () => {
    beforeEach(() => {
      // Mock empty usage records
      mockedFs.readFileSync.mockReturnValue("[]");
    });

    it("should not block request within limits", () => {
      const result = shouldBlockRequest(
        "anthropic.claude-3-haiku-20240307-v1:0",
        100,
        50,
        "test"
      );

      expect(result.blocked).toBe(false);
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it("should block request exceeding daily cost limit", () => {
      // Mock daily usage that's close to limit
      const mockUsage: UsageRecord[] = [
        {
          timestamp: new Date().toISOString(),
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 1000000, // High usage
          outputTokens: 1000000,
          estimatedCost: 4.9, // Close to $5 daily limit
          operation: "test",
        },
      ];

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const result = shouldBlockRequest(
        "anthropic.claude-3-haiku-20240307-v1:0",
        100000, // Large request
        100000,
        "test"
      );

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Daily cost limit exceeded");
    });

    it("should block request exceeding monthly cost limit", () => {
      // Mock monthly usage that's close to limit
      const mockUsage: UsageRecord[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        inputTokens: 100000,
        outputTokens: 100000,
        estimatedCost: 1.5, // Total ~$45, close to $50 monthly limit
        operation: "test",
      }));

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const result = shouldBlockRequest(
        "anthropic.claude-3-haiku-20240307-v1:0",
        100000,
        100000,
        "test"
      );

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Monthly cost limit exceeded");
    });

    it("should block request exceeding max tokens per request", () => {
      const result = shouldBlockRequest(
        "anthropic.claude-3-haiku-20240307-v1:0",
        2000, // Exceeds default 1000 token limit
        2000,
        "test"
      );

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Request exceeds max tokens per request");
    });

    it("should block request exceeding daily request limit", () => {
      // Mock 50 requests (at daily limit)
      const mockUsage: UsageRecord[] = Array.from({ length: 50 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        inputTokens: 100,
        outputTokens: 50,
        estimatedCost: 0.001,
        operation: "test",
      }));

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const result = shouldBlockRequest(
        "anthropic.claude-3-haiku-20240307-v1:0",
        100,
        50,
        "test"
      );

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Daily request limit exceeded");
    });

    it("should block request exceeding hourly request limit", () => {
      // Mock 10 requests in the last hour (at hourly limit)
      const mockUsage: UsageRecord[] = Array.from({ length: 10 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 5 * 60 * 1000).toISOString(), // Last 50 minutes
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        inputTokens: 100,
        outputTokens: 50,
        estimatedCost: 0.001,
        operation: "test",
      }));

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const result = shouldBlockRequest(
        "anthropic.claude-3-haiku-20240307-v1:0",
        100,
        50,
        "test"
      );

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Hourly request limit exceeded");
    });
  });

  describe("getDailyUsage", () => {
    it("should return empty usage for no records", () => {
      mockedFs.readFileSync.mockReturnValue("[]");

      const usage = getDailyUsage();

      expect(usage.date).toBeDefined();
      expect(usage.totalInputTokens).toBe(0);
      expect(usage.totalOutputTokens).toBe(0);
      expect(usage.totalCost).toBe(0);
      expect(usage.requestCount).toBe(0);
      expect(usage.operations).toEqual({});
    });

    it("should calculate daily usage correctly", () => {
      const today = new Date().toISOString().split("T")[0];
      const mockUsage: UsageRecord[] = [
        {
          timestamp: `${today}T10:00:00.000Z`,
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.001,
          operation: "analyze-ticket",
        },
        {
          timestamp: `${today}T11:00:00.000Z`,
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 2000,
          outputTokens: 1000,
          estimatedCost: 0.002,
          operation: "generate-response",
        },
      ];

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const usage = getDailyUsage();

      expect(usage.totalInputTokens).toBe(3000);
      expect(usage.totalOutputTokens).toBe(1500);
      expect(usage.totalCost).toBeCloseTo(0.003, 6);
      expect(usage.requestCount).toBe(2);
      expect(usage.operations["analyze-ticket"]).toBe(1);
      expect(usage.operations["generate-response"]).toBe(1);
    });

    it("should filter records by specific date", () => {
      const specificDate = "2024-01-15";
      const mockUsage: UsageRecord[] = [
        {
          timestamp: `${specificDate}T10:00:00.000Z`,
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.001,
          operation: "test",
        },
        {
          timestamp: "2024-01-16T10:00:00.000Z",
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 2000,
          outputTokens: 1000,
          estimatedCost: 0.002,
          operation: "test",
        },
      ];

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const usage = getDailyUsage(specificDate);

      expect(usage.totalInputTokens).toBe(1000);
      expect(usage.totalOutputTokens).toBe(500);
      expect(usage.requestCount).toBe(1);
    });
  });

  describe("getMonthlyUsage", () => {
    it("should return empty usage for no records", () => {
      mockedFs.readFileSync.mockReturnValue("[]");

      const usage = getMonthlyUsage();

      expect(usage.date).toBeDefined();
      expect(usage.totalInputTokens).toBe(0);
      expect(usage.totalOutputTokens).toBe(0);
      expect(usage.totalCost).toBe(0);
      expect(usage.requestCount).toBe(0);
    });

    it("should calculate monthly usage correctly", () => {
      const currentDate = new Date();
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;

      const mockUsage: UsageRecord[] = [
        {
          timestamp: `${year}-${month
            .toString()
            .padStart(2, "0")}-01T10:00:00.000Z`,
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.001,
          operation: "test",
        },
        {
          timestamp: `${year}-${month
            .toString()
            .padStart(2, "0")}-15T10:00:00.000Z`,
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 2000,
          outputTokens: 1000,
          estimatedCost: 0.002,
          operation: "test",
        },
        {
          timestamp: `${year}-${(month + 1)
            .toString()
            .padStart(2, "0")}-01T10:00:00.000Z`,
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 3000,
          outputTokens: 1500,
          estimatedCost: 0.003,
          operation: "test",
        },
      ];

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const usage = getMonthlyUsage();

      expect(usage.totalInputTokens).toBe(3000); // Only first two records
      expect(usage.totalOutputTokens).toBe(1500);
      expect(usage.requestCount).toBe(2);
    });
  });

  describe("getCostStatistics", () => {
    it("should return complete statistics", () => {
      const mockUsage: UsageRecord[] = [
        {
          timestamp: new Date().toISOString(),
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.001,
          operation: "test",
        },
      ];

      mockedFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockUsage)) // For daily usage
        .mockReturnValueOnce(JSON.stringify(mockUsage)) // For monthly usage
        .mockReturnValueOnce(JSON.stringify(mockUsage)) // For recent usage
        .mockReturnValueOnce(JSON.stringify({})); // For limits

      const stats = getCostStatistics();

      expect(stats.dailyUsage).toBeDefined();
      expect(stats.monthlyUsage).toBeDefined();
      expect(stats.limits).toBeDefined();
      expect(stats.recentUsage).toBeDefined();
      expect(stats.recentUsage).toHaveLength(1);
    });
  });

  describe("resetUsageData", () => {
    it("should reset usage data to empty array", () => {
      resetUsageData();

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        TEST_USAGE_FILE,
        "[]",
        "utf-8"
      );
    });

    it("should handle file write errors gracefully", () => {
      mockedFs.writeFileSync.mockImplementation(() => {
        throw new Error("Write error");
      });

      expect(() => resetUsageData()).not.toThrow();
    });
  });

  describe("exportUsageData", () => {
    it("should export all data when no date range specified", () => {
      const mockUsage: UsageRecord[] = [
        {
          timestamp: "2024-01-01T10:00:00.000Z",
          modelId: "test-model",
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.001,
          operation: "test",
        },
      ];

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const exported = exportUsageData();

      expect(exported).toEqual(mockUsage);
    });

    it("should filter data by date range", () => {
      const mockUsage: UsageRecord[] = [
        {
          timestamp: "2024-01-01T10:00:00.000Z",
          modelId: "test-model",
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.001,
          operation: "test",
        },
        {
          timestamp: "2024-01-15T10:00:00.000Z",
          modelId: "test-model",
          inputTokens: 2000,
          outputTokens: 1000,
          estimatedCost: 0.002,
          operation: "test",
        },
        {
          timestamp: "2024-02-01T10:00:00.000Z",
          modelId: "test-model",
          inputTokens: 3000,
          outputTokens: 1500,
          estimatedCost: 0.003,
          operation: "test",
        },
      ];

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockUsage));

      const exported = exportUsageData("2024-01-01", "2024-01-31");

      expect(exported).toHaveLength(2);
      expect(exported[0].timestamp).toBe("2024-01-01T10:00:00.000Z");
      expect(exported[1].timestamp).toBe("2024-01-15T10:00:00.000Z");
    });
  });

  describe("loadCostLimits and saveCostLimits", () => {
    it("should load default limits when file does not exist", () => {
      mockedFs.existsSync.mockReturnValue(false);

      const limits = loadCostLimits();

      expect(limits.dailyLimitUSD).toBe(5.0);
      expect(limits.monthlyLimitUSD).toBe(50.0);
      expect(limits.isFreeTierAccount).toBe(true);
    });

    it("should load saved limits from file", () => {
      const customLimits: CostLimits = {
        dailyLimitUSD: 10.0,
        monthlyLimitUSD: 100.0,
        maxTokensPerRequest: 2000,
        maxRequestsPerDay: 100,
        maxRequestsPerHour: 20,
        isFreeTierAccount: false,
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(customLimits));

      const limits = loadCostLimits();

      expect(limits).toEqual(customLimits);
    });

    it("should save limits to file", () => {
      const customLimits: CostLimits = {
        dailyLimitUSD: 10.0,
        monthlyLimitUSD: 100.0,
        maxTokensPerRequest: 2000,
        maxRequestsPerDay: 100,
        maxRequestsPerHour: 20,
        isFreeTierAccount: false,
      };

      saveCostLimits(customLimits);

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        TEST_LIMITS_FILE,
        JSON.stringify(customLimits, null, 2),
        "utf-8"
      );
    });

    it("should handle file read errors gracefully", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("Read error");
      });

      const limits = loadCostLimits();

      // Should return default limits on error
      expect(limits.dailyLimitUSD).toBe(5.0);
      expect(limits.isFreeTierAccount).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle malformed JSON in usage file", () => {
      mockedFs.readFileSync.mockReturnValue("invalid json");

      expect(() => {
        getDailyUsage();
      }).not.toThrow();
    });

    it("should handle malformed JSON in limits file", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("invalid json");

      const limits = loadCostLimits();

      // Should return default limits
      expect(limits.dailyLimitUSD).toBe(5.0);
    });

    it("should handle very large token counts", () => {
      const cost = estimateCost(
        "anthropic.claude-3-haiku-20240307-v1:0",
        10000000, // 10M tokens
        10000000
      );

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(100); // Should be reasonable
    });

    it("should handle negative token counts", () => {
      const cost = estimateCost(
        "anthropic.claude-3-haiku-20240307-v1:0",
        -1000,
        -500
      );

      expect(cost).toBeLessThan(0);
    });
  });

  describe("Performance Tests", () => {
    it("should handle large number of usage records efficiently", () => {
      const largeUsageArray: UsageRecord[] = Array.from(
        { length: 10000 },
        (_, i) => ({
          timestamp: new Date(Date.now() - i * 1000).toISOString(),
          modelId: "anthropic.claude-3-haiku-20240307-v1:0",
          inputTokens: 100,
          outputTokens: 50,
          estimatedCost: 0.001,
          operation: "test",
        })
      );

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(largeUsageArray));

      const start = Date.now();
      const usage = getDailyUsage();
      const end = Date.now();

      expect(end - start).toBeLessThan(1000); // Should complete in under 1 second
      expect(usage.requestCount).toBeGreaterThan(0);
    });
  });
});
