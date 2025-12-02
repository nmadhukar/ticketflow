import { db } from "../../storage/db";
import {
  tasks,
  knowledgeArticles,
  taskComments,
  taskHistory,
} from "@shared/schema";
import { eq, and, ilike, sql } from "drizzle-orm";
import type {
  Task,
  InsertKnowledgeArticle,
  KnowledgeArticle,
} from "@shared/schema";
import { buildCreateKnowledgeArticlePrompt } from "./prompts";
import {
  getBedrockClient,
  runKnowledgeArticleGenerationPrompt,
} from "./bedrockIntegration";

export class KnowledgeBaseService {
  async learnFromResolvedTicket(
    ticketId: number,
    options?: { minScore?: number; requireApproval?: boolean }
  ): Promise<void> {
    try {
      // Get the resolved ticket
      const [ticket] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, ticketId), eq(tasks.status, "resolved")))
        .limit(1);

      if (!ticket) {
        console.log("Ticket not found or not resolved");
        return;
      }

      // Get all comments for resolution details
      const comments = await db
        .select()
        .from(taskComments)
        .where(eq(taskComments.taskId, ticketId))
        .orderBy(taskComments.createdAt);

      // Get history to understand the resolution process
      const history = await db
        .select()
        .from(taskHistory)
        .where(eq(taskHistory.taskId, ticketId))
        .orderBy(taskHistory.createdAt);

      // Extract resolution information
      const resolution = this.extractResolution(ticket, comments, history);

      // Heuristic quality score 0..1 based on content richness
      const solutionLen = (resolution.solution || "").length;
      const stepsLen = (resolution.steps || []).length;
      const richness = Math.min(1, solutionLen / 1500);
      const structure = Math.min(1, stepsLen / 6);
      const qualityScore = Math.max(
        0,
        Math.min(1, richness * 0.7 + structure * 0.3)
      );

      const minScore = Math.max(0, Math.min(1, options?.minScore ?? 0));

      // Check if we should create a knowledge article
      if (resolution.isUseful && qualityScore >= minScore) {
        await this.createKnowledgeArticle(
          ticket,
          resolution,
          options?.requireApproval === true
        );
      }
    } catch (error) {
      console.error("Error learning from resolved ticket:", error);
    }
  }

  private extractResolution(
    ticket: Task,
    comments: any[],
    history: any[]
  ): {
    isUseful: boolean;
    problem: string;
    solution: string;
    steps: string[];
    tags: string[];
  } {
    // Find resolution comments (last few comments typically contain the solution)
    const resolutionComments = comments.slice(-3);

    // Check if ticket has meaningful resolution
    const hasDetailedResolution = resolutionComments.some(
      (c) =>
        c.content.length > 50 &&
        (c.content.toLowerCase().includes("fixed") ||
          c.content.toLowerCase().includes("resolved") ||
          c.content.toLowerCase().includes("solution"))
    );

    if (!hasDetailedResolution || comments.length < 2) {
      return {
        isUseful: false,
        problem: "",
        solution: "",
        steps: [],
        tags: [],
      };
    }

    // Extract problem description
    const problem = `${ticket.title}\n${ticket.description || ""}`;

    // Extract solution from comments
    const solution = resolutionComments.map((c) => c.content).join("\n\n");

    // Extract steps from history (status changes, assignments)
    const steps = history
      .filter(
        (h) => h.action === "status_changed" || h.action === "comment_added"
      )
      .map((h) => h.details);

    // Generate tags based on ticket properties and content
    const tags = this.generateTags(ticket, solution);

    return {
      isUseful: true,
      problem,
      solution,
      steps,
      tags,
    };
  }

  private generateTags(ticket: Task, solution: string): string[] {
    const tags: string[] = [];

    // Add category as tag
    if (ticket.category) {
      tags.push(ticket.category);
    }

    // Add severity/priority tags
    if (ticket.severity === "critical" || ticket.priority === "urgent") {
      tags.push("urgent");
    }

    // Extract keywords from title and solution
    const text = `${ticket.title} ${solution}`.toLowerCase();
    const commonIssues = [
      "login",
      "authentication",
      "password",
      "performance",
      "error",
      "api",
      "database",
      "integration",
      "deployment",
      "configuration",
    ];

    commonIssues.forEach((issue) => {
      if (text.includes(issue)) {
        tags.push(issue);
      }
    });

    // Add existing ticket tags
    if (ticket.tags && Array.isArray(ticket.tags)) {
      tags.push(...ticket.tags);
    }

    // Remove duplicates
    return Array.from(new Set(tags));
  }

  private async createKnowledgeArticle(
    ticket: Task,
    resolution: any,
    requireApproval: boolean = true
  ): Promise<void> {
    const { bedrockClient, bedrockModelId: modelId } = await getBedrockClient();

    if (!bedrockClient || !modelId) {
      await this.saveKnowledgeArticle(
        ticket,
        resolution,
        null,
        requireApproval
      );
      return;
    }

    try {
      // Use AI to generate a comprehensive knowledge article
      const prompt = buildCreateKnowledgeArticlePrompt(resolution);
      const result = await runKnowledgeArticleGenerationPrompt(prompt);

      const aiArticle = JSON.parse(result.response) as KnowledgeArticle;

      // Save the enhanced article
      await this.saveKnowledgeArticle(
        ticket,
        resolution,
        aiArticle,
        requireApproval
      );
    } catch (error) {
      console.error("Error generating AI knowledge article:", error);
      // Fallback to saving without AI enhancement
      await this.saveKnowledgeArticle(
        ticket,
        resolution,
        null,
        requireApproval
      );
    }
  }

  private async saveKnowledgeArticle(
    ticket: Task,
    resolution: any,
    aiEnhancement: any,
    requireApproval: boolean
  ): Promise<void> {
    try {
      const article: InsertKnowledgeArticle = {
        title: aiEnhancement?.title || `Solution: ${ticket.title}`,
        summary:
          aiEnhancement?.summary || resolution.solution.substring(0, 200),
        content:
          aiEnhancement?.content ||
          `
# Problem
${resolution.problem}

# Solution
${resolution.solution}

# Steps Taken
${resolution.steps.join("\n")}

# Additional Notes
${aiEnhancement?.variations?.join("\n") || ""}
`,
        sourceTicketIds: [ticket.id],
        category: ticket.category || "general",
        tags: [...resolution.tags, ...(aiEnhancement?.variations || [])],
        effectivenessScore: "0.75", // Default effectiveness
        isPublished: requireApproval ? false : true,
        createdBy: null, // System-generated
      };

      await db.insert(knowledgeArticles).values(article);
      console.log(
        `Knowledge article created from ticket ${ticket.ticketNumber}`
      );
    } catch (error) {
      console.error("Error saving knowledge article:", error);
    }
  }

  async updateArticleEffectiveness(
    articleId: number,
    wasHelpful: boolean
  ): Promise<void> {
    try {
      const [article] = await db
        .select()
        .from(knowledgeArticles)
        .where(eq(knowledgeArticles.id, articleId))
        .limit(1);

      if (!article) return;

      // Simple effectiveness calculation
      const currentScore = parseFloat(article.effectivenessScore || "0.5");
      const increment = wasHelpful ? 0.05 : -0.05;
      const newScore = Math.max(0, Math.min(1, currentScore + increment));

      await db
        .update(knowledgeArticles)
        .set({
          effectivenessScore: newScore.toFixed(2),
          usageCount: sql`${knowledgeArticles.usageCount} + 1`,
        })
        .where(eq(knowledgeArticles.id, articleId));
    } catch (error) {
      console.error("Error updating article effectiveness:", error);
    }
  }

  async publishArticle(articleId: number): Promise<void> {
    await db
      .update(knowledgeArticles)
      .set({ isPublished: true })
      .where(eq(knowledgeArticles.id, articleId));
  }

  async unpublishArticle(articleId: number): Promise<void> {
    await db
      .update(knowledgeArticles)
      .set({ isPublished: false })
      .where(eq(knowledgeArticles.id, articleId));
  }

  async semanticSearch(query: string, limit: number): Promise<any[]> {
    return await db
      .select()
      .from(knowledgeArticles)
      .where(
        and(
          eq(knowledgeArticles.isPublished, true),
          ilike(knowledgeArticles.content, `%${query}%`)
        )
      )
      .limit(limit);
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
