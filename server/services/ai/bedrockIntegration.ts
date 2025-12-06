/**
 * AWS Bedrock Integration for Intelligent Ticket Handling
 *
 * This module provides integration with AWS Bedrock using Claude 3 Sonnet
 * for intelligent ticket analysis, response generation, and knowledge base management.
 * Includes comprehensive cost monitoring and request blocking for free-tier accounts.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { Task } from "@shared/schema";
import { storage } from "../../storage";
import {
  estimateCost,
  estimateTokens,
  recordUsage,
  shouldBlockRequest,
  loadCostLimits,
  CostEstimate,
} from "../../services/ai/costMonitoring";
import { PROMPT_TEMPLATES } from "./prompts";
import { getAISettings } from "server/admin/aiSettings";

export async function getBedrockClient(): Promise<{
  bedrockClient: BedrockRuntimeClient | null;
  bedrockModelId: string;
}> {
  const settings = await storage.getBedrockSettings();
  const bedrockAccessKeyId = settings?.bedrockAccessKeyId;
  const bedrockSecretAccessKey = settings?.bedrockSecretAccessKey;
  const bedrockRegion = settings?.bedrockRegion || "us-east-1";
  const bedrockModelId = settings?.bedrockModelId || "";

  if (!bedrockAccessKeyId || !bedrockSecretAccessKey || !bedrockRegion) {
    console.warn("AWS Bedrock credentials not configured");
    return { bedrockClient: null, bedrockModelId: "" };
  }

  const bedrockClient = new BedrockRuntimeClient({
    region: bedrockRegion,
    credentials: {
      accessKeyId: bedrockAccessKeyId,
      secretAccessKey: bedrockSecretAccessKey,
    },
  });

  return { bedrockClient, bedrockModelId };
}

async function invokeBedrockModel(
  prompt: string,
  operation: string = "general",
  maxTokens: number = 1000,
  temperature: number = 0.3,
  userId?: string,
  ticketId?: string
): Promise<{
  response: string;
  costEstimate: CostEstimate;
  actualTokens: { input: number; output: number };
}> {
  const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();
  if (!bedrockClient || !modelId) {
    throw new Error("No Bedrock model configured");
  }

  // Estimate tokens before making the request
  const estimatedInputTokens = estimateTokens(prompt);

  // Enforce per-request token budget (input + output)
  const limits = loadCostLimits();
  const budget = Number(limits.maxTokensPerRequest || 0);
  const allowedOutputFromBudget =
    budget > 0 ? Math.max(0, budget - estimatedInputTokens) : maxTokens;
  if (budget > 0 && allowedOutputFromBudget <= 0) {
    const error = new Error(
      `Request exceeds max tokens per request. Prompt uses ${estimatedInputTokens} tokens; limit is ${budget}.`
    );
    (error as any).isBlocked = true;
    (error as any).costEstimate = {
      inputTokens: estimatedInputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      modelId,
      operation,
    } as CostEstimate;
    throw error;
  }

  const effectiveMaxTokens = Math.max(
    1,
    Math.min(maxTokens, allowedOutputFromBudget)
  );
  const estimatedOutputTokens = Math.min(effectiveMaxTokens, 1000); // Conservative estimate

  // Check if request should be blocked
  const blockCheck = shouldBlockRequest(
    modelId,
    estimatedInputTokens,
    estimatedOutputTokens,
    operation
  );

  if (blockCheck.blocked) {
    const error = new Error(`Request blocked: ${blockCheck.reason}`);
    (error as any).isBlocked = true;
    (error as any).costEstimate = {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      estimatedCost: blockCheck.estimatedCost,
      modelId,
      operation,
    };
    throw error;
  }

  // Prepare request body based on model type
  let requestBody: any;

  if (modelId.startsWith("anthropic.claude")) {
    // Claude models use Anthropic format
    requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: effectiveMaxTokens,
      temperature,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };
  } else if (modelId.startsWith("amazon.titan")) {
    // Amazon Titan models use Titan format
    requestBody = {
      inputText: prompt,
      textGenerationConfig: {
        maxTokenCount: effectiveMaxTokens,
        temperature,
        topP: 0.9,
      },
    };
  } else if (modelId.startsWith("ai21.j2")) {
    // AI21 Jurassic models use AI21 format
    requestBody = {
      prompt: prompt,
      maxTokens: effectiveMaxTokens,
      temperature,
      topP: 0.9,
    };
  } else if (modelId.startsWith("meta.llama")) {
    // Meta Llama models use Llama format
    requestBody = {
      prompt: prompt,
      max_gen_len: effectiveMaxTokens,
      temperature,
      top_p: 0.9,
    };
  } else {
    // Fallback to Claude format for unknown models
    requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: effectiveMaxTokens,
      temperature,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };
  }

  const input = {
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody),
  };

  try {
    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Parse response based on model type
    let responseText: string;
    let actualInputTokens: number;
    let actualOutputTokens: number;

    if (modelId.startsWith("anthropic.claude")) {
      // Claude response format
      responseText = responseBody.content[0].text;
      actualInputTokens =
        responseBody.usage?.input_tokens || estimatedInputTokens;
      actualOutputTokens =
        responseBody.usage?.output_tokens || estimateTokens(responseText);
    } else if (modelId.startsWith("amazon.titan")) {
      // Amazon Titan response format
      responseText = responseBody.results[0].outputText;
      actualInputTokens = responseBody.inputTokenCount || estimatedInputTokens;
      actualOutputTokens =
        responseBody.outputTokenCount || estimateTokens(responseText);
    } else if (modelId.startsWith("ai21.j2")) {
      // AI21 Jurassic response format
      responseText = responseBody.completions[0].data.text;
      actualInputTokens =
        responseBody.prompt?.tokens?.length || estimatedInputTokens;
      actualOutputTokens =
        responseBody.completions[0].data.tokens?.length ||
        estimateTokens(responseText);
    } else if (modelId.startsWith("meta.llama")) {
      // Meta Llama response format
      responseText = responseBody.generation;
      actualInputTokens =
        responseBody.prompt_token_count || estimatedInputTokens;
      actualOutputTokens =
        responseBody.generation_token_count || estimateTokens(responseText);
    } else {
      // Fallback to Claude format
      responseText =
        responseBody.content?.[0]?.text ||
        responseBody.generation ||
        "No response";
      actualInputTokens =
        responseBody.usage?.input_tokens || estimatedInputTokens;
      actualOutputTokens =
        responseBody.usage?.output_tokens || estimateTokens(responseText);
    }

    // Record usage for billing analysis
    recordUsage(
      modelId,
      actualInputTokens,
      actualOutputTokens,
      operation,
      userId,
      ticketId
    );

    const costEstimate: CostEstimate = {
      inputTokens: actualInputTokens,
      outputTokens: actualOutputTokens,
      estimatedCost: estimateCost(
        modelId,
        actualInputTokens,
        actualOutputTokens
      ),
      modelId,
      operation,
    };

    return {
      response: responseText,
      costEstimate,
      actualTokens: {
        input: actualInputTokens,
        output: actualOutputTokens,
      },
    };
  } catch (error) {
    console.error("Error invoking Claude model:", error);
    throw error;
  }
}

/**
 * Analyze a ticket to categorize and extract key information
 */
