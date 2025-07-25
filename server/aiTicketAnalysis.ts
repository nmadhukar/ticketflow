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

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { storage } from './storage';
import { logSecurityEvent } from './security';

/**
 * Initialize AWS Bedrock client with security validation
 * Returns null if credentials are not configured, allowing graceful degradation
 */
const getBedrockClient = () => {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.warn('AWS credentials not configured. AI features will be disabled.');
    return null;
  }

  return new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });
};

/**
 * Structure for AI ticket analysis results
 * Provides comprehensive assessment of ticket complexity, categorization, and recommendations
 */
export interface TicketAnalysis {
  complexity: 'low' | 'medium' | 'high' | 'critical';
  category: 'bug' | 'feature' | 'support' | 'enhancement' | 'incident' | 'request';
  priority: 'low' | 'medium' | 'high' | 'urgent';
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
  const client = getBedrockClient();
  if (!client) return null;

  try {
    const prompt = `
You are an expert helpdesk AI analyst. Analyze this support ticket and provide structured insights.

Ticket Details:
Title: ${ticketData.title}
Description: ${ticketData.description}
Current Category: ${ticketData.category || 'Not specified'}
Current Priority: ${ticketData.priority || 'Not specified'}

Please analyze this ticket and respond with a JSON object containing:
{
  "complexity": "low|medium|high|critical",
  "category": "bug|feature|support|enhancement|incident|request",
  "priority": "low|medium|high|urgent",
  "estimatedResolutionTime": number_of_hours,
  "tags": ["tag1", "tag2", "tag3"],
  "confidence": confidence_score_0_to_100,
  "reasoning": "Brief explanation of your analysis"
}

Consider these factors:
- Technical complexity indicators
- User impact level
- Urgency keywords
- Similar historical patterns
- Required expertise level

Respond only with valid JSON.`;

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      contentType: "application/json",
      accept: "application/json"
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    if (responseBody.content && responseBody.content[0]?.text) {
      const analysisText = responseBody.content[0].text;
      const analysis = JSON.parse(analysisText) as TicketAnalysis;
      
      // Store analysis in database
      await storage.saveTicketAnalysis(ticketData.reporterId, {
        ...analysis,
        timestamp: new Date()
      });

      // Log AI usage for security audit
      logSecurityEvent({
        userId: ticketData.reporterId,
        action: 'ai_analysis',
        resource: 'ticket',
        success: true,
        details: { confidence: analysis.confidence, complexity: analysis.complexity }
      });

      return analysis;
    }

    return null;
  } catch (error) {
    console.error('AI ticket analysis error:', error);
    logSecurityEvent({
      userId: ticketData.reporterId,
      action: 'ai_analysis',
      resource: 'ticket',
      success: false,
      details: { error: error instanceof Error ? error.message : String(error) }
    });
    return null;
  }
};

// Generate AI auto-response for ticket
export const generateAutoResponse = async (
  ticketData: {
    title: string;
    description: string;
    category: string;
    priority: string;
  },
  analysis: TicketAnalysis,
  knowledgeBaseContext?: string[]
): Promise<AutoResponse | null> => {
  const client = getBedrockClient();
  if (!client) return null;

  try {
    const knowledgeContext = knowledgeBaseContext && knowledgeBaseContext.length > 0 
      ? `\n\nRelevant Knowledge Base Articles:\n${knowledgeBaseContext.join('\n---\n')}`
      : '';

    const prompt = `
You are a professional helpdesk support agent. Generate a helpful, empathetic response to this support ticket.

Ticket Information:
Title: ${ticketData.title}
Description: ${ticketData.description}
Category: ${ticketData.category}
Priority: ${ticketData.priority}
AI Analysis: Complexity ${analysis.complexity}, Est. resolution ${analysis.estimatedResolutionTime}h
${knowledgeContext}

Generate a response that:
1. Acknowledges the issue empathetically
2. Provides immediate helpful information or next steps
3. Sets appropriate expectations for resolution time
4. Includes relevant troubleshooting steps if applicable
5. Mentions when they can expect follow-up

Respond with a JSON object:
{
  "response": "Your professional support response",
  "confidence": confidence_score_0_to_100,
  "knowledgeBaseArticles": ["article_ids_referenced"],
  "followUpActions": ["action1", "action2"],
  "escalationNeeded": boolean
}

Keep the tone professional yet friendly. Be specific and actionable.`;

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      contentType: "application/json",
      accept: "application/json"
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    if (responseBody.content && responseBody.content[0]?.text) {
      const responseText = responseBody.content[0].text;
      const autoResponse = JSON.parse(responseText) as AutoResponse;
      
      return autoResponse;
    }

    return null;
  } catch (error) {
    console.error('AI auto-response generation error:', error);
    return null;
  }
};

