import { db } from "../../storage/db";
import {
  tasks,
  ticketAutoResponses,
  knowledgeArticles,
  ticketComplexityScores,
  taskComments,
} from "@shared/schema";
import { eq, desc, sql, and, or, ilike } from "drizzle-orm";
import type {
  Task,
  InsertTicketAutoResponse,
  InsertTicketComplexityScore,
} from "@shared/schema";
import { bedrockIntegration } from "./bedrockIntegration";
import { knowledgeBaseService } from "./knowledgeBase";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { getAISettings } from "../../admin/aiSettings";
import { describeAIError, isQuotaBlocked } from "./aiErrors";
import { containsPattern } from "../../utils/like";

interface ComplexityFactors {
  keywords: number;
  urgency: number;
  technical: number;
  historical: number;
  sentiment: number;
}

export class AIAutoResponseService {
  /**
   * Analyses a ticket and, when it has an id, stores ONE auto-response row for
   * the analysis (this method owns the write; callers must not store another).
   *
   * `shouldAutoRespond` is the one decision, made by calculateConfidence from the
   * admin settings (enabled flag and confidence threshold). The row is ALWAYS stored
   * with wasApplied false and the text already cut to maxResponseLength (the one
   * clamp): whoever posts the comment (create path, or a person via /apply) marks
   * the row applied afterwards, so no row ever claims a comment that does not exist.
   */
  async analyzeTicket(ticket: Task): Promise<{
    autoResponse: string | null;
    confidence: number;
    complexity: number;
    factors: ComplexityFactors;
    shouldEscalate: boolean;
    shouldAutoRespond: boolean;
    autoResponseRowId?: number;
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

      // Store the AI response in the database (only if ticket has an ID)
      const maxLength = Math.max(
        100,
        Math.min(5000, Number((await getAISettings()).maxResponseLength) || 1000)
      );
      const responseText = responseResult.response
        ? responseResult.response.slice(0, maxLength)
        : responseResult.response;

      let autoResponseRowId: number | undefined;
      if (responseText && confidenceResult.confidenceScore > 0 && ticket.id) {
        autoResponseRowId = await this.storeAutoResponse(ticket.id, {
          response: responseText,
          confidence: confidenceResult.confidenceScore,
          suggestedArticles: responseResult.suggestedArticles,
        });
      }

      return {
        autoResponse: responseText,
        confidence: confidenceResult.confidenceScore,
        complexity: analysis.complexityScore,
        factors,
        shouldEscalate: !confidenceResult.shouldAutoRespond,
        shouldAutoRespond: confidenceResult.shouldAutoRespond,
        autoResponseRowId,
      };
    } catch (error) {
      console.error("Error analyzing ticket:", describeAIError(error));
      // A cost-limit block is not "no answer": callers turn it into 429.
      if (isQuotaBlocked(error)) throw error;
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
        shouldAutoRespond: false,
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
          ilike(tasks.title, containsPattern(term)),
          ilike(tasks.description, containsPattern(term))
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
      console.error("Error finding similar tickets:", describeAIError(error));
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
          ilike(knowledgeArticles.title, containsPattern(term)),
          ilike(knowledgeArticles.content, containsPattern(term)),
          sql`${knowledgeArticles.tags}::text ILIKE ${containsPattern(term)}`
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
      console.error("Error searching knowledge base:", describeAIError(error));
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
    }
  ): Promise<number | undefined> {
    try {
      const aiUserId = await ensureAiSystemUser(); // null when its email is taken: row stored unattributed

      const autoResponse: InsertTicketAutoResponse = {
        ticketId,
        aiResponse: response.response,
        confidenceScore: response.confidence.toString(),
        // suggestedArticles: response.suggestedArticles,
        wasApplied: false,
        respondedBy: aiUserId ?? null,
      };

      const [row] = await db
        .insert(ticketAutoResponses)
        .values(autoResponse)
        .returning({ id: ticketAutoResponses.id });
      return row?.id;
    } catch (error) {
      console.error("Error storing auto response:", describeAIError(error));
      return undefined;
    }
  }

  /** Sets wasApplied on one stored row (the create path undoes it when the comment could not be written). */
  async setApplied(rowId: number, applied: boolean): Promise<void> {
    await db
      .update(ticketAutoResponses)
      .set({ wasApplied: applied, appliedAt: applied ? new Date() : null }) // R48: applied_at follows it (a JS time, like resolvedAt)
      .where(eq(ticketAutoResponses.id, rowId));
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
      console.error("Error updating knowledge base:", describeAIError(error));
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
      console.error("Error saving complexity score:", describeAIError(error));
    }
  }

  async updateResponseEffectiveness(
    ticketId: number,
    wasHelpful: boolean
  ): Promise<number> {
    // Returns how many auto-responses were marked; 0 means the ticket has none.
    // A database failure propagates so the caller can answer it honestly.
    const rows = await db
      .update(ticketAutoResponses)
      .set({ wasHelpful })
      .where(eq(ticketAutoResponses.ticketId, ticketId))
      .returning({ id: ticketAutoResponses.id });
    return rows.length;
  }
}

export const aiAutoResponseService = new AIAutoResponseService();

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
