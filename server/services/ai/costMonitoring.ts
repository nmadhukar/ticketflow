/**
 * AWS Bedrock Cost Monitoring and Usage Tracking
 *
 * This module provides comprehensive cost monitoring, usage tracking, and request blocking
 * for AWS Bedrock to prevent unexpected charges on free-tier accounts.
 */

import { storage } from "../../storage";

// AWS Bedrock pricing per 1M tokens (as of 2024)
const BEDROCK_PRICING = {
  // Amazon Titan Models (Globally Available)
  "amazon.titan-text-express-v1": {
    inputTokens: 0.8, // $0.80 per 1M input tokens
    outputTokens: 3.2, // $3.20 per 1M output tokens
  },
  "amazon.titan-text-lite-v1": {
    inputTokens: 0.3, // $0.30 per 1M input tokens
    outputTokens: 1.2, // $1.20 per 1M output tokens
  },
  "amazon.titan-embed-text-v1": {
    inputTokens: 0.1, // $0.10 per 1M input tokens
    outputTokens: 0.1, // $0.10 per 1M output tokens
  },
  // AI21 Jurassic Models (Globally Available)
  "ai21.j2-mid-v1": {
    inputTokens: 1.25, // $1.25 per 1M input tokens
    outputTokens: 1.25, // $1.25 per 1M output tokens
  },
  "ai21.j2-ultra-v1": {
    inputTokens: 3.75, // $3.75 per 1M input tokens
    outputTokens: 3.75, // $3.75 per 1M output tokens
  },
  // Meta Llama Models (Globally Available)
  "meta.llama2-13b-chat-v1": {
    inputTokens: 0.75, // $0.75 per 1M input tokens
    outputTokens: 0.75, // $0.75 per 1M output tokens
  },
  "meta.llama2-70b-chat-v1": {
    inputTokens: 2.65, // $2.65 per 1M input tokens
    outputTokens: 2.65, // $2.65 per 1M output tokens
  },
  "meta.llama3-8b-instruct-v1:0": {
    inputTokens: 0.6, // $0.60 per 1M input tokens
    outputTokens: 0.6, // $0.60 per 1M output tokens
  },
  "meta.llama3-70b-instruct-v1:0": {
    inputTokens: 2.65, // $2.65 per 1M input tokens
    outputTokens: 2.65, // $2.65 per 1M output tokens
  },
  // Anthropic Claude Models (Limited Regions)
  "anthropic.claude-3-haiku-20240307-v1:0": {
    inputTokens: 0.25, // $0.25 per 1M input tokens
    outputTokens: 1.25, // $1.25 per 1M output tokens
  },
  "anthropic.claude-3-sonnet-20240229-v1:0": {
    inputTokens: 3.0, // $3.00 per 1M input tokens
    outputTokens: 15.0, // $15.00 per 1M output tokens
  },
  "anthropic.claude-3-opus-20240229-v1:0": {
    inputTokens: 15.0, // $15.00 per 1M input tokens
    outputTokens: 75.0, // $75.00 per 1M output tokens
  },
};

export interface UsageRecord {
  timestamp: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  operation: string;
  userId?: string;
  ticketId?: string;
}

export interface DailyUsage {
  date: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  requestCount: number;
  operations: { [key: string]: number };
}

export interface CostLimits {
  dailyLimitUSD: number;
  monthlyLimitUSD: number;
  maxTokensPerRequest: number;
  maxRequestsPerDay: number;
  maxRequestsPerHour: number;
  isFreeTierAccount: boolean;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  modelId: string;
  operation: string;
}

// Default cost limits for free-tier accounts
const DEFAULT_FREE_TIER_LIMITS: CostLimits = {
  dailyLimitUSD: 5.0,
  monthlyLimitUSD: 50.0,
  maxTokensPerRequest: 1000,
  maxRequestsPerDay: 50,
  maxRequestsPerHour: 10,
  isFreeTierAccount: true,
};

// Default cost limits for paid accounts
const DEFAULT_PAID_LIMITS: CostLimits = {
  dailyLimitUSD: 100.0,
  monthlyLimitUSD: 1000.0,
  maxTokensPerRequest: 4000,
  maxRequestsPerDay: 1000,
  maxRequestsPerHour: 100,
  isFreeTierAccount: false,
};

/**
 * Load usage records from database
 */
async function loadUsageRecords(): Promise<UsageRecord[]> {
  try {
    const records = await storage.getAIUsage();
    return records.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      modelId: r.modelId,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      estimatedCost: Number(r.estimatedCost),
      operation: r.operation,
      userId: r.userId || undefined,
      ticketId: r.ticketId?.toString() || undefined,
    }));
  } catch (error) {
    console.error("Error loading usage records:", error);
    return [];
  }
}

