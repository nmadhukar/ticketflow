import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { db } from "./db";
import { tasks, ticketAutoResponses, knowledgeArticles, ticketComplexityScores, taskComments } from "@shared/schema";
import { eq, desc, sql, and, or, ilike } from "drizzle-orm";
import type { Task, InsertTicketAutoResponse, InsertTicketComplexityScore } from "@shared/schema";

interface ComplexityFactors {
  keywords: number;
  urgency: number;
  technical: number;
  historical: number;
  sentiment: number;
}

export class AIAutoResponseService {
  private bedrockClient: BedrockRuntimeClient | null = null;

  constructor() {
    this.initializeBedrockClient();
  }

  private async initializeBedrockClient() {
    try {
      // Get AWS Bedrock configuration
      const [bedrockConfig] = await db
        .select()
        .from(sql`api_keys`)
        .where(sql`service = 'bedrock'`)
        .limit(1);

      if (!bedrockConfig?.key || !bedrockConfig?.secret || !bedrockConfig?.region) {
        console.log('AWS Bedrock not configured');
        return;
      }

      this.bedrockClient = new BedrockRuntimeClient({
        region: bedrockConfig.region,
        credentials: {
          accessKeyId: bedrockConfig.key,
          secretAccessKey: bedrockConfig.secret,
        },
      });
    } catch (error) {
      console.error('Failed to initialize Bedrock client:', error);
    }
  }

  async analyzeTicket(ticket: Task): Promise<{
    autoResponse: string | null;
    confidence: number;
    complexity: number;
    factors: ComplexityFactors;
    shouldEscalate: boolean;
  }> {
    if (!this.bedrockClient) {
      return {
        autoResponse: null,
        confidence: 0,
        complexity: 50,
        factors: { keywords: 0, urgency: 0, technical: 0, historical: 0, sentiment: 0 },
        shouldEscalate: true,
      };
    }

    try {
      // Search for similar resolved tickets
      const similarTickets = await this.findSimilarResolvedTickets(ticket.title, ticket.description || '');
      
      // Search knowledge base
      const relevantArticles = await this.searchKnowledgeBase(ticket.title, ticket.description || '');
      
      // Calculate complexity
      const complexityAnalysis = await this.calculateComplexity(ticket, similarTickets);
      
      // Generate AI response if confidence is high
      let autoResponse = null;
      let confidence = 0;

      if (similarTickets.length > 0 || relevantArticles.length > 0) {
        const response = await this.generateAutoResponse(ticket, similarTickets, relevantArticles);
        autoResponse = response.response;
        confidence = response.confidence;
      }

      // Determine if escalation is needed
      const shouldEscalate = complexityAnalysis.score > 70 || confidence < 0.7;

      return {
        autoResponse,
        confidence,
        complexity: complexityAnalysis.score,
        factors: complexityAnalysis.factors,
        shouldEscalate,
      };
    } catch (error) {
      console.error('Error analyzing ticket:', error);
      return {
        autoResponse: null,
        confidence: 0,
        complexity: 50,
        factors: { keywords: 0, urgency: 0, technical: 0, historical: 0, sentiment: 0 },
        shouldEscalate: true,
      };
    }
  }

  private async findSimilarResolvedTickets(title: string, description: string, limit = 5): Promise<any[]> {
    try {
      // Search for similar tickets by title and description
      const searchTerms = `${title} ${description}`.toLowerCase().split(' ').filter(term => term.length > 3);
      
      const conditions = searchTerms.map(term => 
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
        .where(and(
          eq(tasks.status, 'resolved'),
          or(...conditions)
        ))
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
        
        ticket.resolution = comments.map(c => c.content).join('\n');
      }

      return similarTickets;
    } catch (error) {
      console.error('Error finding similar tickets:', error);
      return [];
    }
  }

