/**
 * AI-Powered Ticket Analysis and Auto-Response System
 *
 * This module provides intelligent ticket analysis using AWS Bedrock Claude 3 Sonnet model.
 * Key features:
 * - Automatic ticket classification and priority assessment
 * - Intelligent response generation for common issues
 * - Confidence scoring to determine when auto-responses should be sent
 * - Knowledge base integration for contextual responses
 * - Escalation detection for complex issues
 */

import { storage } from "../../storage";
import { getAISettings } from "../../admin/aiSettings";
import { logSecurityEvent } from "../../security";
import { buildAutoResponsePrompt, buildTicketAnalysisPrompt } from "./prompts";
import {
  getBedrockClient,
  runTicketAnalysisPrompt,
  runAutoResponseForTicketPrompt,
} from "./bedrockIntegration";
import { extractJSON } from "./jsonUtils";
import { describeAIError, isQuotaBlocked } from "./aiErrors";

/**
 * Structure for AI ticket analysis results
 * Provides comprehensive assessment of ticket complexity, categorization, and recommendations
 */
export interface TicketAnalysis {
  complexity: "low" | "medium" | "high" | "critical";
  category:
    | "bug"
    | "feature"
    | "support"
    | "enhancement"
    | "incident"
    | "request";
  priority: "low" | "medium" | "high" | "urgent";
  estimatedResolutionTime: number; // in hours
  suggestedAssignee?: string;
  tags: string[];
  confidence: number; // 0-100
  reasoning: string;
}

/**
 * Structure for AI-generated automatic responses
 * Includes confidence scoring and escalation recommendations
 */
export interface AutoResponse {
  response: string;
  confidence: number;
  knowledgeBaseArticles: string[];
  followUpActions: string[];
  escalationNeeded: boolean;
}

/**
 * Core AI analysis function using Claude 3 Sonnet
 *
 * Analyzes ticket content to determine:
 * - Complexity level (low/medium/high/critical)
 * - Proper categorization and priority
 * - Estimated resolution time
 * - Suggested tags and assignee
 * - Confidence score for the analysis
 *
 * @param ticketData - Ticket information to analyze
 * @returns TicketAnalysis object or null if AI is unavailable
 */
export const analyzeTicket = async (ticketData: {
  title: string;
  description: string;
  category?: string;
  priority?: string;
  reporterId: string;
}): Promise<TicketAnalysis | null> => {
  const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();
  if (!bedrockClient || !modelId) {
    console.error("No Bedrock model configured for ticket analysis");
    return null;
  }

  try {
    const settings = await getAISettings();
    const timeoutMs =
      Math.max(5, Math.min(120, Number(settings.responseTimeout || 30))) * 1000;
    const abortController = new AbortController();
    const _timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    const prompt = buildTicketAnalysisPrompt(ticketData);

    const result = await runTicketAnalysisPrompt(prompt);

    // Extract JSON from response (handles markdown code blocks and explanatory text)
    const cleanedResponse = extractJSON(result.response);
    if (!cleanedResponse || cleanedResponse.trim().length === 0) {
      throw new Error("Empty response after JSON extraction");
    }

    const analysis = JSON.parse(cleanedResponse) as TicketAnalysis;

    // Store analysis in database
    await storage.saveTicketAnalysis(ticketData.reporterId, {
      ...analysis,
      timestamp: new Date(),
    });

    // Log AI usage for security audit
    logSecurityEvent({
      userId: ticketData.reporterId,
      action: "ai_analysis",
      resource: "ticket",
      success: true,
      details: {
        confidence: analysis.confidence,
        complexity: analysis.complexity,
      },
    });

    return analysis;
  } catch (error) {
    console.error("AI ticket analysis error:", describeAIError(error));
    logSecurityEvent({
      userId: ticketData.reporterId,
      action: "ai_analysis",
      resource: "ticket",
      success: false,
      details: {
        error: describeAIError(error),
      },
    });
    // A cost-limit block is not "no answer": the route turns it into 429.
    if (isQuotaBlocked(error)) throw error;
    return null;
  }
};

