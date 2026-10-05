/**
 * AI cost monitoring and usage tracking.
 *
 * This module tracks model usage and blocks requests that exceed configured limits.
 */

import { storage } from "../../storage";
import { AiModelError, describeAIError } from "./aiErrors";
import { createOpenRouterPricing, estimateCostUsd, type ModelPrice } from "./openRouterPricing";
import type { AISettings } from "@shared/interfaces";
import { db } from "../../storage/db";
import { aiUsage } from "@shared/schema";
import { and, eq } from "drizzle-orm";

const pricing = createOpenRouterPricing();

export interface UsageRecord {
  timestamp: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  verifiedCostUsd?: number;
  billingStatus?: string;
  requestedModelId?: string;
  generationId?: string;
  operation: string;
  userId?: string;
  ticketId?: string;
}

export interface DailyUsage {
  date: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalEstimatedCost: number;
  totalVerifiedCost: number;
  requestCount: number;
  operations: { [key: string]: number };
}

export interface CostLimits {
  dailyLimitUSD: number;
  monthlyLimitUSD: number;
  maxTokensPerRequest: number;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  modelId: string;
  operation: string;
}

// Default cost limits
const DEFAULT_COST_LIMITS: CostLimits = {
  dailyLimitUSD: 50.0,
  monthlyLimitUSD: 100.0,
  maxTokensPerRequest: 3000,
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
      verifiedCostUsd: r.verifiedCostUsd == null ? undefined : Number(r.verifiedCostUsd),
      billingStatus: r.billingStatus,
      requestedModelId: r.requestedModelId || undefined,
      generationId: r.generationId || undefined,
      operation: r.operation,
      userId: r.userId || undefined,
      ticketId: r.ticketId?.toString() || undefined,
    }));
  } catch (error) {
    console.error("Error loading usage records:", describeAIError(error));
    return [];
  }
}

/**
 * Load cost limits from database
 */
export async function loadCostLimits(): Promise<CostLimits> {
  try {
    const settings = await storage.getAISettings();
    if (!settings) {
      return DEFAULT_COST_LIMITS;
    }

    return {
      dailyLimitUSD: Number(settings.dailyLimitUsd ?? 50.0),
      monthlyLimitUSD: Number(settings.monthlyLimitUsd ?? 100.0),
      maxTokensPerRequest: settings.maxTokensPerRequest ?? 3000,
    };
  } catch (error) {
    console.error("Error loading cost limits:", describeAIError(error));
    return DEFAULT_COST_LIMITS;
  }
}

/**
 * Save cost limits to database
 */
export async function saveCostLimits(
  limits: CostLimits,
  userId: string = "system"
): Promise<void> {
  await storage.updateAISettings(
    {
      dailyLimitUsd: limits.dailyLimitUSD.toString(),
      monthlyLimitUsd: limits.monthlyLimitUSD.toString(),
      maxTokensPerRequest: limits.maxTokensPerRequest,
    },
    userId
  );
}

export function assertBudgetAvailable(input: {
  promptTokens: number;
  maxOutputTokens: number;
  price?: ModelPrice | null;
  settings: AISettings;
  todayUsd: number;
  monthUsd: number;
}): void {
  if (!input.price) throw new AiModelError("price_unavailable");
  const projectedTokens = input.promptTokens + input.maxOutputTokens;
  const projectedUsd = estimateCostUsd(input.promptTokens, input.maxOutputTokens, input.price);
  const blocked = (message: string) => {
    const error = new Error(message);
    (error as any).isBlocked = true;
    (error as any).costEstimate = { inputTokens: input.promptTokens, outputTokens: input.maxOutputTokens, estimatedCost: projectedUsd };
    throw error;
  };
  if (!Number.isSafeInteger(input.promptTokens) || !Number.isSafeInteger(input.maxOutputTokens) || input.promptTokens < 0 || input.maxOutputTokens <= 0 || projectedTokens > input.settings.maxTokensPerRequest) blocked("Request exceeds max tokens per request");
  if (input.todayUsd + projectedUsd > input.settings.dailyLimitUsd) blocked("Daily cost limit exceeded");
  if (input.monthUsd + projectedUsd > input.settings.monthlyLimitUsd) blocked("Monthly cost limit exceeded");
}

/**
 * Estimate tokens in a text string (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  // This can undercount other languages and model tokenizers; actual usage is recorded after the call.
  return Math.ceil(text.length / 4);
}

/** Conservatively estimate multilingual prompt tokens for budget preflight. */
export function estimatePromptTokensForBudget(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 2) + 16;
}

/**
 * Postgres 23503 on the ticket_id foreign key only (the driver error arrives bare or
 * wrapped with a `cause`). A violation of any other constraint (user_id, ...) is not
 * fixed by dropping the ticket link and must take the error path.
 */
export function isTicketForeignKeyViolation(error: unknown): boolean {
  let e: any = error;
  for (let depth = 0; e && depth < 3; depth++, e = e.cause) {
    if (e.code === "23503") {
      return typeof e.constraint === "string" && /ticket_id/.test(e.constraint);
    }
  }
  return false;
}

/**
 * Record usage for billing analysis
 */
