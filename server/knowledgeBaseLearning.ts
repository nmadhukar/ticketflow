/**
 * Knowledge Base Learning System
 *
 * This module automatically learns from resolved tickets to build a smart knowledge base.
 * Key features:
 * - Analyzes patterns in resolved tickets to identify common issues
 * - Generates knowledge articles from successful resolutions
 * - Creates preventive guidance and best practices
 * - Tracks resolution effectiveness and success rates
 * - Provides insights for improving support processes
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { storage } from "./storage";
import { logSecurityEvent } from "./security";

/**
 * Initialize AWS Bedrock client for knowledge extraction
 * Uses same credentials as ticket analysis but with separate error handling
 */
const getBedrockClient = () => {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.warn(
      "AWS credentials not configured. Knowledge base learning disabled."
    );
    return null;
  }

  return new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

/**
 * Structure for AI-generated knowledge articles
 * Created automatically from analysis of resolved tickets
 */
export interface KnowledgeArticle {
  title: string;
  content: string;
  category: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedReadTime: number; // in minutes
  relatedTickets: number[];
  confidence: number;
  isPublished: boolean;
  createdBy: "ai-learning" | string;
}

/**
 * Pattern analysis results from batch processing resolved tickets
 * Identifies common problem types and their effective solutions
 */
export interface ResolutionPattern {
  problemType: string;
  commonSolutions: string[];
  preventiveMeasures: string[];
  frequency: number;
  averageResolutionTime: number;
  successRate: number;
}

/**
 * Batch analysis of resolved tickets to identify resolution patterns
 *
 * Processes multiple resolved tickets to:
 * - Identify recurring problem types
 * - Extract successful resolution strategies
 * - Calculate success rates and resolution times
 * - Generate preventive measures
 * - Recommend process improvements
 *
 * @param ticketBatch - Array of resolved tickets with their resolution data
 * @returns Array of identified resolution patterns
 */