export async function analyzeTicket(
  ticket: Task,
  userId?: string
): Promise<{
  keyIssues: string[];
  suggestedCategory: string;
  recommendedPriority: string;
  complexityScore: number;
  requiredExpertise: string[];
  estimatedHours: number;
  costEstimate?: CostEstimate;
}> {
  try {
    const prompt = PROMPT_TEMPLATES.analyzeTicket(ticket);
    const settings = await getAISettings();
    const cap = Math.min(settings.maxTokens, 500);
    const temperature = settings.temperature;
    const result = await invokeBedrockModel(
      prompt,
      "analyzeTicket",
      cap,
      temperature,
      userId,
      ticket.id?.toString()
    );

    // Parse JSON response
    const analysis = JSON.parse(result.response);

    // Validate response structure
    if (!analysis.keyIssues || !analysis.complexityScore) {
      throw new Error("Invalid analysis response format");
    }

    return {
      ...analysis,
      costEstimate: result.costEstimate,
    };
  } catch (error) {
    console.error("Error analyzing ticket:", error);

    // If request was blocked, re-throw with cost information
    if ((error as any).isBlocked) {
      throw error;
    }

    // Return default analysis on other errors
    return {
      keyIssues: ["Unable to analyze ticket"],
      suggestedCategory: ticket.category || "support",
      recommendedPriority: ticket.priority || "medium",
      complexityScore: 50,
      requiredExpertise: ["general"],
      estimatedHours: 4,
    };
  }
}