// Calculate ticket complexity score
export const calculateComplexityScore = (analysis: TicketAnalysis): number => {
  let score = 0;
  
  // Base complexity scoring
  switch (analysis.complexity) {
    case 'low': score += 10; break;
    case 'medium': score += 30; break;
    case 'high': score += 60; break;
    case 'critical': score += 90; break;
  }
  
  // Priority adjustment
  switch (analysis.priority) {
    case 'low': score += 5; break;
    case 'medium': score += 15; break;
    case 'high': score += 25; break;
    case 'urgent': score += 40; break;
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
  const criticalIssue = analysis.complexity === 'critical';
  const urgentPriority = analysis.priority === 'urgent';
  const lowConfidence = analysis.confidence < 50 || autoResponse.confidence < 50;
  const longResolution = analysis.estimatedResolutionTime > 48;
  const explicitEscalation = autoResponse.escalationNeeded;
  
  return criticalIssue || urgentPriority || lowConfidence || longResolution || explicitEscalation;
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
    // Step 1: Analyze the ticket
    const analysis = await analyzeTicket(ticketData);
    if (!analysis) {
      return {
        analysis: null,
        autoResponse: null,
        complexityScore: 0,
        shouldEscalate: false,
        applied: false
      };
    }

    // Step 2: Search knowledge base for relevant articles
    const knowledgeContext = await searchKnowledgeBaseForTicket(ticketData);
    
    // Step 3: Generate auto-response
    const autoResponse = await generateAutoResponse(ticketData, analysis, knowledgeContext);
    if (!autoResponse) {
      return {
        analysis,
        autoResponse: null,
        complexityScore: calculateComplexityScore(analysis),
        shouldEscalate: shouldEscalateTicket(analysis, { confidence: 0, escalationNeeded: true } as AutoResponse),
        applied: false
      };
    }

    // Step 4: Calculate metrics
    const complexityScore = calculateComplexityScore(analysis);
    const shouldEscalate = shouldEscalateTicket(analysis, autoResponse);

    // Step 5: Apply auto-response if confidence is high enough
    const confidenceThreshold = 70;
    let applied = false;
    
    if (autoResponse.confidence >= confidenceThreshold && !shouldEscalate) {
      // Add auto-response as a comment
      await storage.addTaskComment({
        taskId: ticketData.id,
        userId: 'ai-assistant',
        content: autoResponse.response
      });

      // Store auto-response record
      await storage.saveAutoResponse({
        ticketId: ticketData.id,
        response: autoResponse.response,
        confidence: autoResponse.confidence,
        applied: true,
        createdAt: new Date()
      });

      applied = true;
    }

    // Store complexity score
    await storage.saveComplexityScore({
      ticketId: ticketData.id,
      score: complexityScore,
      factors: {
        complexity: analysis.complexity,
        priority: analysis.priority,
        estimatedTime: analysis.estimatedResolutionTime,
        confidence: analysis.confidence
      },
      createdAt: new Date()
    });

    return {
      analysis,
      autoResponse,
      complexityScore,
      shouldEscalate,
      applied
    };

  } catch (error) {
    console.error('AI ticket processing error:', error);
    return {
      analysis: null,
      autoResponse: null,
      complexityScore: 0,
      shouldEscalate: true,
      applied: false
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
      ...ticketData.title.toLowerCase().split(' '),
      ...ticketData.description.toLowerCase().split(' '),
      ticketData.category.toLowerCase()
    ].filter(term => term.length > 3);

    const articles = await storage.searchKnowledgeBase(searchTerms.join(' '));
    return articles.slice(0, 3).map((article: any) => `${article.title}: ${article.content.substring(0, 500)}`);
  } catch (error) {
    console.error('Knowledge base search error:', error);
    return [];
  }
};

// Update AI analytics
export const updateAIAnalytics = async (
  analysisResult: {
    analysis: TicketAnalysis | null;
    autoResponse: AutoResponse | null;
    applied: boolean;
  }
): Promise<void> => {
  try {
    const analytics = {
      timestamp: new Date(),
      analysisPerformed: !!analysisResult.analysis,
      responseGenerated: !!analysisResult.autoResponse,
      responseApplied: analysisResult.applied,
      confidence: analysisResult.analysis?.confidence || 0,
      complexity: analysisResult.analysis?.complexity || 'unknown'
    };

    await storage.saveAIAnalytics(analytics);
  } catch (error) {
    console.error('AI analytics update error:', error);
  }
};