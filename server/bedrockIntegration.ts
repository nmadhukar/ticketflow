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
import { storage } from "./storage";
import {
  estimateCost,
  estimateTokens,
  recordUsage,
  shouldBlockRequest,
  loadCostLimits,
  CostEstimate,
} from "./costMonitoring";

// Bedrock model configuration - prioritize cheaper models for cost control
const DEFAULT_MODEL_ID = "amazon.titan-text-express-v1"; // Globally available, cost-effective option
const CLAUDE_3_SONNET_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0";
const CLAUDE_3_OPUS_MODEL_ID = "anthropic.claude-3-opus-20240229-v1:0";

// Initialize Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Initialize AWS Bedrock client with credentials
 */
export async function initializeBedrockClient() {
  const { bedrockAccessKeyId, bedrockSecretAccessKey, bedrockRegion } =
    await getBedrockConfig();

  if (!bedrockAccessKeyId || !bedrockSecretAccessKey || !bedrockRegion) {
    console.warn("AWS Bedrock credentials not configured");
    return null;
  }

  bedrockClient = new BedrockRuntimeClient({
    region: bedrockRegion,
    credentials: {
      accessKeyId: bedrockAccessKeyId,
      secretAccessKey: bedrockSecretAccessKey,
    },
  });

  return bedrockClient;
}

/**
 * Get Bedrock configuration from environment or database
 */
async function getBedrockConfig() {
  try {
    const settings = await storage.getBedrockSettings();
    if (settings) {
      return {
        bedrockAccessKeyId: settings.bedrockAccessKeyId,
        bedrockSecretAccessKey: settings.bedrockSecretAccessKey,
        bedrockRegion: settings.bedrockRegion || "us-east-1",
      };
    }
  } catch (error) {
    console.error("Error fetching Bedrock config from database:", error);
  }

  // Fallback to environment variables
  return {
    bedrockAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    bedrockSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bedrockRegion: process.env.AWS_REGION || "us-east-1",
  };
}

/**
 * Prompt templates for different ticket operations
 */
const PROMPT_TEMPLATES = {
  analyzeTicket: (ticket: Task) => `
You are an expert IT support analyst. Analyze the following ticket and provide structured information.

Ticket Information:
Title: ${ticket.title}
Description: ${ticket.description || "No description provided"}
Current Status: ${ticket.status}
Priority: ${ticket.priority}
Category: ${ticket.category}

Please analyze this ticket and provide:
1. Key issues identified (list main problems)
2. Suggested category (bug, feature, support, enhancement, incident, or request)
3. Recommended priority (low, medium, high, or urgent)
4. Complexity assessment (1-100 scale where 100 is most complex)
5. Required expertise areas (list technical skills needed)
6. Estimated resolution time (in hours)

Format your response as JSON with these exact keys:
{
  "keyIssues": ["issue1", "issue2"],
  "suggestedCategory": "category",
  "recommendedPriority": "priority",
  "complexityScore": 50,
  "requiredExpertise": ["skill1", "skill2"],
  "estimatedHours": 4
}
`,

  generateResponse: (ticket: Task, knowledgeBase: string) => `
You are a helpful IT support assistant. Generate a response for the following ticket based on available knowledge.

Ticket Information:
Title: ${ticket.title}
Description: ${ticket.description || "No description provided"}
Category: ${ticket.category}

Relevant Knowledge Base Articles:
${knowledgeBase || "No relevant articles found"}

Please generate a helpful response that:
1. Acknowledges the user's issue
2. Provides clear, actionable steps if possible
3. References relevant knowledge base articles if available
4. Maintains a professional and friendly tone
5. Suggests next steps or escalation if needed

Keep the response concise but thorough. Do not exceed 500 words.
`,

  extractKnowledge: (ticket: Task, resolution: string) => `
You are a knowledge management expert. Extract reusable knowledge from this resolved ticket.

Ticket Information:
Title: ${ticket.title}
Description: ${ticket.description || "No description provided"}
Category: ${ticket.category}

Resolution:
${resolution}

Please extract knowledge that can help resolve similar issues in the future:
1. Problem summary (one sentence)
2. Root cause (if identifiable)
3. Solution steps (numbered list)
4. Prevention tips (if applicable)
5. Related keywords for search

Format your response as JSON:
{
  "title": "Brief descriptive title",
  "summary": "One sentence problem summary",
  "content": "Detailed solution with numbered steps",
  "category": "${ticket.category}",
  "tags": ["keyword1", "keyword2"],
  "rootCause": "Root cause if known",
  "preventionTips": ["tip1", "tip2"]
}
`,
};