/**
 * Load cost limits from database
 */
export async function loadCostLimits(): Promise<CostLimits> {
  try {
    const settings = await storage.getBedrockSettings();
    if (!settings) {
      return DEFAULT_FREE_TIER_LIMITS;
    }

    return {
      dailyLimitUSD: Number(settings.dailyLimitUsd || 50.0),
      monthlyLimitUSD: Number(settings.monthlyLimitUsd || 100.0),
      maxTokensPerRequest: settings.maxTokensPerRequest || 3000,
      maxRequestsPerDay: settings.maxRequestsPerDay || 5000,
      maxRequestsPerHour: settings.maxRequestsPerHour || 200,
      isFreeTierAccount: settings.isFreeTierAccount || false,
    };
  } catch (error) {
    console.error("Error loading cost limits:", error);
    return DEFAULT_FREE_TIER_LIMITS;
  }
}

/**
 * Save cost limits to database
 */
export async function saveCostLimits(
  limits: CostLimits,
  userId: string = "system"
): Promise<void> {
  try {
    const settings = await storage.getBedrockSettings();
    if (settings) {
      await storage.updateBedrockSettings(
        {
          dailyLimitUsd: limits.dailyLimitUSD.toString(),
          monthlyLimitUsd: limits.monthlyLimitUSD.toString(),
          maxTokensPerRequest: limits.maxTokensPerRequest,
          maxRequestsPerDay: limits.maxRequestsPerDay,
          maxRequestsPerHour: limits.maxRequestsPerHour,
          isFreeTierAccount: limits.isFreeTierAccount,
        },
        userId
      );
    }
  } catch (error) {
    console.error("Error saving cost limits:", error);
  }
}

/**
 * Estimate cost for a request based on model and token counts
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = BEDROCK_PRICING[modelId as keyof typeof BEDROCK_PRICING];
  if (!pricing) {
    console.warn(
      `Unknown model pricing for ${modelId}, using Titan Express pricing`
    );
    const titanPricing = BEDROCK_PRICING["amazon.titan-text-express-v1"];
    return (
      (inputTokens / 1000000) * titanPricing.inputTokens +
      (outputTokens / 1000000) * titanPricing.outputTokens
    );
  }

  const inputCost = (inputTokens / 1000000) * pricing.inputTokens;
  const outputCost = (outputTokens / 1000000) * pricing.outputTokens;

  return inputCost + outputCost;
}

/**
 * Estimate tokens in a text string (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  // This is conservative and may vary by model
  return Math.ceil(text.length / 4);
}

/**
 * Record usage for billing analysis
 */
export async function recordUsage(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  operation: string,
  userId?: string,
  ticketId?: string
): Promise<void> {
  const cost = estimateCost(modelId, inputTokens, outputTokens);

  try {
    // Validate userId - if it's "system" or empty, set to null to avoid foreign key constraint violation
    // The user_id column is nullable, so null is valid for system operations
    const validUserId =
      userId && userId !== "system" && userId.trim() !== "" ? userId : null;

    await storage.recordAIUsage({
      timestamp: new Date(),
      modelId,
      inputTokens,
      outputTokens,
      estimatedCost: cost.toString(),
      operation,
      userId: validUserId,
      ticketId: ticketId ? parseInt(ticketId) : null,
    });

    // Log usage for monitoring
    console.log(
      `[BEDROCK_USAGE] ${operation}: ${inputTokens} input + ${outputTokens} output tokens = $${cost.toFixed(
        4
      )}`
    );
  } catch (error) {
    console.error("Error recording usage:", error);
  }
}

/**
 * Get daily usage summary
 */
