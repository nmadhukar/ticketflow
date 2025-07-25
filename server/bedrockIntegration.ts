/**
 * AWS Bedrock Integration for Intelligent Ticket Handling
 * 
 * This module provides integration with AWS Bedrock using Claude 3 Sonnet
 * for intelligent ticket analysis, response generation, and knowledge base management.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { Task } from "@shared/schema";
import { storage } from "./storage";

// Bedrock model configuration
const CLAUDE_3_SONNET_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0";

// Initialize Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Initialize AWS Bedrock client with credentials
 */
export async function initializeBedrockClient() {
  const { bedrockAccessKeyId, bedrockSecretAccessKey, bedrockRegion } = await getBedrockConfig();
  
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
    const settings = await storage.getSmtpSettings();
    if (settings) {
      return {
        bedrockAccessKeyId: settings.bedrockAccessKeyId,
        bedrockSecretAccessKey: settings.bedrockSecretAccessKey,
        bedrockRegion: settings.bedrockRegion || 'us-east-1',
      };
    }
  } catch (error) {
    console.error("Error fetching Bedrock config from database:", error);
  }

  // Fallback to environment variables
  return {
    bedrockAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    bedrockSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bedrockRegion: process.env.AWS_REGION || 'us-east-1',
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
Description: ${ticket.description || 'No description provided'}
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
Description: ${ticket.description || 'No description provided'}
Category: ${ticket.category}

Relevant Knowledge Base Articles:
${knowledgeBase || 'No relevant articles found'}

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
Description: ${ticket.description || 'No description provided'}
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
 * Invoke Claude 3 Sonnet model with a prompt
 */
async function invokeClaudeModel(prompt: string): Promise<string> {
  if (!bedrockClient) {
    bedrockClient = await initializeBedrockClient();
    if (!bedrockClient) {
      throw new Error("AWS Bedrock client not initialized");
    }
  }

  const input = {
    modelId: CLAUDE_3_SONNET_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  };

  try {
    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);
    
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.content[0].text;
  } catch (error) {
    console.error("Error invoking Claude model:", error);
    throw error;
  }
}

/**
 * Analyze a ticket to categorize and extract key information
 */
export async function analyzeTicket(ticket: Task): Promise<{
  keyIssues: string[];
  suggestedCategory: string;
  recommendedPriority: string;
  complexityScore: number;
  requiredExpertise: string[];
  estimatedHours: number;
}> {
  try {
    const prompt = PROMPT_TEMPLATES.analyzeTicket(ticket);
    const response = await invokeClaudeModel(prompt);
    
    // Parse JSON response
    const analysis = JSON.parse(response);
    
    // Validate response structure
    if (!analysis.keyIssues || !analysis.complexityScore) {
      throw new Error("Invalid analysis response format");
    }
    
    return analysis;
  } catch (error) {
    console.error("Error analyzing ticket:", error);
    // Return default analysis on error
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
  knowledgeBaseArticles: any[]
): Promise<{
  response: string;
  confidence: number;
  suggestedArticles: number[];
}> {
  try {
    // Format knowledge base content
    const knowledgeBase = knowledgeBaseArticles
      .map((article) => `- ${article.title}: ${article.summary}`)
      .join("\n");
    
    const prompt = PROMPT_TEMPLATES.generateResponse(ticket, knowledgeBase);
    const response = await invokeClaudeModel(prompt);
    
    // Calculate confidence based on knowledge base availability
    const confidence = knowledgeBaseArticles.length > 0 ? 0.8 : 0.5;
    
    return {
      response,
      confidence,
      suggestedArticles: knowledgeBaseArticles.map((a) => a.id),
    };
  } catch (error) {
    console.error("Error generating response:", error);
    return {
      response: "I'm unable to generate an automated response at this time. A support agent will assist you shortly.",
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
  resolution: string
): Promise<{
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
}> {
  try {
    const prompt = PROMPT_TEMPLATES.extractKnowledge(ticket, resolution);
    const response = await invokeClaudeModel(prompt);
    
    // Parse JSON response
    const knowledge = JSON.parse(response);
    
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
    };
  } catch (error) {
    console.error("Error extracting knowledge:", error);
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
 * Test Bedrock connection
 */
export async function testBedrockConnection(): Promise<boolean> {
  try {
    await initializeBedrockClient();
    const testPrompt = "Hello, this is a test. Please respond with 'Connection successful'.";
    const response = await invokeClaudeModel(testPrompt);
    return response.includes("successful");
  } catch (error) {
    console.error("Bedrock connection test failed:", error);
    return false;
  }
}

// Export initialization function
export const bedrockIntegration = {
  initialize: initializeBedrockClient,
  analyzeTicket,
  generateResponse,
  updateKnowledgeBase,
  calculateConfidence,
  testConnection: testBedrockConnection,
};