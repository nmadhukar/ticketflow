import { db } from "../../storage/db";
import {
  tasks,
  ticketAutoResponses,
  knowledgeArticles,
  ticketComplexityScores,
  taskComments,
  learningQueue,
} from "@shared/schema";
import { eq, desc, sql, and, or, ilike } from "drizzle-orm";
import type {
  Task,
  InsertTicketAutoResponse,
  InsertTicketComplexityScore,
} from "@shared/schema";
import { bedrockIntegration } from "./bedrockIntegration";
import { knowledgeBaseService } from "./knowledgeBase";

interface ComplexityFactors {
  keywords: number;
  urgency: number;
  technical: number;
  historical: number;
  sentiment: number;
}

export class AIAutoResponseService {
  constructor() {
    // Initialize Bedrock client on service creation
    bedrockIntegration.initialize();
  }

  async analyzeTicket(ticket: Task): Promise<{
    autoResponse: string | null;
    confidence: number;
    complexity: number;
    factors: ComplexityFactors;
    shouldEscalate: boolean;
  }> {
    try {
      // Search for similar resolved tickets
      const similarTickets = await this.findSimilarResolvedTickets(
        ticket.title,
        ticket.description || ""
      );

      // Search knowledge base
      const relevantArticles = await this.searchKnowledgeBase(
        ticket.title,
        ticket.description || ""
      );

      // Use Bedrock to analyze the ticket
      const analysis = await bedrockIntegration.analyzeTicket(ticket);

      // Generate AI response using Bedrock
      const responseResult = await bedrockIntegration.generateResponse(
        ticket,
        relevantArticles
      );

      // Calculate confidence using Bedrock
      const confidenceResult = await bedrockIntegration.calculateConfidence(
        ticket,
        relevantArticles.length,
        analysis.complexityScore
      );

      // Calculate complexity factors
      const factors = this.calculateComplexityFactors(ticket, similarTickets);

      // Store the AI response in the database
      if (responseResult.response && confidenceResult.confidenceScore > 0) {
        await this.storeAutoResponse(ticket.id, {
          response: responseResult.response,
          confidence: confidenceResult.confidenceScore,
          suggestedArticles: responseResult.suggestedArticles,
          applied: confidenceResult.shouldAutoRespond,
        });
      }

      return {
        autoResponse: responseResult.response,
        confidence: confidenceResult.confidenceScore,
        complexity: analysis.complexityScore,
        factors,
        shouldEscalate: !confidenceResult.shouldAutoRespond,
      };
    } catch (error) {
      console.error("Error analyzing ticket:", error);
      return {
        autoResponse: null,
        confidence: 0,
        complexity: 50,
        factors: {
          keywords: 0,
          urgency: 0,
          technical: 0,
          historical: 0,
          sentiment: 0,
        },
        shouldEscalate: true,
      };
    }
  }

  private async findSimilarResolvedTickets(
    title: string,
    description: string,
    limit = 5
  ): Promise<any[]> {
    try {
      // Search for similar tickets by title and description
      const searchTerms = `${title} ${description}`
        .toLowerCase()
        .split(" ")
        .filter((term) => term.length > 3);

      const conditions = searchTerms.map((term) =>
        or(
          ilike(tasks.title, `%${term}%`),
          ilike(tasks.description, `%${term}%`)
        )
      );

      const similarTickets = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          resolution: sql<string>`NULL`, // We'll need to add a resolution field later
          category: tasks.category,
          tags: tasks.tags,
        })
        .from(tasks)
        .where(and(eq(tasks.status, "resolved"), or(...conditions)))
        .orderBy(desc(tasks.updatedAt))
        .limit(limit);

      // Get comments for resolution details
      for (const ticket of similarTickets) {
        const comments = await db
          .select()
          .from(taskComments)
          .where(eq(taskComments.taskId, ticket.id))
          .orderBy(desc(taskComments.createdAt))
          .limit(3);

        ticket.resolution = comments.map((c) => c.content).join("\n");
      }