export const analyzeResolvedTickets = async (
  ticketBatch: Array<{
    id: number;
    title: string;
    description: string;
    category: string;
    priority: string;
    resolution: string;
    resolutionTime: number; // in hours
    comments: Array<{ content: string; userId: string; createdAt: Date }>;
  }>
): Promise<ResolutionPattern[]> => {
  const client = getBedrockClient();
  if (!client || ticketBatch.length === 0) return [];

  try {
    const ticketSummaries = ticketBatch
      .map(
        (ticket) => `
Ticket ${ticket.id}:
Title: ${ticket.title}
Category: ${ticket.category}
Priority: ${ticket.priority}
Problem: ${ticket.description}
Resolution: ${ticket.resolution}
Time to resolve: ${ticket.resolutionTime} hours
Comments: ${ticket.comments.map((c) => c.content).join("; ")}
---`
      )
      .join("\n");

    const prompt = `
You are an expert knowledge management AI. Analyze these resolved support tickets to identify common patterns and create actionable knowledge.

Resolved Tickets:
${ticketSummaries}

Identify resolution patterns and respond with a JSON array of patterns:
[
  {
    "problemType": "Clear description of the problem type",
    "commonSolutions": ["solution1", "solution2", "solution3"],
    "preventiveMeasures": ["prevention1", "prevention2"],
    "frequency": estimated_frequency_score_1_to_10,
    "averageResolutionTime": average_hours,
    "successRate": success_rate_0_to_100
  }
]

Focus on:
1. Recurring problem types
2. Effective solution patterns
3. Preventive measures
4. Time-saving approaches
5. Common user mistakes

Limit to the top 5 most significant patterns. Respond only with valid JSON.`;

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (responseBody.content && responseBody.content[0]?.text) {
      const patternsText = responseBody.content[0].text;
      const patterns = JSON.parse(patternsText) as ResolutionPattern[];

      // Log learning activity
      logSecurityEvent({
        action: "knowledge_learning",
        resource: "tickets",
        success: true,
        details: {
          ticketsAnalyzed: ticketBatch.length,
          patternsFound: patterns.length,
        },
      });

      return patterns;
    }

    return [];
  } catch (error) {
    console.error("Knowledge pattern analysis error:", error);
    logSecurityEvent({
      action: "knowledge_learning",
      resource: "tickets",
      success: false,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return [];
  }
};

// Generate knowledge base article from resolution pattern
export const generateKnowledgeArticle = async (
  pattern: ResolutionPattern,
  relatedTickets: number[]
): Promise<KnowledgeArticle | null> => {
  const client = getBedrockClient();
  if (!client) return null;

  try {
    const prompt = `
You are a technical writer creating a knowledge base article. Based on this resolution pattern, create a comprehensive, user-friendly article.

Resolution Pattern:
Problem Type: ${pattern.problemType}
Common Solutions: ${pattern.commonSolutions.join(", ")}
Preventive Measures: ${pattern.preventiveMeasures.join(", ")}
Average Resolution Time: ${pattern.averageResolutionTime} hours
Success Rate: ${pattern.successRate}%

Create a knowledge base article with this JSON structure:
{
  "title": "Clear, descriptive title",
  "content": "Comprehensive article content in markdown format",
  "category": "support|technical|howto|troubleshooting|faq",
  "tags": ["tag1", "tag2", "tag3"],
  "difficulty": "beginner|intermediate|advanced",
  "estimatedReadTime": estimated_minutes_to_read,
  "confidence": confidence_score_0_to_100
}

Article content should include:
1. Problem description
2. Step-by-step solutions
3. Prevention tips
4. Common pitfalls to avoid
5. Related information

Write for non-technical users. Use clear, actionable language. Include specific steps and examples.`;

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 3000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (responseBody.content && responseBody.content[0]?.text) {
      const articleText = responseBody.content[0].text;
      const articleData = JSON.parse(articleText);

      const article: KnowledgeArticle = {
        ...articleData,
        relatedTickets,
        isPublished: articleData.confidence >= 70, // Auto-publish high confidence articles
        createdBy: "ai-learning",
      };

      return article;
    }

    return null;
  } catch (error) {
    console.error("Knowledge article generation error:", error);
    return null;
  }
};

// Main learning process - analyze recent resolved tickets
export const processKnowledgeLearning = async (): Promise<{
  patternsFound: number;
  articlesCreated: number;
  articlesPublished: number;
}> => {
  try {
    // Get recently resolved tickets (last 30 days)
    const recentResolvedTickets = await storage.getRecentResolvedTickets(30);

    if (recentResolvedTickets.length < 5) {
      console.log(
        "Insufficient resolved tickets for learning (minimum 5 required)"
      );
      return { patternsFound: 0, articlesCreated: 0, articlesPublished: 0 };
    }

    // Group tickets by category for better pattern analysis
    const ticketsByCategory = recentResolvedTickets.reduce((groups, ticket) => {
      const category = ticket.category || "general";
      if (!groups[category]) groups[category] = [];
      groups[category].push(ticket);
      return groups;
    }, {} as Record<string, typeof recentResolvedTickets>);

    let totalPatterns = 0;
    let totalArticles = 0;
    let totalPublished = 0;

    // Process each category separately
    for (const [category, tickets] of Object.entries(ticketsByCategory)) {
      if (tickets.length < 3) continue; // Need minimum tickets for pattern analysis

      console.log(
        `Analyzing ${tickets.length} resolved tickets in category: ${category}`
      );

      const patterns = await analyzeResolvedTickets(tickets);
      totalPatterns += patterns.length;

      // Generate articles for significant patterns
      for (const pattern of patterns) {
        if (pattern.frequency >= 3 && pattern.successRate >= 70) {
          const relatedTicketIds = tickets
            .filter(
              (t) =>
                t.title
                  .toLowerCase()
                  .includes(pattern.problemType.toLowerCase()) ||
                t.description
                  .toLowerCase()
                  .includes(pattern.problemType.toLowerCase())
            )
            .map((t) => t.id);

          const article = await generateKnowledgeArticle(
            pattern,
            relatedTicketIds
          );

          if (article) {
            // Check if similar article already exists
            const existingArticle = await storage.findSimilarKnowledgeArticle(
              article.title
            );

            if (!existingArticle) {
              // Save new article
              const savedArticle = await storage.createKnowledgeArticle({
                ...article,
                source: "ai_generated",
                // Always draft; admin will publish after review per requirements
                isPublished: false,
                status: "draft",
                createdAt: new Date(),
                updatedAt: new Date(),
              });

              totalArticles++;
              if (
                savedArticle.isPublished ||
                (savedArticle as any).status === "published"
              )
                totalPublished++;

              console.log(
                `Created knowledge article: "${article.title}" (${
                  article.isPublished ? "published" : "draft"
                })`
              );
            } else {
              console.log(`Similar article already exists: "${article.title}"`);
            }
          }
        }
      }
    }

    // Update learning analytics
    await storage.updateKnowledgeLearningStats({
      lastRunDate: new Date(),
      ticketsAnalyzed: recentResolvedTickets.length,
      patternsFound: totalPatterns,
      articlesCreated: totalArticles,
      articlesPublished: totalPublished,
    });

    console.log(
      `Knowledge learning completed: ${totalPatterns} patterns, ${totalArticles} articles created, ${totalPublished} published`
    );

    return {
      patternsFound: totalPatterns,
      articlesCreated: totalArticles,
      articlesPublished: totalPublished,
    };
  } catch (error) {
    console.error("Knowledge learning process error:", error);
    return { patternsFound: 0, articlesCreated: 0, articlesPublished: 0 };
  }
};

// Search knowledge base with semantic understanding
export const intelligentKnowledgeSearch = async (
  query: string,
  category?: string,
  maxResults: number = 10
): Promise<
  Array<{
    article: any;
    relevanceScore: number;
    matchedContent: string;
  }>
> => {
  const client = getBedrockClient();
  if (!client) {
    // Fallback to basic search
    return await basicKnowledgeSearch(query, category, maxResults);
  }

  try {
    // Get all published articles
    const articles = await storage.getPublishedKnowledgeArticles(category);

    if (articles.length === 0) return [];

    // Use AI to rank articles by relevance
    const articleSummaries = articles
      .map(
        (article, index) => `
Article ${index}:
Title: ${article.title}
Category: ${article.category}
Tags: ${article.tags?.join(", ") || "none"}
Content Preview: ${article.content.substring(0, 300)}...
---`
      )
      .join("\n");

    const prompt = `
You are a search relevance AI. Rank these knowledge base articles by relevance to the user query.

User Query: "${query}"

Available Articles:
${articleSummaries}

Respond with a JSON array of relevant articles, ranked by relevance:
[
  {
    "articleIndex": 0,
    "relevanceScore": 95,
    "matchedContent": "Brief excerpt explaining why this is relevant"
  }
]

Only include articles with relevance score >= 30. Limit to top ${maxResults} results.`;

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (responseBody.content && responseBody.content[0]?.text) {
      const rankingsText = responseBody.content[0].text;
      const rankings = JSON.parse(rankingsText);

      return rankings.map((ranking: any) => ({
        article: articles[ranking.articleIndex],
        relevanceScore: ranking.relevanceScore,
        matchedContent: ranking.matchedContent,
      }));
    }

    return await basicKnowledgeSearch(query, category, maxResults);
  } catch (error) {
    console.error(
      "Intelligent search error, falling back to basic search:",
      error
    );
    return await basicKnowledgeSearch(query, category, maxResults);
  }
};

// Fallback basic search function
const basicKnowledgeSearch = async (
  query: string,
  category?: string,
  maxResults: number = 10
): Promise<
  Array<{
    article: any;
    relevanceScore: number;
    matchedContent: string;
  }>
> => {
  try {
    const articles = await storage.searchKnowledgeBase(query, category);

    return articles.slice(0, maxResults).map((article) => ({
      article,
      relevanceScore: 50, // Default score for basic search
      matchedContent: article.content.substring(0, 200) + "...",
    }));
  } catch (error) {
    console.error("Basic knowledge search error:", error);
    return [];
  }
};

// Schedule periodic knowledge learning
export const scheduleKnowledgeLearning = () => {
  // Run knowledge learning every 24 hours
  setInterval(async () => {
    console.log("Starting scheduled knowledge learning...");
    await processKnowledgeLearning();
  }, 24 * 60 * 60 * 1000);

  console.log("Knowledge learning scheduler initialized (runs every 24 hours)");
};

// Improve existing article based on new resolution data
export const improveKnowledgeArticle = async (
  articleId: number,
  newResolutionData: {
    ticketId: number;
    resolution: string;
    resolutionTime: number;
    success: boolean;
  }
): Promise<boolean> => {
  const client = getBedrockClient();
  if (!client) return false;

  try {
    const article = await storage.getKnowledgeArticle(articleId);
    if (!article) return false;

    const prompt = `
You are improving a knowledge base article based on new resolution data. 

Current Article:
Title: ${article.title}
Content: ${article.content}

New Resolution Data:
Resolution: ${newResolutionData.resolution}
Time taken: ${newResolutionData.resolutionTime} hours
Success: ${newResolutionData.success}

Suggest improvements to make the article more helpful. Respond with JSON:
{
  "shouldUpdate": true/false,
  "improvedContent": "Updated article content if improvements needed",
  "improvementReason": "Brief explanation of what was improved",
  "confidence": confidence_score_0_to_100
}

Only suggest updates if the new data provides valuable insights not already covered.`;

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (responseBody.content && responseBody.content[0]?.text) {
      const improvementText = responseBody.content[0].text;
      const improvement = JSON.parse(improvementText);

      if (improvement.shouldUpdate && improvement.confidence >= 70) {
        await storage.updateKnowledgeArticle(articleId, {
          content: improvement.improvedContent,
          updatedAt: new Date(),
        });

        console.log(
          `Improved knowledge article ${articleId}: ${improvement.improvementReason}`
        );
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Article improvement error:", error);
    return false;
  }
};
