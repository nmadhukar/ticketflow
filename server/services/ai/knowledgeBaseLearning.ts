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

import { storage } from "../../storage";
import { logSecurityEvent } from "../../security";
import type { Task } from "@shared/schema";
import { db } from "../../storage/db";
import { learningQueue } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  buildImproveKnowledgeArticlePrompt,
  buildKnowledgeArticlePrompt,
  buildKnowledgeSearchRankingPrompt,
  buildResolvedTicketsPatternPrompt,
} from "./prompts";
import {
  getBedrockClient,
  runKnowledgeImproveArticlePrompt,
  runKnowledgePatternAnalysisPrompt,
  runKnowledgePatternPrompt,
  runKnowledgeSearchPrompt,
} from "./bedrockIntegration";
import { loadCostLimits, estimateTokens } from "./costMonitoring";

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
  const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();
  if (!bedrockClient || !modelId || ticketBatch.length === 0) return [];

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

    const prompt = buildResolvedTicketsPatternPrompt(ticketSummaries);
    const result = await runKnowledgePatternAnalysisPrompt(prompt);

    const patterns = JSON.parse(result.response) as ResolutionPattern[];

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
  const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();
  if (!bedrockClient || !modelId) return null;

  try {
    const prompt = buildKnowledgeArticlePrompt(pattern);
    const result = await runKnowledgePatternPrompt(prompt);

    const articleData = JSON.parse(result.response) as KnowledgeArticle;

    const article: KnowledgeArticle = {
      ...articleData,
      relatedTickets,
      isPublished: false,
      createdBy: "ai-learning",
    };

    return article;
  } catch (error) {
    console.error("Knowledge article generation error:", error);
    return null;
  }
};

/**
 * Process enriched tickets in batches based on token limits
 * @param enrichedTickets - Array of enriched ticket data
 * @param totalTicketsCount - Total number of tickets (for logging)
 * @returns Array of resolution patterns found
 */
async function processTicketsInBatches(
  enrichedTickets: Array<{
    id: number;
    title: string;
    description: string;
    category: string;
    priority: string;
    resolution: string;
    resolutionTime: number;
    comments: Array<{ content: string; userId: string; createdAt: Date }>;
  }>,
  totalTicketsCount: number
): Promise<ResolutionPattern[]> {
  // Calculate dynamic batch size based on maxTokensPerRequest
  const limits = loadCostLimits();
  const maxTokensPerRequest = limits.maxTokensPerRequest || 2000;

  // Estimate tokens for base prompt (without tickets)
  const basePrompt = buildResolvedTicketsPatternPrompt("");
  const basePromptTokens = estimateTokens(basePrompt);

  // Reserve tokens for: base prompt + output response (estimate 500 tokens for JSON output)
  const reservedTokens = basePromptTokens + 500;
  const availableTokens = maxTokensPerRequest - reservedTokens;

  // Estimate tokens per ticket by building a sample ticket summary
  let batchSize = 3; // Default fallback
  if (enrichedTickets.length > 0 && availableTokens > 0) {
    const sampleTicket = enrichedTickets[0];
    const sampleSummary = `
Ticket ${sampleTicket.id}:
Title: ${sampleTicket.title}
Category: ${sampleTicket.category}
Priority: ${sampleTicket.priority}
Problem: ${sampleTicket.description}
Resolution: ${sampleTicket.resolution}
Time to resolve: ${sampleTicket.resolutionTime} hours
Comments: ${sampleTicket.comments.map((c) => c.content).join("; ")}
---`;
    const tokensPerTicket = estimateTokens(sampleSummary);

    // Calculate batch size (ensure at least 1, but respect limits)
    const calculatedBatchSize = Math.max(
      1,
      Math.floor(availableTokens / tokensPerTicket)
    );

    // Cap batch size to reasonable limits (min 2 for pattern detection, max 10 for quality)
    batchSize = Math.max(2, Math.min(calculatedBatchSize, 10));

    console.log(
      `📊 Token budget: ${maxTokensPerRequest} total, ${reservedTokens} reserved, ` +
        `~${tokensPerTicket} per ticket → Processing ${totalTicketsCount} tickets in batches of ${batchSize}`
    );
  }

  // Process tickets in batches
  const allPatterns: ResolutionPattern[] = [];
  for (let i = 0; i < enrichedTickets.length; i += batchSize) {
    const batch = enrichedTickets.slice(i, i + batchSize);

    try {
      const patterns = await analyzeResolvedTickets(batch);
      allPatterns.push(...patterns);
      console.log(
        `  ✓ Batch ${Math.floor(i / batchSize) + 1}: Analyzed ${
          batch.length
        } tickets, found ${patterns.length} patterns`
      );
    } catch (error: any) {
      // If batch still fails due to token limits, try smaller batch
      if (error.isBlocked && error.message.includes("max tokens")) {
        console.warn(
          `  ⚠ Batch ${Math.floor(i / batchSize) + 1} still too large. ` +
            `Trying individual tickets...`
        );

        // Fallback: process tickets individually
        for (const singleTicket of batch) {
          try {
            const singlePatterns = await analyzeResolvedTickets([singleTicket]);
            allPatterns.push(...singlePatterns);
          } catch (singleError: any) {
            console.error(
              `  ✗ Failed to analyze ticket ${singleTicket.id}: ${
                singleError.message || "Unknown error"
              }`
            );
          }
        }
      } else {
        console.error(
          `  ✗ Batch ${Math.floor(i / batchSize) + 1} failed: ${
            error.message || "Unknown error"
          }`
        );
      }
    }
  }

  return allPatterns;
}

