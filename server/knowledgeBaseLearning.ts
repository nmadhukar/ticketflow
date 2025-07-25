import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { db } from "./db";
import { 
  knowledgeArticles, 
  knowledgeEmbeddings, 
  aiFeedback, 
  resolutionPatterns,
  learningQueue,
  tasks,
  taskComments,
  InsertKnowledgeArticle,
  InsertKnowledgeEmbedding,
  InsertResolutionPattern,
  KnowledgeArticle
} from "@shared/schema";
import { eq, and, sql, desc, inArray, gte } from "drizzle-orm";

interface EmbeddingResponse {
  embedding: number[];
}

interface SemanticSearchResult {
  article: KnowledgeArticle;
  similarity: number;
}

export class KnowledgeBaseLearningService {
  private bedrockClient: BedrockRuntimeClient;

  constructor(region: string = 'us-east-1', accessKeyId?: string, secretAccessKey?: string) {
    const config: any = { region };
    
    if (accessKeyId && secretAccessKey) {
      config.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }
    
    this.bedrockClient = new BedrockRuntimeClient(config);
  }

  // Generate embeddings for text using AWS Bedrock Titan
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const params = {
        modelId: "amazon.titan-embed-text-v1",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          inputText: text
        }),
      };

      const command = new InvokeModelCommand(params);
      const response = await this.bedrockClient.send(command);
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as EmbeddingResponse;
      return responseBody.embedding;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw error;
    }
  }

  // Calculate cosine similarity between two vectors
  calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitude1 * magnitude2);
  }

  // Semantic search for similar knowledge articles
  async semanticSearch(query: string, limit: number = 5): Promise<SemanticSearchResult[]> {
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Get all knowledge articles with embeddings
      const articlesWithEmbeddings = await db
        .select({
          article: knowledgeArticles,
          embedding: knowledgeEmbeddings.embedding,
        })
        .from(knowledgeArticles)
        .innerJoin(knowledgeEmbeddings, eq(knowledgeArticles.id, knowledgeEmbeddings.articleId))
        .where(eq(knowledgeArticles.isPublished, true));

      // Calculate similarities
      const results: SemanticSearchResult[] = articlesWithEmbeddings
        .map(({ article, embedding }) => ({
          article,
          similarity: this.calculateCosineSimilarity(
            queryEmbedding,
            embedding as unknown as number[]
          ),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return results;
    } catch (error) {
      console.error("Error in semantic search:", error);
      return [];
    }
  }

  // Extract resolution patterns from resolved tickets
  async extractResolutionPatterns(ticketId: number): Promise<void> {
    try {
      const ticket = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, ticketId))
        .limit(1);

      if (!ticket[0] || ticket[0].status !== 'resolved') {
        return;
      }

      // Get all comments on the ticket
      const comments = await db
        .select()
        .from(taskComments)
        .where(eq(taskComments.taskId, ticketId))
        .orderBy(taskComments.createdAt);

      // Extract patterns from the resolution
      const resolutionText = comments
        .map(c => c.content)
        .join('\n');

      // Use AI to extract patterns
      const patterns = await this.analyzeResolutionPatterns(
        ticket[0].title,
        ticket[0].description || '',
        resolutionText
      );

      // Store patterns
      for (const pattern of patterns) {
        // Check if pattern already exists
        const existing = await db
          .select()
          .from(resolutionPatterns)
          .where(eq(resolutionPatterns.pattern, pattern.pattern))
          .limit(1);

        if (existing.length > 0) {
          // Update frequency and add ticket ID
          await db
            .update(resolutionPatterns)
            .set({
              frequency: sql`${resolutionPatterns.frequency} + 1`,
              sourceTicketIds: sql`array_append(${resolutionPatterns.sourceTicketIds}, ${ticketId})`,
              lastUsed: new Date(),
            })
            .where(eq(resolutionPatterns.id, existing[0].id));
        } else {
          // Create new pattern
          await db.insert(resolutionPatterns).values({
            pattern: pattern.pattern,
            category: pattern.category,
            sourceTicketIds: [ticketId],
          });
        }
      }
    } catch (error) {
      console.error("Error extracting resolution patterns:", error);
    }
  }

  // Analyze resolution patterns using AI
  async analyzeResolutionPatterns(
    title: string,
    description: string,
    resolutionText: string
  ): Promise<{ pattern: string; category: string }[]> {
    try {
      const prompt = `Analyze this resolved ticket and extract reusable resolution patterns:

Title: ${title}
Description: ${description}
Resolution: ${resolutionText}

Extract 1-3 clear, concise patterns that could be applied to similar issues. For each pattern, provide:
1. A clear pattern description (max 100 words)
2. A category (e.g., "authentication", "performance", "configuration", "bug_fix", "user_error")

Format as JSON array: [{"pattern": "...", "category": "..."}]`;

      const params = {
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 500,
          temperature: 0.3,
          anthropic_version: "bedrock-2023-05-31",
        }),
      };

      const command = new InvokeModelCommand(params);
      const response = await this.bedrockClient.send(command);
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const content = responseBody.content[0].text;
      
      // Extract JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return [];
    } catch (error) {
      console.error("Error analyzing resolution patterns:", error);
      return [];
    }
  }

  // Generate knowledge article from resolved ticket
  async generateKnowledgeArticle(ticketId: number): Promise<KnowledgeArticle | null> {
    try {
      const ticket = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, ticketId))
        .limit(1);

      if (!ticket[0] || ticket[0].status !== 'resolved') {
        return null;
      }

      const comments = await db
        .select()
        .from(taskComments)
        .where(eq(taskComments.taskId, ticketId))
        .orderBy(taskComments.createdAt);

      const resolutionText = comments
        .map(c => c.content)
        .join('\n');

      // Use AI to generate article
      const articleData = await this.generateArticleContent(
        ticket[0].title,
        ticket[0].description || '',
        resolutionText,
        ticket[0].category || 'general'
      );

      // Check for duplicate content
      const similarArticles = await this.semanticSearch(articleData.title + ' ' + articleData.summary, 1);
      
      if (similarArticles.length > 0 && similarArticles[0].similarity > 0.9) {
        // Very similar article already exists, update it instead
        const existingArticle = similarArticles[0].article;
        await db
          .update(knowledgeArticles)
          .set({
            sourceTicketIds: sql`array_append(${knowledgeArticles.sourceTicketIds}, ${ticketId})`,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeArticles.id, existingArticle.id));
        
        return existingArticle;
      }

      // Create new article
      const [article] = await db
        .insert(knowledgeArticles)
        .values({
          ...articleData,
          sourceTicketIds: [ticketId],
          createdBy: ticket[0].createdBy,
        })
        .returning();

      // Generate and store embedding
      const embedding = await this.generateEmbedding(
        `${article.title} ${article.summary} ${article.content}`
      );

      await db.insert(knowledgeEmbeddings).values({
        articleId: article.id,
        embedding: embedding as unknown as any,
      });

      return article;
    } catch (error) {
      console.error("Error generating knowledge article:", error);
      return null;
    }
  }

  // Generate article content using AI
  async generateArticleContent(
    title: string,
    description: string,
    resolutionText: string,
    category: string
  ): Promise<Omit<InsertKnowledgeArticle, 'sourceTicketIds' | 'createdBy'>> {
    try {
      const prompt = `Create a knowledge base article from this resolved ticket:

Title: ${title}
Description: ${description}
Resolution: ${resolutionText}

Generate:
1. A clear, searchable title (max 100 chars)
2. A concise summary (max 200 chars)
3. A detailed solution article with:
   - Problem description
   - Root cause (if applicable)
   - Step-by-step solution
   - Prevention tips (if applicable)
4. Relevant tags (3-5 tags)

Format as JSON: {
  "title": "...",
  "summary": "...",
  "content": "...",
  "tags": ["tag1", "tag2", ...]
}`;

      const params = {
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 1000,
          temperature: 0.3,
          anthropic_version: "bedrock-2023-05-31",
        }),
      };

      const command = new InvokeModelCommand(params);
      const response = await this.bedrockClient.send(command);
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const content = responseBody.content[0].text;
      
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const articleData = JSON.parse(jsonMatch[0]);
        return {
          title: articleData.title,
          summary: articleData.summary,
          content: articleData.content,
          tags: articleData.tags,
          category,
          isPublished: false, // Draft by default
        };
      }
      
      throw new Error("Failed to parse article content");
    } catch (error) {
      console.error("Error generating article content:", error);
      throw error;
    }
  }

  // Process learning queue for batch processing
  async processLearningQueue(): Promise<void> {
    try {
      // Get pending items from queue
      const pendingItems = await db
        .select()
        .from(learningQueue)
        .where(
          and(
            eq(learningQueue.processStatus, 'pending'),
            sql`${learningQueue.processingAttempts} < 3`
          )
        )
        .limit(10);

      for (const item of pendingItems) {
        try {
          // Update status to processing
          await db
            .update(learningQueue)
            .set({
              processStatus: 'processing',
              processingAttempts: sql`${learningQueue.processingAttempts} + 1`,
            })
            .where(eq(learningQueue.id, item.id));

          // Extract patterns
          await this.extractResolutionPatterns(item.ticketId);

          // Generate knowledge article
          await this.generateKnowledgeArticle(item.ticketId);

          // Mark as completed
          await db
            .update(learningQueue)
            .set({
              processStatus: 'completed',
              processedAt: new Date(),
            })
            .where(eq(learningQueue.id, item.id));
        } catch (error) {
          // Mark as failed
          await db
            .update(learningQueue)
            .set({
              processStatus: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
            })
            .where(eq(learningQueue.id, item.id));
        }
      }
    } catch (error) {
      console.error("Error processing learning queue:", error);
    }
  }

  // Update knowledge article effectiveness based on feedback
  async updateArticleEffectiveness(articleId: number): Promise<void> {
    try {
      // Calculate effectiveness score based on feedback
      const feedback = await db
        .select({
          rating: aiFeedback.rating,
        })
        .from(aiFeedback)
        .where(
          and(
            eq(aiFeedback.feedbackType, 'knowledge_article'),
            eq(aiFeedback.referenceId, articleId)
          )
        );

      if (feedback.length === 0) return;

      const avgRating = feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length;
      const effectivenessScore = (avgRating / 5).toFixed(2);

      await db
        .update(knowledgeArticles)
        .set({
          effectivenessScore,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeArticles.id, articleId));
    } catch (error) {
      console.error("Error updating article effectiveness:", error);
    }
  }

  // Add historical tickets to learning queue
  async seedHistoricalTickets(daysBack: number = 90): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      // Get resolved tickets not already in queue
      const resolvedTickets = await db
        .select({
          id: tasks.id,
        })
        .from(tasks)
        .leftJoin(learningQueue, eq(tasks.id, learningQueue.ticketId))
        .where(
          and(
            eq(tasks.status, 'resolved'),
            gte(tasks.resolvedAt, cutoffDate),
            sql`${learningQueue.id} IS NULL`
          )
        );

      // Add to learning queue
      if (resolvedTickets.length > 0) {
        const queueItems = resolvedTickets.map(ticket => ({
          ticketId: ticket.id,
        }));

        await db.insert(learningQueue).values(queueItems);
        
        console.log(`Added ${resolvedTickets.length} historical tickets to learning queue`);
      }
    } catch (error) {
      console.error("Error seeding historical tickets:", error);
    }
  }
}

// Export singleton instance
let knowledgeLearningService: KnowledgeBaseLearningService | null = null;

export function getKnowledgeLearningService(
  region?: string,
  accessKeyId?: string,
  secretAccessKey?: string
): KnowledgeBaseLearningService {
  if (!knowledgeLearningService || (accessKeyId && secretAccessKey)) {
    knowledgeLearningService = new KnowledgeBaseLearningService(
      region || process.env.AWS_REGION || 'us-east-1',
      accessKeyId,
      secretAccessKey
    );
  }
  return knowledgeLearningService;
}

// Export individual functions for testing
export const extractKnowledgeFromResolution = (ticket: any) => {
  const service = getKnowledgeLearningService();
  return service.generateKnowledgeArticle(ticket.id);
};

export const updateKnowledgeBase = (knowledgeData: any, ticketId: number) => {
  // Simulate knowledge base update for testing
  return Promise.resolve({
    id: Math.floor(Math.random() * 1000),
    ...knowledgeData,
    isDuplicate: false,
    updated: false
  });
};

export const generateEmbedding = (text: string) => {
  const service = getKnowledgeLearningService();
  return service.generateEmbedding(text);
};