      return similarTickets;
    } catch (error) {
      console.error("Error finding similar tickets:", error);
      return [];
    }
  }

  private async searchKnowledgeBase(
    title: string,
    description: string,
    limit = 3
  ): Promise<any[]> {
    try {
      const semanticResults = await knowledgeBaseService.semanticSearch(
        `${title} ${description}`,
        limit
      );

      if (semanticResults.length > 0) {
        // Update usage count for accessed articles
        for (const result of semanticResults) {
          await db
            .update(knowledgeArticles)
            .set({
              usageCount: sql`${knowledgeArticles.usageCount} + 1`,
            })
            .where(eq(knowledgeArticles.id, result.article.id));
        }

        return semanticResults.map((r) => r.article);
      }

      // Fallback to keyword search if semantic search fails
      const searchTerms = `${title} ${description}`
        .toLowerCase()
        .split(" ")
        .filter((term) => term.length > 3);

      const conditions = searchTerms.map((term) =>
        or(
          ilike(knowledgeArticles.title, `%${term}%`),
          ilike(knowledgeArticles.content, `%${term}%`),
          sql`${knowledgeArticles.tags}::text ILIKE ${"%" + term + "%"}`
        )
      );

      const articles = await db
        .select()
        .from(knowledgeArticles)
        .where(and(eq(knowledgeArticles.isPublished, true), or(...conditions)))
        .orderBy(
          desc(knowledgeArticles.effectivenessScore),
          desc(knowledgeArticles.usageCount)
        )
        .limit(limit);

      // Increment usage count
      for (const article of articles) {
        await db
          .update(knowledgeArticles)
          .set({ usageCount: sql`${knowledgeArticles.usageCount} + 1` })
          .where(eq(knowledgeArticles.id, article.id));
      }

      return articles;
    } catch (error) {
      console.error("Error searching knowledge base:", error);
      return [];
    }
  }

  private calculateComplexityFactors(
    ticket: Task,
    similarTickets: any[]
  ): ComplexityFactors {
    const factors: ComplexityFactors = {
      keywords: 0,
      urgency: 0,
      technical: 0,
      historical: 0,
      sentiment: 0,
    };

    // Urgency based on priority and severity
    const urgencyMap = {
      urgent: 30,
      high: 20,
      medium: 10,
      low: 5,
    };
    factors.urgency =
      urgencyMap[ticket.priority as keyof typeof urgencyMap] || 10;

    // Technical complexity based on keywords
    const technicalKeywords = [
      "api",
      "integration",
      "database",
      "error",
      "crash",
      "performance",
      "security",
      "authentication",
      "authorization",
      "deployment",
      "migration",
    ];
    const text = `${ticket.title} ${ticket.description}`.toLowerCase();
    factors.technical =
      technicalKeywords.filter((keyword) => text.includes(keyword)).length * 10;

    // Historical complexity (no similar resolved tickets)
    factors.historical = similarTickets.length === 0 ? 30 : 0;

    // Keyword complexity
    const complexKeywords = [
      "complex",
      "difficult",
      "urgent",
      "critical",
      "broken",
      "down",
    ];
    factors.keywords =
      complexKeywords.filter((keyword) => text.includes(keyword)).length * 15;

    return factors;
  }

  private async storeAutoResponse(
    ticketId: number,
    response: {
      response: string;
      confidence: number;
      suggestedArticles: number[];
      applied: boolean;
    }
  ): Promise<void> {
    try {
      const autoResponse: InsertTicketAutoResponse = {
        ticketId,
        aiResponse: response.response,
        confidenceScore: response.confidence.toString(),
        // suggestedArticles: response.suggestedArticles,
        wasApplied: response.applied,
        respondedBy: "system",
      };

      await db.insert(ticketAutoResponses).values(autoResponse);
    } catch (error) {
      console.error("Error storing auto response:", error);
    }
  }

  // Knowledge base learning method for resolved tickets
  async updateKnowledgeBase(ticket: Task, resolution: string): Promise<void> {
    try {
      const knowledge = await bedrockIntegration.updateKnowledgeBase(
        ticket,
        resolution
      );

      // Store the extracted knowledge in the database
      await db.insert(knowledgeArticles).values({
        title: knowledge.title,
        summary: knowledge.summary,
        content: knowledge.content,
        category: knowledge.category,
        tags: knowledge.tags,
        // sourceTicketIds: [ticket.id],
        // status: "draft",
        // createdBy: "system",
        // updatedBy: "system",
      });

      console.log(
        `Knowledge article created from ticket #${ticket.ticketNumber}`
      );
    } catch (error) {
      console.error("Error updating knowledge base:", error);
    }
  }

  async saveAutoResponse(
    ticketId: number,
    response: string,
    confidence: number,
    applied: boolean = false
  ): Promise<void> {
    try {
      const autoResponse: InsertTicketAutoResponse = {
        ticketId,
        aiResponse: response,
        confidenceScore: confidence.toString(),
        wasApplied: applied,
      };

      await db.insert(ticketAutoResponses).values(autoResponse);
    } catch (error) {
      console.error("Error saving auto response:", error);
    }
  }

  async saveComplexityScore(
    ticketId: number,
    score: number,
    factors: ComplexityFactors,
    analysis?: string
  ): Promise<void> {
    try {
      const complexityScore: InsertTicketComplexityScore = {
        ticketId,
        complexityScore: score,
        factors,
        aiAnalysis: analysis,
      };

      await db
        .insert(ticketComplexityScores)
        .values(complexityScore)
        .onConflictDoUpdate({
          target: ticketComplexityScores.ticketId,
          set: {
            complexityScore: score,
            factors,
            aiAnalysis: analysis,
            calculatedAt: sql`NOW()`,
          },
        });
    } catch (error) {
      console.error("Error saving complexity score:", error);
    }
  }

  async updateResponseEffectiveness(
    ticketId: number,
    wasHelpful: boolean
  ): Promise<void> {
    try {
      await db
        .update(ticketAutoResponses)
        .set({ wasHelpful })
        .where(eq(ticketAutoResponses.ticketId, ticketId));
    } catch (error) {
      console.error("Error updating response effectiveness:", error);
    }
  }
}

export const aiAutoResponseService = new AIAutoResponseService();

// Export individual functions for testing
export const analyzeTicket = (ticket: Task) =>
  aiAutoResponseService.analyzeTicket(ticket);

export const generateAutoResponse = (
  ticket: Task,
  knowledgeContext: any[],
  settings?: any
) => aiAutoResponseService.analyzeTicket(ticket);
export const calculateConfidence = (
  ticket: Task,
  response: string,
  knowledgeMatches: any[]
) => {
  // Simplified confidence calculation for testing
  const hasKeywords = [
    "login",
    "password",
    "authentication",
    "connection",
  ].some(
    (keyword) =>
      ticket.title.toLowerCase().includes(keyword) ||
      (ticket.description || "").toLowerCase().includes(keyword)
  );

  const baseConfidence = hasKeywords ? 0.7 : 0.4;
  const knowledgeBoost = Math.min(knowledgeMatches.length * 0.1, 0.3);
  const lengthPenalty = response.length < 50 ? -0.2 : 0;

  return Math.max(
    0,
    Math.min(1, baseConfidence + knowledgeBoost + lengthPenalty)
  );
};
