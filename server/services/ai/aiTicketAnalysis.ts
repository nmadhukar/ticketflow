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
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    const prompt = buildTicketAnalysisPrompt(ticketData);

    const result = await runTicketAnalysisPrompt(prompt);

    const analysis = JSON.parse(result.response) as TicketAnalysis;

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
    console.error("AI ticket analysis error:", error);
    logSecurityEvent({
      userId: ticketData.reporterId,
      action: "ai_analysis",
      resource: "ticket",
      success: false,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
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
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

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
    const autoResponse = JSON.parse(result.response) as AutoResponse;
    return autoResponse;
  } catch (error) {
    console.error("AI auto-response generation error:", error);
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

// Process ticket with AI analysis and auto-response
export const processTicketWithAI = async (ticketData: {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: string;
  reporterId: string;
}): Promise<{
  analysis: TicketAnalysis | null;
  autoResponse: AutoResponse | null;
  complexityScore: number;
  shouldEscalate: boolean;
  applied: boolean;
}> => {
  try {
    const settings = await getAISettings();
    // Step 1: Analyze the ticket
    const analysis = await analyzeTicket(ticketData);
    if (!analysis) {
      return {
        analysis: null,
        autoResponse: null,
        complexityScore: 0,
        shouldEscalate: false,
        applied: false,
      };
    }

    // Step 2: Search knowledge base for relevant articles
    const knowledgeContext = await searchKnowledgeBaseForTicket(ticketData);

    // Step 3: Generate auto-response
    const autoResponse = await generateAutoResponseForTicket(
      ticketData,
      analysis,
      knowledgeContext
    );
    if (!autoResponse) {
      return {
        analysis,
        autoResponse: null,
        complexityScore: calculateComplexityScore(analysis),
        shouldEscalate: shouldEscalateTicket(analysis, {
          confidence: 0,
          escalationNeeded: true,
        } as AutoResponse),
        applied: false,
      };
    }

    // Step 4: Calculate metrics
    const complexityScore = calculateComplexityScore(analysis);
    const shouldEscalateHeuristic = shouldEscalateTicket(
      analysis,
      autoResponse
    );

    // Step 5: Apply auto-response if confidence is high enough
    const autoResponseEnabled = !!settings.autoResponseEnabled;
    const confidenceThreshold = Math.round(
      Math.max(0, Math.min(1, Number(settings.confidenceThreshold ?? 0.7))) *
        100
    );
    const maxResponseLength = Math.max(
      100,
      Math.min(5000, Number(settings.maxResponseLength || 1000))
    );
    let applied = false;

    if (
      autoResponseEnabled &&
      autoResponse.confidence >= confidenceThreshold &&
      !shouldEscalateHeuristic
    ) {
      const trimmed = (autoResponse.response || "").slice(0, maxResponseLength);
      // Add auto-response as a comment
      await storage.addTaskComment({
        taskId: ticketData.id,
        userId: "ai-assistant",
        content: trimmed,
      });

      // Store auto-response record
      await storage.saveAutoResponse({
        ticketId: ticketData.id,
        response: trimmed,
        confidence: autoResponse.confidence,
        applied: true,
        createdAt: new Date(),
      });

      applied = true;
    }

    // Escalation via settings
    let shouldEscalate = shouldEscalateHeuristic;
    if (settings.escalationEnabled) {
      const meetsThreshold =
        complexityScore >=
        Math.max(0, Math.min(100, Number(settings.complexityThreshold || 70)));
      const modelRequestedEscalation = !!autoResponse.escalationNeeded;
      shouldEscalate = meetsThreshold || modelRequestedEscalation || !applied;

      if (shouldEscalate && settings.escalationTeamId) {
        try {
          await storage.updateTask(
            ticketData.id,
            {
              assigneeType: "team" as any,
              assigneeTeamId: settings.escalationTeamId as any,
              assigneeId: null as any,
            },
            "ai-assistant"
          );
        } catch (e) {
          console.error("Failed to assign escalation team:", e);
        }
      }
    }

    // Store complexity score
    await storage.saveComplexityScore({
      ticketId: ticketData.id,
      score: complexityScore,
      factors: {
        complexity: analysis.complexity,
        priority: analysis.priority,
        estimatedTime: analysis.estimatedResolutionTime,
        confidence: analysis.confidence,
      },
      createdAt: new Date(),
    });

    return {
      analysis,
      autoResponse,
      complexityScore,
      shouldEscalate,
      applied,
    };
  } catch (error) {
    console.error("AI ticket processing error:", error);
    return {
      analysis: null,
      autoResponse: null,
      complexityScore: 0,
      shouldEscalate: true,
      applied: false,
    };
  }
};

// Search knowledge base for relevant articles
const searchKnowledgeBaseForTicket = async (ticketData: {
  title: string;
  description: string;
  category: string;
}): Promise<string[]> => {
  try {
    // Simple keyword-based search for now
    const searchTerms = [
      ...ticketData.title.toLowerCase().split(" "),
      ...ticketData.description.toLowerCase().split(" "),
      ticketData.category.toLowerCase(),
    ].filter((term) => term.length > 3);

    const articles = await storage.searchKnowledgeBase(searchTerms.join(" "));
    return articles
      .slice(0, 3)
      .map(
        (article: any) =>
          `${article.title}: ${article.content.substring(0, 500)}`
      );
  } catch (error) {
    console.error("Knowledge base search error:", error);
    return [];
  }
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
    console.error("AI analytics update error:", error);
  }
};