/**
 * Generate an intelligent response based on ticket and knowledge base
 */
export async function generateResponse(
  ticket: Task,
  knowledgeBaseArticles: any[],
  userId?: string
): Promise<{
  response: string;
  confidence: number;
  suggestedArticles: number[];
  costEstimate?: CostEstimate;
}> {
  try {
    // Format knowledge base content
    const knowledgeBase = knowledgeBaseArticles
      .map((article) => `- ${article.title}: ${article.summary}`)
      .join("\n");

    const prompt = PROMPT_TEMPLATES.generateResponse(ticket, knowledgeBase);
    const settings = await getAISettings();
    const cap = Math.min(settings.maxTokens, 800);
    const temperature = settings.temperature;
    const result = await invokeBedrockModel(
      prompt,
      "generateResponse",
      cap,
      temperature,
      userId,
      ticket.id?.toString()
    );

    // Calculate confidence based on knowledge base availability
    const confidence = knowledgeBaseArticles.length > 0 ? 0.8 : 0.5;

    return {
      response: result.response,
      confidence,
      suggestedArticles: knowledgeBaseArticles.map((a) => a.id),
      costEstimate: result.costEstimate,
    };
  } catch (error) {
    console.error("Error generating response:", error);

    // If request was blocked, re-throw with cost information
    if ((error as any).isBlocked) {
      throw error;
    }

    return {
      response:
        "I'm unable to generate an automated response at this time. A support agent will assist you shortly.",
      confidence: 0,
      suggestedArticles: [],
    };
  }
}

/**
 * Extract knowledge from resolved tickets to update knowledge base
 */
export async function updateKnowledgeBase(
  ticket: Task,
  resolution: string,
  userId?: string
): Promise<{
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  costEstimate?: CostEstimate;
}> {
  try {
    const prompt = PROMPT_TEMPLATES.extractKnowledge(ticket, resolution);
    const settings = await getAISettings();
    const cap = Math.min(settings.maxTokens, 600);
    const temperature = settings.temperature;

    const result = await invokeBedrockModel(
      prompt,
      "updateKnowledgeBase",
      cap,
      temperature,
      userId,
      ticket.id?.toString()
    );

    // Parse JSON response
    const knowledge = JSON.parse(result.response);

    // Validate response structure
    if (!knowledge.title || !knowledge.content) {
      throw new Error("Invalid knowledge extraction format");
    }

    return {
      title: knowledge.title,
      summary: knowledge.summary,
      content: knowledge.content,
      category: knowledge.category || ticket.category || "general",
      tags: knowledge.tags || [],
      costEstimate: result.costEstimate,
    };
  } catch (error) {
    console.error("Error extracting knowledge:", error);

    // If request was blocked, re-throw with cost information
    if ((error as any).isBlocked) {
      throw error;
    }

    throw error;
  }
}

/**
 * Calculate confidence score for AI response
 */