// Generate AI auto-response for ticket
export const generateAutoResponseForTicket = async (
  ticketData: {
    title: string;
    description: string;
    category: string;
    priority: string;
  },
  analysis: TicketAnalysis,
  knowledgeBaseContext?: string[]
): Promise<AutoResponse | null> => {
  const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();
  if (!bedrockClient || !modelId) {
    console.error("No Bedrock model configured for auto response");
    return null;
  }

  try {
    const settings = await getAISettings();
    const timeoutMs =
      Math.max(5, Math.min(120, Number(settings.responseTimeout || 30))) * 1000;
    const abortController = new AbortController();
    const _timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const knowledgeContext =
      knowledgeBaseContext && knowledgeBaseContext.length > 0
        ? knowledgeBaseContext.join("\n---\n")
        : "";

    const prompt = buildAutoResponsePrompt({
      title: ticketData.title,
      description: ticketData.description,
      category: ticketData.category,
      priority: ticketData.priority,
      analysis,
      knowledgeContext,
    });

    const result = await runAutoResponseForTicketPrompt(prompt);

    // Extract JSON from response (handles markdown code blocks and explanatory text)
    const cleanedResponse = extractJSON(result.response);
    if (!cleanedResponse || cleanedResponse.trim().length === 0) {
      throw new Error("Empty response after JSON extraction");
    }

    const autoResponse = JSON.parse(cleanedResponse) as AutoResponse;
    return autoResponse;
  } catch (error) {
    console.error("AI auto-response generation error:", describeAIError(error));
    if (isQuotaBlocked(error)) throw error;
    return null;
  }
};

// Calculate ticket complexity score
export const calculateComplexityScore = (analysis: TicketAnalysis): number => {
  let score = 0;

  // Base complexity scoring
  switch (analysis.complexity) {
    case "low":
      score += 10;
      break;
    case "medium":
      score += 30;
      break;
    case "high":
      score += 60;
      break;
    case "critical":
      score += 90;
      break;
  }

  // Priority adjustment
  switch (analysis.priority) {
    case "low":
      score += 5;
      break;
    case "medium":
      score += 15;
      break;
    case "high":
      score += 25;
      break;
    case "urgent":
      score += 40;
      break;
  }

  // Time estimation factor
  if (analysis.estimatedResolutionTime > 24) score += 20;
  else if (analysis.estimatedResolutionTime > 8) score += 10;

  // Confidence adjustment (lower confidence = higher complexity)
  if (analysis.confidence < 50) score += 15;
  else if (analysis.confidence < 70) score += 10;

  return Math.min(score, 100);
};

// Determine if ticket needs escalation
export const shouldEscalateTicket = (
  analysis: TicketAnalysis,
  autoResponse: AutoResponse
): boolean => {
  // Escalation criteria
  const criticalIssue = analysis.complexity === "critical";
  const urgentPriority = analysis.priority === "urgent";
  const lowConfidence =
    analysis.confidence < 50 || autoResponse.confidence < 50;
  const longResolution = analysis.estimatedResolutionTime > 48;
  const explicitEscalation = autoResponse.escalationNeeded;

  return (
    criticalIssue ||
    urgentPriority ||
    lowConfidence ||
    longResolution ||
    explicitEscalation
  );
};

// Update AI analytics
export const updateAIAnalytics = async (analysisResult: {
  analysis: TicketAnalysis | null;
  autoResponse: AutoResponse | null;
  applied: boolean;
}): Promise<void> => {
  try {
    const analytics = {
      timestamp: new Date(),
      analysisPerformed: !!analysisResult.analysis,
      responseGenerated: !!analysisResult.autoResponse,
      responseApplied: analysisResult.applied,
      confidence: analysisResult.analysis?.confidence || 0,
      complexity: analysisResult.analysis?.complexity || "unknown",
    };

    await storage.saveAIAnalytics(analytics);
  } catch (error) {
    console.error("AI analytics update error:", describeAIError(error));
  }
};
