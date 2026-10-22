/** AI workflow compatibility helpers. */
import { Task } from "@shared/schema";
import { estimatePromptTokensForBudget, recordUsage, assertBudgetAvailable, getDailyUsage, getMonthlyUsage, reconcileGenerationCost, CostEstimate } from "../../services/ai/costMonitoring";
import { PROMPT_TEMPLATES, buildTicketRoutingPrompt } from "./prompts";
import { getAISettings } from "server/admin/aiSettings";
import { extractJSON } from "./jsonUtils";
import { AiModelError, describeAIError } from "./aiErrors";
import { createOpenRouterClient } from "./openRouterClient";
import { createOpenRouterPricing } from "./openRouterPricing";
import { fitDescriptionToBudget } from "./promptBudget";
import type { AISettings } from "@shared/interfaces";

/** The most output each prompt that carries a ticket description asks for (before settings.maxTokens). */
/**
 * Operations whose visible text must be complete JSON: a provider that stopped at the token cap
 * returned a fragment, and parsing it would silently produce garbage. Free-text calls (the help
 * chat, the connection test) are deliberately absent: a short answer that reaches the cap is
 * truncated but still usable, so it must not be reported as a broken key.
 */
const STRUCTURED_OUTPUT_OPERATIONS = new Set([
  "analyzeTicket",
  "generateResponse",
  "updateKnowledgeBase",
  "ticketAnalysis",
  "autoResponse",
  "ticketRouting",
  "knowledge_analyzeResolvedTickets",
  "knowledge_generateArticle",
  "knowledge_searchRanking",
  "knowledge_improveArticle",
]);

/**
 * Extra output tokens allowed on the one retry that drops a rejected reasoning field. A model that
 * refuses the reasoning switch reasons by default, and those hidden tokens are drawn from
 * max_tokens: a small structured cap (analyzeTicket asks for 500) could be spent thinking before
 * any visible text. The retry may ask up to this much more, but never past the per-request token
 * ceiling, so prompt plus retry still fits maxTokensPerRequest. The budget preflight below checks
 * that ceiling, so the larger retry is covered by the cost limits too.
 */
const REASONING_RETRY_HEADROOM_TOKENS = 1000;

const OPERATION_OUTPUT_CAP = {
  analyzeTicket: 500,
  generateResponse: 800,
  updateKnowledgeBase: 600,
  ticketAnalysis: 1000,
  autoResponse: 1500,
  ticketRouting: 400,
} as const;
type DescriptionOperation = keyof typeof OPERATION_OUTPUT_CAP;

/**
 * M3: the prompt for a ticket, with its description cut to fit settings.maxTokensPerRequest while
 * leaving the operation's full output allowance. A long (emailed) description used to push the
 * prompt over the cap and the call was blocked, so the ticket got no AI at all. Only the description
 * is cut; the cap is unchanged.
 */
function promptWithinBudget(
  settings: AISettings,
  operation: DescriptionOperation,
  description: string | null | undefined,
  buildPrompt: (description: string | null | undefined) => string
): string {
  return buildPrompt(
    fitDescriptionToBudget({
      description,
      buildPrompt,
      maxTokensPerRequest: settings.maxTokensPerRequest,
      maxOutputTokens: Math.min(settings.maxTokens, OPERATION_OUTPUT_CAP[operation]),
      operation,
    })
  );
}

/** promptWithinBudget for callers that have not loaded the settings (aiTicketAnalysis). */
export async function buildPromptWithinBudget(
  operation: DescriptionOperation,
  description: string | null | undefined,
  buildPrompt: (description: string | null | undefined) => string
): Promise<string> {
  return promptWithinBudget(await getAISettings(), operation, description, buildPrompt);
}

const pricing = createOpenRouterPricing();
const modelClient = createOpenRouterClient({ getModelId: async () => (await getAISettings()).modelId, getModelPrice: pricing.getModelPrice });