export async function calculateConfidence(
  ticket: Task,
  knowledgeBaseMatches: number,
  ticketComplexity: number
): Promise<{
  confidenceScore: number;
  shouldAutoRespond: boolean;
  reasoning: string;
}> {
  // Base confidence calculation
  let confidence = 0.5;

  // Adjust based on knowledge base matches
  if (knowledgeBaseMatches > 5) {
    confidence += 0.3;
  } else if (knowledgeBaseMatches > 2) {
    confidence += 0.2;
  } else if (knowledgeBaseMatches > 0) {
    confidence += 0.1;
  }

  // Adjust based on complexity
  if (ticketComplexity < 30) {
    confidence += 0.1;
  } else if (ticketComplexity > 70) {
    confidence -= 0.2;
  }

  // Adjust based on category
  const highConfidenceCategories = ["support", "feature"];
  const lowConfidenceCategories = ["bug", "incident"];

  if (highConfidenceCategories.includes(ticket.category || "")) {
    confidence += 0.1;
  } else if (lowConfidenceCategories.includes(ticket.category || "")) {
    confidence -= 0.1;
  }

  // Ensure confidence is between 0 and 1
  confidence = Math.max(0, Math.min(1, confidence));

  // Determine if should auto-respond (threshold: 0.7)
  const shouldAutoRespond = confidence >= 0.7;

  // Generate reasoning
  let reasoning = `Confidence: ${(confidence * 100).toFixed(1)}%. `;
  reasoning += `Based on ${knowledgeBaseMatches} knowledge base matches, `;
  reasoning += `complexity score of ${ticketComplexity}, `;
  reasoning += `and category '${ticket.category}'.`;

  if (shouldAutoRespond) {
    reasoning += " Recommending automated response.";
  } else {
    reasoning += " Recommending human review.";
  }

  return {
    confidenceScore: confidence,
    shouldAutoRespond,
    reasoning,
  };
}

/**
 * Test Bedrock connection with cost monitoring
 */