  private async searchKnowledgeBase(title: string, description: string, limit = 3): Promise<any[]> {
    try {
      const searchTerms = `${title} ${description}`.toLowerCase().split(' ').filter(term => term.length > 3);
      
      const conditions = searchTerms.map(term => 
        or(
          ilike(knowledgeArticles.title, `%${term}%`),
          ilike(knowledgeArticles.content, `%${term}%`),
          sql`${knowledgeArticles.tags}::text ILIKE ${'%' + term + '%'}`
        )
      );

      const articles = await db
        .select()
        .from(knowledgeArticles)
        .where(and(
          eq(knowledgeArticles.isPublished, true),
          or(...conditions)
        ))
        .orderBy(desc(knowledgeArticles.effectivenessScore), desc(knowledgeArticles.usageCount))
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
      console.error('Error searching knowledge base:', error);
      return [];
    }
  }

  private async calculateComplexity(ticket: Task, similarTickets: any[]): Promise<{
    score: number;
    factors: ComplexityFactors;
  }> {
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
    factors.urgency = urgencyMap[ticket.priority] || 10;

    // Technical complexity based on keywords
    const technicalKeywords = [
      'api', 'integration', 'database', 'error', 'crash', 'performance',
      'security', 'authentication', 'authorization', 'deployment', 'migration',
    ];
    const text = `${ticket.title} ${ticket.description}`.toLowerCase();
    factors.technical = technicalKeywords.filter(keyword => text.includes(keyword)).length * 10;

    // Historical complexity (no similar resolved tickets)
    factors.historical = similarTickets.length === 0 ? 30 : 0;

    // Keyword complexity
    const complexKeywords = ['complex', 'difficult', 'urgent', 'critical', 'broken', 'down'];
    factors.keywords = complexKeywords.filter(keyword => text.includes(keyword)).length * 15;

    // Calculate total score
    const score = Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0));

    return { score, factors };
  }

  private async generateAutoResponse(
    ticket: Task,
    similarTickets: any[],
    articles: any[]
  ): Promise<{ response: string; confidence: number }> {
    if (!this.bedrockClient) {
      return { response: '', confidence: 0 };
    }

    try {
      const context = {
        ticket: {
          title: ticket.title,
          description: ticket.description,
          category: ticket.category,
          priority: ticket.priority,
        },
        similarTickets: similarTickets.map(t => ({
          title: t.title,
          resolution: t.resolution,
          category: t.category,
        })),
        knowledgeArticles: articles.map(a => ({
          title: a.title,
          content: a.content,
          summary: a.summary,
        })),
      };

      const prompt = `You are an AI helpdesk assistant. Based on similar resolved tickets and knowledge articles, generate a helpful response for this ticket.

Current Ticket:
Title: ${ticket.title}
Description: ${ticket.description}
Category: ${ticket.category}
Priority: ${ticket.priority}

Similar Resolved Tickets:
${similarTickets.map(t => `- ${t.title}: ${t.resolution}`).join('\n')}

Relevant Knowledge Articles:
${articles.map(a => `- ${a.title}: ${a.summary || a.content.substring(0, 200)}`).join('\n')}

Generate a professional, helpful response that:
1. Acknowledges the issue
2. Provides relevant solutions based on similar tickets and knowledge articles
3. Includes clear steps if applicable
4. Offers to escalate if the solution doesn't work

Also provide a confidence score (0-1) for this response based on how well the similar tickets and articles match the current issue.

Format your response as JSON:
{
  "response": "Your helpful response here",
  "confidence": 0.85
}`;

      const command = new InvokeModelCommand({
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: prompt,
          }],
          max_tokens: 1000,
          temperature: 0.3,
        }),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const aiResponse = JSON.parse(responseBody.content[0].text);

      return {
        response: aiResponse.response,
        confidence: aiResponse.confidence,
      };
    } catch (error) {
      console.error('Error generating auto response:', error);
      return { response: '', confidence: 0 };
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
      console.error('Error saving auto response:', error);
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
      console.error('Error saving complexity score:', error);
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
      console.error('Error updating response effectiveness:', error);
    }
  }
}

export const aiAutoResponseService = new AIAutoResponseService();