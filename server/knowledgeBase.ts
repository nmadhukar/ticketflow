import { db } from "./db";
import { tasks, knowledgeArticles, taskComments, taskHistory } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { Task, InsertKnowledgeArticle } from "@shared/schema";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export class KnowledgeBaseService {
  private bedrockClient: BedrockRuntimeClient | null = null;

  constructor() {
    this.initializeBedrockClient();
  }

  private async initializeBedrockClient() {
    try {
      const [bedrockConfig] = await db
        .select()
        .from(sql`api_keys`)
        .where(sql`service = 'bedrock'`)
        .limit(1);

      if (!bedrockConfig?.key || !bedrockConfig?.secret || !bedrockConfig?.region) {
        console.log('AWS Bedrock not configured for knowledge base');
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
      console.error('Failed to initialize Bedrock client for knowledge base:', error);
    }
  }

  async learnFromResolvedTicket(ticketId: number): Promise<void> {
    try {
      // Get the resolved ticket
      const [ticket] = await db
        .select()
        .from(tasks)
        .where(and(
          eq(tasks.id, ticketId),
          eq(tasks.status, 'resolved')
        ))
        .limit(1);

      if (!ticket) {
        console.log('Ticket not found or not resolved');
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
      
      // Check if we should create a knowledge article
      if (resolution.isUseful) {
        await this.createKnowledgeArticle(ticket, resolution);
      }
    } catch (error) {
      console.error('Error learning from resolved ticket:', error);
    }
  }

  private extractResolution(ticket: Task, comments: any[], history: any[]): {
    isUseful: boolean;
    problem: string;
    solution: string;
    steps: string[];
    tags: string[];
  } {
    // Find resolution comments (last few comments typically contain the solution)
    const resolutionComments = comments.slice(-3);
    
    // Check if ticket has meaningful resolution
    const hasDetailedResolution = resolutionComments.some(c => 
      c.content.length > 50 && 
      (c.content.toLowerCase().includes('fixed') || 
       c.content.toLowerCase().includes('resolved') ||
       c.content.toLowerCase().includes('solution'))
    );

    if (!hasDetailedResolution || comments.length < 2) {
      return { isUseful: false, problem: '', solution: '', steps: [], tags: [] };
    }

    // Extract problem description
    const problem = `${ticket.title}\n${ticket.description || ''}`;
    
    // Extract solution from comments
    const solution = resolutionComments
      .map(c => c.content)
      .join('\n\n');
    
    // Extract steps from history (status changes, assignments)
    const steps = history
      .filter(h => h.action === 'status_changed' || h.action === 'comment_added')
      .map(h => h.details);
    
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
    if (ticket.severity === 'critical' || ticket.priority === 'urgent') {
      tags.push('urgent');
    }
    
    // Extract keywords from title and solution
    const text = `${ticket.title} ${solution}`.toLowerCase();
    const commonIssues = [
      'login', 'authentication', 'password', 'performance', 'error',
      'api', 'database', 'integration', 'deployment', 'configuration'
    ];
    
    commonIssues.forEach(issue => {
      if (text.includes(issue)) {
        tags.push(issue);
      }
    });
    
    // Add existing ticket tags
    if (ticket.tags && Array.isArray(ticket.tags)) {
      tags.push(...ticket.tags);
    }
    
    // Remove duplicates
    return [...new Set(tags)];
  }

  private async createKnowledgeArticle(ticket: Task, resolution: any): Promise<void> {
    if (!this.bedrockClient) {
      // Create article without AI enhancement
      await this.saveKnowledgeArticle(ticket, resolution, null);
      return;
    }

    try {
      // Use AI to generate a comprehensive knowledge article
      const prompt = `Create a knowledge base article from this resolved ticket:

Problem: ${resolution.problem}

Solution: ${resolution.solution}

Resolution Steps: ${resolution.steps.join('\n')}

Generate a well-structured knowledge article with:
1. A clear, searchable title
2. A brief summary (2-3 sentences)
3. Detailed content with step-by-step instructions
4. Prerequisites or requirements
5. Common variations of this issue

Format as JSON:
{
  "title": "Clear title for the knowledge article",
  "summary": "Brief summary of the issue and solution",
  "content": "Detailed article content with markdown formatting",
  "prerequisites": ["list", "of", "prerequisites"],
  "variations": ["common", "variations", "of", "this", "issue"]
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
          max_tokens: 1500,
          temperature: 0.3,
        }),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const aiArticle = JSON.parse(responseBody.content[0].text);

      // Save the enhanced article
      await this.saveKnowledgeArticle(ticket, resolution, aiArticle);
    } catch (error) {
      console.error('Error generating AI knowledge article:', error);
      // Fallback to saving without AI enhancement
      await this.saveKnowledgeArticle(ticket, resolution, null);
    }
  }

  private async saveKnowledgeArticle(
    ticket: Task,
    resolution: any,
    aiEnhancement: any
  ): Promise<void> {
    try {
      const article: InsertKnowledgeArticle = {
        title: aiEnhancement?.title || `Solution: ${ticket.title}`,
        summary: aiEnhancement?.summary || resolution.solution.substring(0, 200),
        content: aiEnhancement?.content || `
# Problem
${resolution.problem}

# Solution
${resolution.solution}

# Steps Taken
${resolution.steps.join('\n')}

# Additional Notes
${aiEnhancement?.variations?.join('\n') || ''}
`,
        sourceTicketIds: [ticket.id],
        category: ticket.category || 'general',
        tags: [...resolution.tags, ...(aiEnhancement?.variations || [])],
        effectivenessScore: '0.75', // Default effectiveness
        isPublished: false, // Require review before publishing
        createdBy: null, // System-generated
      };

      await db.insert(knowledgeArticles).values(article);
      console.log(`Knowledge article created from ticket ${ticket.ticketNumber}`);
    } catch (error) {
      console.error('Error saving knowledge article:', error);
    }
  }

  async updateArticleEffectiveness(articleId: number, wasHelpful: boolean): Promise<void> {
    try {
      const [article] = await db
        .select()
        .from(knowledgeArticles)
        .where(eq(knowledgeArticles.id, articleId))
        .limit(1);

      if (!article) return;

      // Simple effectiveness calculation
      const currentScore = parseFloat(article.effectivenessScore || '0.5');
      const increment = wasHelpful ? 0.05 : -0.05;
      const newScore = Math.max(0, Math.min(1, currentScore + increment));

      await db
        .update(knowledgeArticles)
        .set({ 
          effectivenessScore: newScore.toFixed(2),
          usageCount: sql`${knowledgeArticles.usageCount} + 1`
        })
        .where(eq(knowledgeArticles.id, articleId));
    } catch (error) {
      console.error('Error updating article effectiveness:', error);
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
}

export const knowledgeBaseService = new KnowledgeBaseService();