export async function recordUsage(
  usage: {
    modelId: string; inputTokens: number; outputTokens: number; operation: string;
    requestedModelId?: string; generationId?: string; estimatedCost: number;
    verifiedCostUsd?: number; billingStatus?: "estimated" | "verified";
    userId?: string; ticketId?: string;
  }
): Promise<void> {
  const cost = usage.estimatedCost;

  try {
    // Validate userId - if it's "system" or empty, set to null to avoid foreign key constraint violation
    // The user_id column is nullable, so null is valid for system operations
    const validUserId =
      usage.userId && usage.userId !== "system" && usage.userId.trim() !== "" ? usage.userId : null;

    const row = {
      timestamp: new Date(),
      modelId: usage.modelId,
      requestedModelId: usage.requestedModelId || null,
      generationId: usage.generationId || null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: cost.toString(),
      verifiedCostUsd: usage.verifiedCostUsd == null ? null : usage.verifiedCostUsd.toString(),
      billingStatus: usage.billingStatus ?? "estimated",
      operation: usage.operation,
      userId: validUserId,
      ticketId: usage.ticketId ? parseInt(usage.ticketId) : null,
    };
    try {
      await storage.recordAIUsage(row);
    } catch (insertError) {
      // The ticket was deleted while the AI job ran. The money was still spent:
      // keep the cost row, just without the ticket link.
      if (row.ticketId !== null && isTicketForeignKeyViolation(insertError)) {
        await storage.recordAIUsage({ ...row, ticketId: null });
      } else {
        throw insertError;
      }
    }

    // Log usage for monitoring
    console.log(
      `[AI_USAGE] ${usage.operation}: ${usage.inputTokens} input + ${usage.outputTokens} output tokens = $${cost.toFixed(
        4
      )}`
    );
  } catch (error) {
    console.error("Error recording usage:", describeAIError(error));
    throw error;
  }
}

/**
 * Get daily usage summary
 */
export async function getDailyUsage(date?: string): Promise<DailyUsage> {
  const targetDate = date || new Date().toISOString().split("T")[0];
  // `targetDate` is a UTC calendar date ("2026-10-03" parses as UTC midnight), so the day's
  // bounds are UTC too. setHours (local) put the window on the PREVIOUS local day on any host
  // west of UTC, so today's usage read as 0 and the daily cap never counted it.
  const startDate = new Date(targetDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(targetDate);
  endDate.setUTCHours(23, 59, 59, 999);

  const records = await storage.getAIUsage({
    startDate,
    endDate,
  });

  const summary: DailyUsage = {
    date: targetDate,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    totalEstimatedCost: 0,
    totalVerifiedCost: 0,
    requestCount: records.length,
    operations: {},
  };

  records.forEach((record) => {
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;
    summary.totalEstimatedCost += Number(record.estimatedCost);
    if (record.billingStatus === "verified" && record.verifiedCostUsd != null) summary.totalVerifiedCost += Number(record.verifiedCostUsd);
    summary.totalCost += record.billingStatus === "verified" && record.verifiedCostUsd != null ? Number(record.verifiedCostUsd) : Number(record.estimatedCost);
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
  const targetYear = year || now.getUTCFullYear();
  const targetMonth = month || now.getUTCMonth() + 1;

  const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
  const endDate = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));

  const records = await storage.getAIUsage({
    startDate,
    endDate,
  });

  const summary: DailyUsage = {
    date: `${targetYear}-${targetMonth.toString().padStart(2, "0")}`,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    totalEstimatedCost: 0,
    totalVerifiedCost: 0,
    requestCount: records.length,
    operations: {},
  };

  records.forEach((record) => {
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;
    summary.totalEstimatedCost += Number(record.estimatedCost);
    if (record.billingStatus === "verified" && record.verifiedCostUsd != null) summary.totalVerifiedCost += Number(record.verifiedCostUsd);
    summary.totalCost += record.billingStatus === "verified" && record.verifiedCostUsd != null ? Number(record.verifiedCostUsd) : Number(record.estimatedCost);
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
  _operation: string
): Promise<{ blocked: boolean; reason?: string; estimatedCost: number }> {
  const limits = await loadCostLimits();
  const price = await pricing.getModelPrice(modelId);
  if (!price) throw new AiModelError("price_unavailable");
  const estimatedCost = estimateCostUsd(estimatedInputTokens, estimatedOutputTokens, price);

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

  return { blocked: false, estimatedCost };
}

/** Reconcile only rows still estimated; repeated polls leave the first verified value intact. */
export async function reconcileGenerationCost(generationId: string): Promise<boolean> {
  const billed = await pricing.getGenerationCost(generationId);
  if (!billed) return false;
  const changed = await db.update(aiUsage).set({
    verifiedCostUsd: billed.totalCostUsd.toString(),
    billingStatus: "verified",
    ...(billed.actualModel ? { modelId: billed.actualModel } : {}),
  }).where(and(eq(aiUsage.generationId, generationId), eq(aiUsage.billingStatus, "estimated"))).returning({ id: aiUsage.id });
  return changed.length > 0;
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
  // Generation billing can arrive after the completion response. Revisit pending
  // rows when the dashboard is read; the conditional update is safe to repeat.
  const pending = (await loadUsageRecords()).filter((record) => record.generationId && record.billingStatus !== "verified").slice(0, 10);
  await Promise.all(pending.map((record) => reconcileGenerationCost(record.generationId!)));
  const [dailyUsage, monthlyUsage, limits, allUsage] = await Promise.all([
    getDailyUsage(),
    getMonthlyUsage(),
    loadCostLimits(),
    loadUsageRecords(),
  ]);

  const recentUsage = allUsage.slice(0, 10); // Storage returns newest first.

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
    console.error("Error resetting usage data:", describeAIError(error));
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
    verifiedCostUsd: r.verifiedCostUsd == null ? undefined : Number(r.verifiedCostUsd),
    billingStatus: r.billingStatus,
    requestedModelId: r.requestedModelId || undefined,
    generationId: r.generationId || undefined,
    operation: r.operation,
    userId: r.userId || undefined,
    ticketId: r.ticketId?.toString() || undefined,
  }));
}