/**
 * Invoke Claude model with cost monitoring and request blocking
 */
async function invokeClaudeModel(
  prompt: string,
  operation: string = "general",
  modelId: string = DEFAULT_MODEL_ID,
  maxTokens: number = 1000,
  userId?: string,
  ticketId?: string
): Promise<{
  response: string;
  costEstimate: CostEstimate;
  actualTokens: { input: number; output: number };
}> {
  if (!bedrockClient) {
    bedrockClient = await initializeBedrockClient();
    if (!bedrockClient) {
      throw new Error("AWS Bedrock client not initialized");
    }
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
      temperature: 0.3,
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
        temperature: 0.3,
        topP: 0.9,
      },
    };
  } else if (modelId.startsWith("ai21.j2")) {
    // AI21 Jurassic models use AI21 format
    requestBody = {
      prompt: prompt,
      maxTokens: effectiveMaxTokens,
      temperature: 0.3,
      topP: 0.9,
    };
  } else if (modelId.startsWith("meta.llama")) {
    // Meta Llama models use Llama format
    requestBody = {
      prompt: prompt,
      max_gen_len: effectiveMaxTokens,
      temperature: 0.3,
      top_p: 0.9,
    };
  } else {
    // Fallback to Claude format for unknown models
    requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: effectiveMaxTokens,
      temperature: 0.3,
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
    const result = await invokeClaudeModel(
      prompt,
      "analyzeTicket",
      DEFAULT_MODEL_ID, // Use cheapest model for analysis
      500, // Limit output tokens for cost control
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
    const result = await invokeClaudeModel(
      prompt,
      "generateResponse",
      DEFAULT_MODEL_ID, // Use cheapest model for responses
      800, // Limit output tokens for cost control
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
    const result = await invokeClaudeModel(
      prompt,
      "updateKnowledgeBase",
      DEFAULT_MODEL_ID, // Use cheapest model for knowledge extraction
      600, // Limit output tokens for cost control
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
    await initializeBedrockClient();
    const testPrompt =
      "Hello, this is a test. Please respond with 'Connection successful'.";

    const result = await invokeClaudeModel(
      testPrompt,
      "testConnection",
      DEFAULT_MODEL_ID,
      50, // Very small response for testing
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
 * Get cost statistics for dashboard
 */
export async function getCostStatistics() {
  const { getCostStatistics } = await import("./costMonitoring");
  return getCostStatistics();
}

/**
 * Update cost limits
 */
export async function updateCostLimits(
  limits: Partial<import("./costMonitoring").CostLimits>
) {
  const { loadCostLimits, saveCostLimits } = await import("./costMonitoring");
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
  const { resetUsageData } = await import("./costMonitoring");
  return resetUsageData();
}

/**
 * Export usage data for analysis
 */
export async function exportUsageData(startDate?: string, endDate?: string) {
  const { exportUsageData } = await import("./costMonitoring");
  return exportUsageData(startDate, endDate);
}

// Export initialization function
export const bedrockIntegration = {
  initialize: initializeBedrockClient,
  analyzeTicket,
  generateResponse,
  updateKnowledgeBase,
  calculateConfidence,
  testConnection: testBedrockConnection,
  getCostStatistics,
  updateCostLimits,
  resetUsageData,
  exportUsageData,
};