export async function getBedrockClient() {
  const settings = await getAISettings();
  return { bedrockClient: settings.isActive && settings.openRouterKeyConfigured ? modelClient : null, bedrockModelId: settings.modelId };
}

async function invokeBedrockModel(
  prompt: string,
  operation: string = "general",
  maxTokens: number = 1000,
  temperature: number = 0.3,
  userId?: string,
  ticketId?: string,
  /**
   * Passed to the provider when set. The JSON operations pass false: on a reasoning model the
   * hidden reasoning is drawn from maxTokens, so a tight structured-output cap can be spent
   * before any visible text is produced. Left undefined for free-text calls (the help chat).
   */
  reasoning?: boolean
): Promise<{ response: string; costEstimate: CostEstimate; actualTokens: { input: number; output: number } }> {
  const settings = await getAISettings();
  if (!settings.isActive || !settings.openRouterKeyConfigured) throw new AiModelError("not_configured");
  const price = await pricing.getModelPrice(settings.modelId);
  const [daily, monthly] = await Promise.all([getDailyUsage(), getMonthlyUsage()]);
  const promptTokens = estimatePromptTokensForBudget(prompt);
  const allowedOutputTokens = Math.min(maxTokens, settings.maxTokensPerRequest - promptTokens);
  // The retry that drops a rejected reasoning field may raise the visible allowance toward this
  // ceiling, clamped by the per-request cap: prompt plus ceiling still fits maxTokensPerRequest, so
  // the retry cannot exceed the request limit. Only a call that sends the reasoning field can retry
  // at all, so only it carries the headroom; a call without one spends at most its own allowance.
  // The preflight checks this ceiling, not the first attempt's smaller allowance, so a cost limit
  // the retry could cross still applies.
  const ceilingOutputTokens = reasoning === undefined
    ? allowedOutputTokens
    : Math.min(allowedOutputTokens + REASONING_RETRY_HEADROOM_TOKENS, settings.maxTokensPerRequest - promptTokens);
  assertBudgetAvailable({ promptTokens, maxOutputTokens: ceilingOutputTokens, price, settings, todayUsd: daily.totalCost, monthUsd: monthly.totalCost });
  const result = await modelClient.generate({
    operation, messages: [{ role: "user", content: prompt }],
    maxOutputTokens: allowedOutputTokens, temperature,
    maxOutputTokensCeiling: ceilingOutputTokens,
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(STRUCTURED_OUTPUT_OPERATIONS.has(operation) ? { requireCompleteOutput: true } : {}),
    context: { userId, ticketId: ticketId ? Number(ticketId) : undefined },
  });
  await recordUsage({
    modelId: result.actualModel, requestedModelId: result.requestedModel,
    generationId: result.generationId, inputTokens: result.promptTokens,
    outputTokens: result.completionTokens, estimatedCost: result.estimatedCostUsd,
    operation, userId, ticketId,
  });
  if (result.generationId) await reconcileGenerationCost(result.generationId);
  return {
    response: result.text,
    costEstimate: {
      inputTokens: result.promptTokens, outputTokens: result.completionTokens,
      estimatedCost: result.estimatedCostUsd, modelId: result.actualModel, operation,
    },
    actualTokens: { input: result.promptTokens, output: result.completionTokens },
  };
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
    const settings = await getAISettings();
    const prompt = promptWithinBudget(settings, "analyzeTicket", ticket.description, (description) =>
      PROMPT_TEMPLATES.analyzeTicket({ ...ticket, description: description ?? null })
    );
    const cap = Math.min(settings.maxTokens, OPERATION_OUTPUT_CAP.analyzeTicket);
    const temperature = settings.temperature;
    const result = await invokeBedrockModel(
      prompt,
      "analyzeTicket",
      cap,
      temperature,
      userId,
      ticket.id?.toString(),
      false
    );

    // Check if response is empty
    if (!result.response || result.response.trim().length === 0) {
      throw new Error("Empty response from Bedrock model");
    }

    // Parse JSON response (extract from markdown if needed)
    let cleanedResponse = extractJSON(result.response);

    // Check if cleaned response is empty
    if (!cleanedResponse || cleanedResponse.trim().length === 0) {
      console.error("Empty response after JSON extraction:", {
        originalLength: result.response.length,
      });
      throw new Error("Empty response after JSON extraction");
    }

    // Additional safety: if extraction didn't work, try to find JSON manually
    if (
      !cleanedResponse.trim().startsWith("{") &&
      !cleanedResponse.trim().startsWith("[")
    ) {
      console.warn(
        "JSON extraction may have failed, attempting manual extraction:",
        {
          originalLength: result.response.length,
          extractedLength: cleanedResponse.length,
        }
      );

      // Try to find JSON boundaries in the original response
      const jsonStart = result.response.indexOf("{");
      const jsonArrayStart = result.response.indexOf("[");
      const startIndex =
        jsonStart !== -1 && jsonArrayStart !== -1
          ? Math.min(jsonStart, jsonArrayStart)
          : jsonStart !== -1
          ? jsonStart
          : jsonArrayStart;

      if (startIndex !== -1) {
        // Extract from JSON start and find the matching closing brace
        const tempCleaned = result.response.substring(startIndex);
        let braceCount = 0;
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;
        let endIndex = -1;

        for (let i = 0; i < tempCleaned.length; i++) {
          const char = tempCleaned[i];
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          if (char === "\\") {
            escapeNext = true;
            continue;
          }
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (char === "{") braceCount++;
          else if (char === "}") {
            braceCount--;
            if (braceCount === 0 && bracketCount === 0) {
              endIndex = i + 1;
              break;
            }
          } else if (char === "[") bracketCount++;
          else if (char === "]") {
            bracketCount--;
            if (braceCount === 0 && bracketCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }

        if (endIndex > 0) {
          cleanedResponse = tempCleaned.substring(0, endIndex).trim();
          console.log("Manual extraction successful");
        } else {
          throw new Error("Could not extract valid JSON from response");
        }
      } else {
        throw new Error("No JSON found in response");
      }
    }

    // Final check before parsing
    if (!cleanedResponse || cleanedResponse.trim().length === 0) {
      throw new Error("Empty response after all extraction attempts");
    }

    let analysis;
    try {
      analysis = JSON.parse(cleanedResponse);
    } catch (parseError: any) {
      // A SyntaxError message quotes the start of the text it could not parse:
      // log only its type and the length, and do not pass the message on.
      console.error("JSON parse error:", {
        error: describeAIError(parseError),
        cleanedResponseLength: cleanedResponse.length,
      });
      throw new Error("Failed to parse JSON from the model response");
    }

    // Validate response structure
    if (!analysis.keyIssues || !analysis.complexityScore) {
      throw new Error("Invalid analysis response format");
    }

    return {
      ...analysis,
      costEstimate: result.costEstimate,
    };
  } catch (error) {
    console.error("Error analyzing ticket:", describeAIError(error));

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
  /**
   * True when no real answer was produced (the model call failed, or it returned JSON with no
   * response field) and `response` is the holding message. Callers must not treat this as a
   * matched solution: it means "no answer", the same as an empty reply.
   */
  degraded?: boolean;
}> {
  try {
    // Format knowledge base content. The id is shown so the model can cite an article by
    // id; a model that cites it by title instead is resolved back to its id below.
    // A recalled memory is prompt context, not a citable article: it has no id, so it is shown
    // by title alone rather than as the literal "[id undefined]" the old template produced.
    const knowledgeBase = knowledgeBaseArticles
      .map((article) => {
        const id = Number(article.id);
        const label = Number.isInteger(id) && id > 0 ? `[id ${id}] ` : "";
        return `- ${label}${article.title}: ${article.summary}`;
      })
      .join("\n");

    const settings = await getAISettings();
    // Tell the model the character budget the reply will be held to, so it finishes inside it
    // rather than being cut off mid-sentence by the store step.
    const maxCharacters = Math.max(100, Math.min(5000, Number(settings.maxResponseLength) || 1000));
    const prompt = promptWithinBudget(settings, "generateResponse", ticket.description, (description) =>
      PROMPT_TEMPLATES.generateResponse({ ...ticket, description: description ?? null }, knowledgeBase, maxCharacters)
    );
    const cap = Math.min(settings.maxTokens, OPERATION_OUTPUT_CAP.generateResponse);
    const temperature = settings.temperature;
    const result = await invokeBedrockModel(
      prompt,
      "generateResponse",
      cap,
      temperature,
      userId,
      ticket.id?.toString(),
      false
    );

    // Check if response is empty
    if (!result.response || result.response.trim().length === 0) {
      throw new Error("Empty response from Bedrock model");
    }

    // Extract and parse JSON response (handles markdown code blocks and explanatory text)
    let cleanedResponse = extractJSON(result.response);

    // If extraction failed, try to find JSON directly in the response
    if (!cleanedResponse || cleanedResponse.trim().length === 0) {
      // Try to find JSON object directly (handle cases where extractJSON fails)
      const directJsonMatch = result.response.match(/\{[\s\S]*\}/);
      if (directJsonMatch) {
        cleanedResponse = directJsonMatch[0];
      } else {
        console.error("Empty response after JSON extraction:", {
          originalLength: result.response.length,
        });
        throw new Error("Empty response after JSON extraction");
      }
    }

    // Trim and validate JSON format
    cleanedResponse = cleanedResponse.trim();

    // Validate that cleaned response looks like JSON (starts with { or [)
    if (!cleanedResponse.startsWith("{") && !cleanedResponse.startsWith("[")) {
      console.error("Extracted response is not JSON:", {
        cleanedLength: cleanedResponse.length,
        originalLength: result.response.length,
      });
      throw new Error("Extracted response is not valid JSON format");
    }

    // Parse the JSON to extract the actual response text
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(cleanedResponse);
    } catch (parseError: any) {
      console.error("JSON parse error in generateResponse:", {
        error: describeAIError(parseError),
        cleanedResponseLength: cleanedResponse.length,
        originalLength: result.response.length,
      });
      throw new Error("Failed to parse JSON from the model response");
    }

    // Extract the response field from the parsed JSON
    // The AI should return a JSON object with a "response" field containing the actual text
    const holdingMessage =
      "I'm unable to generate an automated response at this time. A support agent will assist you shortly.";
    const responseText = parsedResponse.response || parsedResponse.autoResponse || holdingMessage;

    // Extract confidence from parsed response, or calculate based on knowledge base
    const confidence =
      typeof parsedResponse.confidence === "number"
        ? parsedResponse.confidence
        : knowledgeBaseArticles.length > 0
        ? 0.8
        : 0.5;

    // Cite back the articles the model referenced, as ids. Models often return the article
    // titles (or `"id 7"`) rather than bare numbers, so anything that is not already a number
    // is matched against the articles the model was shown; unresolvable entries are dropped
    // and, when nothing resolves, the articles we passed are used instead.
    const suggestedArticles = resolveCitedArticles(
      parsedResponse.knowledgeBaseArticles,
      knowledgeBaseArticles
    );

    return {
      response: responseText, // Clean response text only, no markdown or code
      confidence,
      suggestedArticles,
      costEstimate: result.costEstimate,
      // JSON without a response field is not an answer: mark it so the caller routes the ticket.
      ...(responseText === holdingMessage ? { degraded: true } : {}),
    };
  } catch (error) {
    console.error("Error generating response:", describeAIError(error));

    // If request was blocked, re-throw with cost information
    if ((error as any).isBlocked) {
      throw error;
    }

    return {
      response:
        "I'm unable to generate an automated response at this time. A support agent will assist you shortly.",
      confidence: 0,
      suggestedArticles: [],
      degraded: true,
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
    const settings = await getAISettings();
    const prompt = promptWithinBudget(settings, "updateKnowledgeBase", ticket.description, (description) =>
      PROMPT_TEMPLATES.extractKnowledge({ ...ticket, description: description ?? null }, resolution)
    );
    const cap = Math.min(settings.maxTokens, OPERATION_OUTPUT_CAP.updateKnowledgeBase);
    const temperature = settings.temperature;

    const result = await invokeBedrockModel(
      prompt,
      "updateKnowledgeBase",
      cap,
      temperature,
      userId,
      ticket.id?.toString(),
      false
    );

    // Parse JSON response (extract from markdown if needed)
    const cleanedResponse = extractJSON(result.response);
    const knowledge = JSON.parse(cleanedResponse);

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
    console.error("Error extracting knowledge:", describeAIError(error));

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

  // Auto-respond only when the admin has it on and the score reaches the configured threshold
  // (read now, so a settings change applies to the next ticket).
  const settings = await getAISettings();
  const threshold = Math.max(0, Math.min(1, Number(settings.confidenceThreshold)));
  const shouldAutoRespond = settings.autoResponseEnabled && confidence >= threshold;

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
  code?: string;
  costEstimate?: CostEstimate;
}> {
  try {
    const response = await getBedrockClient();

    if (!response.bedrockClient) return { success: false, code: "not_configured" };

    const testPrompt =
      "Hello, this is a test. Please respond with 'Connection successful'.";

    const result = await invokeBedrockModel(
      testPrompt,
      "testConnection",
      50, // Very small response for testing
      undefined,
      "system",
      undefined,
      false
    );

    return {
      success: result.response.includes("successful"),
      costEstimate: result.costEstimate,
    };
  } catch (error) {
    console.error("Bedrock connection test failed:", describeAIError(error));

    if ((error as any).isBlocked) {
      return {
        success: false,
        costEstimate: (error as any).costEstimate,
        code: "quota_exceeded",
      };
    }

    return {
      success: false,
      code: error instanceof AiModelError ? error.code : "provider_failure",
    };
  }
}

/**
 * Get a lightweight Bedrock configuration snapshot for dashboards
 * - currentModelId: from bedrock_settings.bedrock_model_id (if configured)
 */
export async function getBedrockConfigSummary(): Promise<{
  currentModelId: string | null;
}> {
  const settings = await getAISettings();

  return {
    currentModelId: settings.isActive ? settings.modelId : null,
  };
}

/**
 * Get cost statistics plus configuration for dashboard
 */
export async function getCostStatistics() {
  const { getCostStatistics } = await import(
    "../../services/ai/costMonitoring"
  );
  const stats = await getCostStatistics();
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
  limits: Partial<import("../../services/ai/costMonitoring").CostLimits>,
  userId: string = "system"
) {
  const { loadCostLimits, saveCostLimits } = await import(
    "../../services/ai/costMonitoring"
  );
  const currentLimits = await loadCostLimits();
  const merged = { ...currentLimits, ...limits };
  await saveCostLimits(merged, userId);
  return merged;
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
  const cap = Math.min(settings.maxTokens, OPERATION_OUTPUT_CAP.ticketAnalysis);
  const temperature = settings.temperature;
  return invokeBedrockModel(prompt, "ticketAnalysis", cap, temperature, undefined, undefined, false);
}

export async function runAutoResponseForTicketPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, OPERATION_OUTPUT_CAP.autoResponse);
  const temperature = settings.temperature;
  return invokeBedrockModel(prompt, "autoResponse", cap, temperature, undefined, undefined, false);
}

export async function runKnowledgePatternPrompt(prompt: string) {
  const settings = await getAISettings();
  const cap = Math.min(settings.maxTokens, 2000);
  const temperature = settings.temperature;
  return invokeBedrockModel(
    prompt,
    "knowledge_analyzeResolvedTickets",
    cap,
    temperature,
    undefined,
    undefined,
    false
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
    temperature,
    undefined,
    undefined,
    false
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
    temperature,
    undefined,
    undefined,
    false
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
    temperature,
    undefined,
    undefined,
    false
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
    temperature,
    undefined,
    undefined,
    false
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

/**
 * 0031: classify a ticket that found no matching solution onto one of the existing teams.
 * The prompt is budget-fit around the description (fitDescriptionToBudget), then the model's
 * team id is returned for the caller to re-validate against the live team list before assigning.
 */
export async function classifyTicketForRouting(
  ticket: Pick<Task, "title" | "description" | "category" | "priority" | "id">,
  departments: Array<{ id: number; name: string }>,
  teams: Array<{ id: number; name: string; departmentId: number | null }>,
  userId?: string
): Promise<{ teamId: number | null; departmentId: number | null; confidence: number; reason: string }> {
  const settings = await getAISettings();
  const prompt = promptWithinBudget(settings, "ticketRouting", ticket.description, (description) =>
    buildTicketRoutingPrompt({
      title: ticket.title,
      description: description ?? null,
      category: ticket.category,
      priority: ticket.priority,
      departments,
      teams,
    })
  );
  const cap = Math.min(settings.maxTokens, OPERATION_OUTPUT_CAP.ticketRouting);
  const result = await invokeBedrockModel(
    prompt,
    "ticketRouting",
    cap,
    // Routing is a classification, not creative writing: ask for the most deterministic answer.
    0,
    userId,
    ticket.id?.toString(),
    false
  );

  const cleaned = extractJSON(result.response) || result.response;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("The routing response was not valid JSON");
  }

  const rawTeamId = Number(parsed.teamId);
  const teamId = Number.isInteger(rawTeamId) && rawTeamId > 0 ? rawTeamId : null;
  const rawDepartmentId = Number(parsed.departmentId);
  const departmentId = Number.isInteger(rawDepartmentId) && rawDepartmentId > 0 ? rawDepartmentId : null;
  const rawConfidence = Number(parsed.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0;
  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : "";

  return { teamId, departmentId, confidence, reason };
}

/**
 * The articles the model cited, as ids. A model asked for `knowledgeBaseArticles` ids may still
 * answer with the titles it was shown (or `"id 7"`), and a single non-numeric entry used to fail the
 * caller's schema and discard the whole reply. Each entry is accepted when it is already an id of an
 * article we passed, and otherwise matched by title (or a leading "id N"). Entries that match
 * nothing are dropped; when none resolve, the articles we passed stand in.
 */
function resolveCitedArticles(cited: unknown, articles: any[]): number[] {
  // Only articles with a real id can be cited. A recalled Hindsight memory is passed in as prompt
  // context and has no id: Number(undefined) is NaN, which failed the caller's
  // "positive integer" schema and threw the whole analysis away, so enabling memory silently
  // disabled auto-replies. Such entries are simply not citable.
  const known = articles
    .map((article) => ({ id: Number(article.id), title: String(article.title ?? "") }))
    .filter((article) => Number.isInteger(article.id) && article.id > 0);
  if (!Array.isArray(cited) || cited.length === 0) return known.map((article) => article.id);

  const resolved: number[] = [];
  for (const entry of cited) {
    const direct = typeof entry === "number" ? entry : Number(String(entry).replace(/^\s*id\s*/i, "").trim());
    if (Number.isInteger(direct) && known.some((article) => article.id === direct)) {
      if (!resolved.includes(direct)) resolved.push(direct);
      continue;
    }
    const needle = String(entry).trim().toLowerCase();
    if (!needle) continue;
    const byTitle = known.find((article) => article.title.toLowerCase() === needle)
      ?? known.find((article) => needle.includes(article.title.toLowerCase()) || article.title.toLowerCase().includes(needle));
    if (byTitle && !resolved.includes(byTitle.id)) resolved.push(byTitle.id);
  }
  return resolved.length > 0 ? resolved : known.map((article) => article.id);
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
  classifyTicketForRouting,
  runKnowledgePatternPrompt,
  runKnowledgeArticleGenerationPrompt,
  runKnowledgePatternAnalysisPrompt,
  runKnowledgeSearchPrompt,
  runKnowledgeImproveArticlePrompt,
  runChatPrompt,
};