export async function getDailyUsage(date?: string): Promise<DailyUsage> {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const startDate = new Date(targetDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(targetDate);
  endDate.setHours(23, 59, 59, 999);

  const records = await storage.getAIUsage({
    startDate,
    endDate,
  });

  const summary: DailyUsage = {
    date: targetDate,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    requestCount: records.length,
    operations: {},
  };

  records.forEach((record) => {
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;
    summary.totalCost += Number(record.estimatedCost);
    summary.operations[record.operation] =
      (summary.operations[record.operation] || 0) + 1;
  });

  return summary;
}

/**
 * Get monthly usage summary
 */
export async function getMonthlyUsage(
  year?: number,
  month?: number
): Promise<DailyUsage> {
  const now = new Date();
  const targetYear = year || now.getFullYear();
  const targetMonth = month || now.getMonth() + 1;

  const startDate = new Date(targetYear, targetMonth - 1, 1);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(targetYear, targetMonth, 0);
  endDate.setHours(23, 59, 59, 999);

  const records = await storage.getAIUsage({
    startDate,
    endDate,
  });

  const summary: DailyUsage = {
    date: `${targetYear}-${targetMonth.toString().padStart(2, "0")}`,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    requestCount: records.length,
    operations: {},
  };

  records.forEach((record) => {
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;
    summary.totalCost += Number(record.estimatedCost);
    summary.operations[record.operation] =
      (summary.operations[record.operation] || 0) + 1;
  });

  return summary;
}

/**
 * Check if request should be blocked based on cost limits
 */
export async function shouldBlockRequest(
  modelId: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
  operation: string
): Promise<{ blocked: boolean; reason?: string; estimatedCost: number }> {
  const limits = await loadCostLimits();
  const estimatedCost = estimateCost(
    modelId,
    estimatedInputTokens,
    estimatedOutputTokens
  );

  // Check daily cost limit
  const dailyUsage = await getDailyUsage();
  if (dailyUsage.totalCost + estimatedCost > limits.dailyLimitUSD) {
    return {
      blocked: true,
      reason: `Daily cost limit exceeded. Current: $${dailyUsage.totalCost.toFixed(
        2
      )}, Request: $${estimatedCost.toFixed(2)}, Limit: $${
        limits.dailyLimitUSD
      }`,
      estimatedCost,
    };
  }

  // Check monthly cost limit
  const monthlyUsage = await getMonthlyUsage();
  if (monthlyUsage.totalCost + estimatedCost > limits.monthlyLimitUSD) {
    return {
      blocked: true,
      reason: `Monthly cost limit exceeded. Current: $${monthlyUsage.totalCost.toFixed(
        2
      )}, Request: $${estimatedCost.toFixed(2)}, Limit: $${
        limits.monthlyLimitUSD
      }`,
      estimatedCost,
    };
  }

  // Check max tokens per request
  const totalTokens = estimatedInputTokens + estimatedOutputTokens;
  if (totalTokens > limits.maxTokensPerRequest) {
    return {
      blocked: true,
      reason: `Request exceeds max tokens per request. Request: ${totalTokens}, Limit: ${limits.maxTokensPerRequest}`,
      estimatedCost,
    };
  }

  // Check daily request limit
  if (dailyUsage.requestCount >= limits.maxRequestsPerDay) {
    return {
      blocked: true,
      reason: `Daily request limit exceeded. Current: ${dailyUsage.requestCount}, Limit: ${limits.maxRequestsPerDay}`,
      estimatedCost,
    };
  }

  // Check hourly request limit
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const hourlyRecords = await storage.getAIUsage({
    startDate: oneHourAgo,
  });

  if (hourlyRecords.length >= limits.maxRequestsPerHour) {
    return {
      blocked: true,
      reason: `Hourly request limit exceeded. Current: ${hourlyRecords.length}, Limit: ${limits.maxRequestsPerHour}`,
      estimatedCost,
    };
  }

  return { blocked: false, estimatedCost };
}

/**
 * Get cost statistics for dashboard
 */
export async function getCostStatistics(): Promise<{
  dailyUsage: DailyUsage;
  monthlyUsage: DailyUsage;
  limits: CostLimits;
  recentUsage: UsageRecord[];
}> {
  const [dailyUsage, monthlyUsage, limits, allUsage] = await Promise.all([
    getDailyUsage(),
    getMonthlyUsage(),
    loadCostLimits(),
    loadUsageRecords(),
  ]);

  const recentUsage = allUsage.slice(-10); // Last 10 requests

  return {
    dailyUsage,
    monthlyUsage,
    limits,
    recentUsage,
  };
}

/**
 * Reset usage data (for testing or manual reset)
 */
export async function resetUsageData(): Promise<void> {
  try {
    await storage.deleteAIUsage();
    console.log("Usage data reset successfully");
  } catch (error) {
    console.error("Error resetting usage data:", error);
  }
}

/**
 * Export usage data for external analysis
 */
export async function exportUsageData(
  startDate?: string,
  endDate?: string
): Promise<UsageRecord[]> {
  const filters: {
    startDate?: Date;
    endDate?: Date;
  } = {};

  if (startDate) {
    filters.startDate = new Date(startDate);
  }
  if (endDate) {
    filters.endDate = new Date(endDate);
  }

  const records = await storage.getAIUsage(filters);

  return records.map((r) => ({
    timestamp: r.timestamp.toISOString(),
    modelId: r.modelId,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    estimatedCost: Number(r.estimatedCost),
    operation: r.operation,
    userId: r.userId || undefined,
    ticketId: r.ticketId?.toString() || undefined,
  }));
}