// Main learning process - analyze recent resolved tickets
export const processKnowledgeLearning = async (options?: {
  startDate?: Date;
  endDate?: Date;
  useQueueItems?: boolean;
}): Promise<{
  patternsFound: number;
  articlesCreated: number;
  articlesPublished: number;
}> => {
  // Declare queueItems outside try block so it's accessible in catch block
  let queueItems: Array<{ id: number; ticketId: number }> = [];

  try {
    // Get resolved tickets - either from queue or directly
    let recentResolvedTickets: Task[];

    if (options?.useQueueItems) {
      // Get pending items from learning queue
      const pendingQueueItems = await storage.getLearningQueueItems("pending");
      console.log(
        `Processing ${pendingQueueItems.length} tickets from learning queue`
      );

      if (pendingQueueItems.length === 0) {
        console.log("No pending items in learning queue");
        return {
          patternsFound: 0,
          articlesCreated: 0,
          articlesPublished: 0,
        };
      }

      // Update queue items to "processing" status
      for (const queueItem of pendingQueueItems) {
        await storage.updateLearningQueueItem(queueItem.id, {
          processStatus: "processing",
          processingAttempts: (queueItem.processingAttempts || 0) + 1,
        });
      }

      // Get ticket IDs from queue items
      const ticketIds = pendingQueueItems.map((item) => item.ticketId);
      queueItems = pendingQueueItems.map((item) => ({
        id: item.id,
        ticketId: item.ticketId,
      }));

      // Fetch tickets by IDs
      const tickets = await Promise.all(
        ticketIds.map(async (ticketId) => {
          const task = await storage.getTask(ticketId);
          return task;
        })
      );

      recentResolvedTickets = tickets.filter(
        (ticket): ticket is Task =>
          ticket !== null &&
          ticket !== undefined &&
          ticket.status === "resolved"
      );

      console.log(
        `Found ${recentResolvedTickets.length} resolved tickets from queue`
      );
    } else if (options?.startDate && options?.endDate) {
      recentResolvedTickets = await storage.getResolvedTicketsByDateRange(
        options.startDate,
        options.endDate
      );
      console.log(
        `Processing resolved tickets from ${options.startDate.toISOString()} to ${options.endDate.toISOString()}`
      );
    } else {
      // Default: Get recently resolved tickets (last 30 days)
      recentResolvedTickets = await storage.getRecentResolvedTickets(30);
    }

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

      // Enrich tickets with comments and resolution data
      const enrichedTickets = await Promise.all(
        tickets.map(async (ticket) => {
          // Fetch comments for this ticket
          const comments = await storage.getTaskComments(ticket.id!);

          // Calculate resolution time (hours between created and resolved)
          const resolutionTime = ticket.resolvedAt
            ? Math.max(
                1,
                Math.round(
                  (ticket.resolvedAt.getTime() -
                    (ticket.createdAt?.getTime() || Date.now())) /
                    (1000 * 60 * 60)
                )
              )
            : 4; // Default to 4 hours if no resolvedAt

          // Extract resolution from last few comments (typically contain the solution)
          const resolutionComments = comments.slice(-3);
          const resolution =
            resolutionComments
              .map((c) => c.content)
              .join("\n\n")
              .trim() ||
            ticket.notes ||
            "Issue resolved";

          return {
            id: ticket.id!,
            title: ticket.title,
            description: ticket.description || "",
            category: ticket.category,
            priority: ticket.priority,
            resolution,
            resolutionTime,
            comments: comments.map((c) => ({
              content: c.content,
              userId: c.userId,
              createdAt: c.createdAt || new Date(),
            })),
          };
        })
      );

      // Process tickets in batches using private function
      const categoryPatterns = await processTicketsInBatches(
        enrichedTickets,
        tickets.length
      );

      totalPatterns += categoryPatterns.length;

      // Generate articles for significant patterns
      for (const pattern of categoryPatterns) {
        if (pattern.frequency >= 3 && pattern.successRate >= 70) {
          const relatedTicketIds = tickets
            .filter(
              (t) =>
                t.title
                  .toLowerCase()
                  .includes(pattern.problemType.toLowerCase()) ||
                t.description ||
                "".toLowerCase().includes(pattern.problemType.toLowerCase())
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

    // If processing from queue, mark all queue items as completed
    if (options?.useQueueItems && queueItems.length > 0) {
      const queueItemIds = queueItems.map((item) => item.id);
      await db
        .update(learningQueue)
        .set({
          processStatus: "completed",
          processedAt: new Date(),
        })
        .where(inArray(learningQueue.id, queueItemIds));
      console.log(`Marked ${queueItems.length} queue items as completed`);
    }

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

    // If processing from queue, mark queue items as failed
    if (options?.useQueueItems && queueItems.length > 0) {
      const queueItemIds = queueItems.map((item) => item.id);
      await db
        .update(learningQueue)
        .set({
          processStatus: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
        .where(inArray(learningQueue.id, queueItemIds));
      console.log(`Marked ${queueItems.length} queue items as failed`);
    }

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
  const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();
  if (!bedrockClient || !modelId) {
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

    const prompt = buildKnowledgeSearchRankingPrompt(
      query,
      articleSummaries,
      maxResults
    );

    const result = await runKnowledgeSearchPrompt(prompt);

    const rankings = JSON.parse(result.response) as any[];

    if (rankings.length > 0) {
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
  const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();
  if (!bedrockClient || !modelId) return false;

  try {
    const article = await storage.getKnowledgeArticle(articleId);
    if (!article) return false;

    const prompt = buildImproveKnowledgeArticlePrompt(
      { title: article.title, content: article.content },
      {
        resolution: newResolutionData.resolution,
        resolutionTime: newResolutionData.resolutionTime,
        success: newResolutionData.success,
      }
    );

    const result = await runKnowledgeImproveArticlePrompt(prompt);

    if (result.response) {
      const improvement = JSON.parse(result.response) as any;

      if (improvement.shouldUpdate && improvement.confidence >= 70) {
        await storage.updateKnowledgeArticle(articleId, {
          content: improvement.improvedContent,
          // updatedAt: new Date(),
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