export async function testBedrockConnection(): Promise<{
  success: boolean;
  costEstimate?: CostEstimate;
  error?: string;
}> {
  try {
    const response = await getBedrockClient();

    if (!response?.bedrockModelId) {
      return {
        success: false,
        error: "No Bedrock model configured",
      };
    }

    const testPrompt =
      "Hello, this is a test. Please respond with 'Connection successful'.";

    const result = await invokeBedrockModel(
      testPrompt,
      "testConnection",
      50, // Very small response for testing
      undefined,
      "system"
    );

    return {
      success: result.response.includes("successful"),
      costEstimate: result.costEstimate,
    };
  } catch (error) {
    console.error("Bedrock connection test failed:", error);

    // If request was blocked, include cost information
    if ((error as any).isBlocked) {
      return {
        success: false,
        costEstimate: (error as any).costEstimate,
        error: `Connection test blocked: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get a lightweight Bedrock configuration snapshot for dashboards
 * - currentModelId: from bedrock_settings.bedrock_model_id (if configured)
 * - isFreeTierAccount: from cost-limits configuration
 */
export async function getBedrockConfigSummary(): Promise<{
  currentModelId: string | null;
  isFreeTierAccount: boolean;
}> {
  const [settings] = await Promise.all([
    storage.getBedrockSettings(),
    // Load limits to determine account type
  ]);

  const { loadCostLimits } = await import("../../services/ai/costMonitoring");
  const limits = loadCostLimits();

  return {
    currentModelId: settings?.bedrockRegion ? settings.bedrockModelId : null,
    isFreeTierAccount: !!limits.isFreeTierAccount,
  };
}

/**
 * Get cost statistics plus configuration for dashboard
 */
export async function getCostStatistics() {
  const { getCostStatistics } = await import(
    "../../services/ai/costMonitoring"
  );
  const stats = getCostStatistics();
  const config = await getBedrockConfigSummary();

  return {
    ...stats,
    config,
  };
}

/**
 * Update cost limits
 */
export async function updateCostLimits(
  limits: Partial<import("../../services/ai/costMonitoring").CostLimits>
) {
  const { loadCostLimits, saveCostLimits } = await import(
    "../../services/ai/costMonitoring"
  );
  const currentLimits = loadCostLimits();
  // Free-tier enforcement: cap values even if client attempts higher
  let merged = { ...currentLimits, ...limits };
  if (merged.isFreeTierAccount) {
    const CAP = {
      dailyUSD: 3,
      monthlyUSD: 25,
      tokensPerRequest: 3000,
      requestsPerDay: 1500,
      requestsPerHour: 300,
    };
    merged.dailyLimitUSD = Math.min(
      merged.dailyLimitUSD || CAP.dailyUSD,
      CAP.dailyUSD
    );
    merged.monthlyLimitUSD = Math.min(
      merged.monthlyLimitUSD || CAP.monthlyUSD,
      CAP.monthlyUSD
    );
    merged.maxTokensPerRequest = Math.min(
      merged.maxTokensPerRequest || CAP.tokensPerRequest,
      CAP.tokensPerRequest
    );
    merged.maxRequestsPerDay = Math.min(
      merged.maxRequestsPerDay || CAP.requestsPerDay,
      CAP.requestsPerDay
    );
    merged.maxRequestsPerHour = Math.min(
      merged.maxRequestsPerHour || CAP.requestsPerHour,
      CAP.requestsPerHour
    );
  }
  const updatedLimits = merged;
  saveCostLimits(updatedLimits);
  return updatedLimits;
}

/**
 * Reset usage data (for testing or manual reset)
 */
export async function resetUsageData() {
  const { resetUsageData } = await import("../../services/ai/costMonitoring");
  return resetUsageData();
}

/**
 * Export usage data for analysis
 */
export async function exportUsageData(startDate?: string, endDate?: string) {
  const { exportUsageData } = await import("../../services/ai/costMonitoring");
  return exportUsageData(startDate, endDate);
}

export async function runTicketAnalysisPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 1000);
  const temperature = settings.temperature;
  return invokeBedrockModel(prompt, "ticketAnalysis", cap, temperature);
}

export async function runAutoResponseForTicketPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 1500);
  const temperature = settings.temperature;
  return invokeBedrockModel(prompt, "autoResponse", cap, temperature);
}

export async function runKnowledgePatternPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 2000);
  const temperature = settings.temperature;
  return invokeBedrockModel(
    prompt,
    "knowledge_analyzeResolvedTickets",
    cap,
    temperature
  );
}

export async function runKnowledgeArticleGenerationPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 1500); // keep your existing per-feature limit
  const temperature = settings.temperature;
  return invokeBedrockModel(
    prompt,
    "knowledge_generateArticle",
    cap,
    temperature
  );
}

export async function runKnowledgePatternAnalysisPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 2000);
  const temperature = settings.temperature;
  return invokeBedrockModel(
    prompt,
    "knowledge_analyzeResolvedTickets",
    cap,
    temperature
  );
}

export async function runKnowledgeSearchPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 1500);
  const temperature = settings.temperature;
  return invokeBedrockModel(
    prompt,
    "knowledge_searchRanking",
    cap,
    temperature
  );
}

export async function runKnowledgeImproveArticlePrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 2000);
  const temperature = settings.temperature;
  return invokeBedrockModel(
    prompt,
    "knowledge_improveArticle",
    cap,
    temperature
  );
}

export async function runChatPrompt(
  systemMessage: string,
  userMessage: string,
  userId?: string
) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 1000);
  const temperature = settings.temperature;
  const prompt = `${systemMessage}\n\n${userMessage}`;
  return invokeBedrockModel(prompt, "chat", cap, temperature, userId);
}

// Export initialization function
export const bedrockIntegration = {
  getBedrockClient,
  analyzeTicket,
  generateResponse,
  updateKnowledgeBase,
  calculateConfidence,
  testConnection: testBedrockConnection,
  getCostStatistics,
  getBedrockConfigSummary,
  updateCostLimits,
  resetUsageData,
  exportUsageData,
  runTicketAnalysisPrompt,
  runAutoResponseForTicketPrompt,
  runKnowledgePatternPrompt,
  runKnowledgeArticleGenerationPrompt,
  runKnowledgePatternAnalysisPrompt,
  runKnowledgeSearchPrompt,
  runKnowledgeImproveArticlePrompt,
  runChatPrompt,
};
