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
import { recallMemories } from "./hindsight";
import { containsPattern } from "../../utils/like";
import type { TicketStatus } from "@shared/constants";
import { z } from "zod";

const ticketAnalysisResultSchema = z.object({ complexityScore: z.number().finite().min(0).max(100) });
const generatedResponseSchema = z.object({
  response: z.string().trim().min(1),
  // bedrockIntegration normalises the model's citations to ids; coerce defensively so a stray
  // entry can never throw away an otherwise good reply.
  suggestedArticles: z.array(z.coerce.number().int().positive()),
  /** How sure the model says it is of this reply, 0-1. Source of the confidence score. */
  confidence: z.number().finite().min(0).max(1).optional(),
  // Set by bedrockIntegration.generateResponse when no real answer was produced: the caller
  // must route the ticket instead of posting the holding message as a reply.
  degraded: z.boolean().optional(),
});
const confidenceResultSchema = z.object({
  confidenceScore: z.number().finite().min(0).max(1),
  shouldAutoRespond: z.boolean(),
});
const extractedKnowledgeSchema = z.object({
  title: z.string().trim().min(1).max(255),
  summary: z.string().trim().min(1),
  content: z.string().trim().min(1),
  category: z.string().trim().min(1),
  tags: z.array(z.string()),
});

/**
 * Cuts a reply to a character budget without leaving a severed word or sentence. It prefers the end
 * of the last whole sentence inside the budget, then the last word boundary, and only falls back to a
 * hard cut when there is no boundary to use (a single very long token). A trailing cut is marked so
 * the reader knows the text was shortened rather than finished.
 */
export function trimToLength(text: string, maxLength: number): string {
  if (!text) return text;
  if (text.length <= maxLength) return text;

  const budget = text.slice(0, maxLength);

  // Prefer the last whole sentence, when it keeps most of the budget.
  const sentence = budget.match(/^[\s\S]*[.!?](?=[\s)\]"']|$)/);
  if (sentence && sentence[0].length >= maxLength * 0.5) return sentence[0].trimEnd();

  // Otherwise stop after the last whole word, so a word is never cut in half.
  const lastSpace = budget.search(/\s\S*$/);
  if (lastSpace > maxLength * 0.5) return `${budget.slice(0, lastSpace).trimEnd()}…`;

  return budget;
}

/**
 * Words too common to identify a topic. They appear across unrelated articles ("user", "admin",
 * "request", "account"), so matching on them alone produced false knowledge hits that pushed a
 * ticket over the reply threshold. Dropped from the search terms; a term must also clear the
 * four-character floor applied at the call site.
 */
const STOP_WORDS = new Set([
  "about", "above", "account", "accounts", "added", "admin", "admins", "again", "against",
  "another", "been", "before", "being", "below", "between", "check", "could", "does", "doing",
  "done", "each", "extra", "from", "further", "have", "having", "help", "here", "into", "issue",
  "issues", "just", "latest", "license", "licenses", "like", "lists", "made", "make", "many",
  "more", "most", "much", "must", "need", "needs", "only", "other", "others", "over", "please",
  "possible", "problem", "problems", "request", "requests", "same", "should", "some", "such",
  "support", "system", "team", "teams", "than", "that", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "ticket", "tickets", "under", "until", "user", "users",
  "very", "want", "wants", "were", "what", "when", "where", "which", "while", "will", "with",
  "within", "without", "would", "your", "yours",
]);

/**
 * How the keyword knowledge search rates an article against a ticket: a distinct match in the
 * title or tags counts for more than one in the body, and an article must reach MIN_RELEVANCE to
 * be treated as a match at all. Without this, one shared common word ("request", "install",
 * "team") in an unrelated article's body counted as a knowledge match and inflated the reply
 * confidence past the auto-respond threshold, so an unmatched ticket replied instead of routing.
 */
const TITLE_TAG_WEIGHT = 3;
const CONTENT_WEIGHT = 1;
/** A body-only match needs this many distinct terms: one shared word is far too weak. */
const MIN_CONTENT_TERMS = 3;

/**
 * The ticket's search terms. Splitting on [^a-z0-9] discarded every non-English word: an accented
 * ("Contraseña") or non-Latin (Cyrillic, CJK) ticket produced no terms at all and so could never
 * match the knowledge base. Split on anything that is not a letter or digit in ANY script instead,
 * so those tickets search normally. English stop words still apply; other languages simply keep
 * their words (the length floor is what removes noise there).
 */
/** Anything that is not a letter or a digit, in any script (built once: the /u flag needs the constructor here). */
const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "gu");

export function toSearchTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(NON_WORD)
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term));
}

/** The relevance score for one article against the ticket's terms (see the weights above). */
export function articleRelevance(article: any, terms: string[]): number {
  return articleMatch(article, terms).score;
}

/**
 * How well one article matches the ticket's terms. A title or tag match is a real topic match;
 * body matches alone are weak, because ordinary project vocabulary ("user", "admin", "licenses")
 * appears throughout unrelated articles. An article therefore counts as a match only when it hits
 * the title or tags at least once, or shares several distinct terms with its body.
 */
function articleMatch(article: any, terms: string[]): { score: number; titleTagHits: number; contentHits: number } {
  const title = String(article.title ?? "").toLowerCase();
  const rawTags = Array.isArray(article.tags) ? article.tags.join(" ") : String(article.tags ?? "");
  const tags = rawTags.toLowerCase();
  const content = String(article.content ?? article.summary ?? "").toLowerCase();

  let titleTagHits = 0;
  let contentHits = 0;
  for (const term of terms) {
    if (title.includes(term) || tags.includes(term)) titleTagHits += 1;
    else if (content.includes(term)) contentHits += 1;
  }
  return { score: titleTagHits * TITLE_TAG_WEIGHT + contentHits * CONTENT_WEIGHT, titleTagHits, contentHits };
}

/**
 * The ticket status an AI answer earns.
 *
 * A new ticket is always created "open"; the create-time analysis may then move it. The bands are
 * the owner's decision (2026-10-29), SIMPLIFIED on their request:
 *
 *  - no answer: the analysis matched no knowledge article and no earlier resolved ticket, so the
 *    AI has nothing to say and the ticket is left OPEN for a person (and routed to its team). The
 *    confidence score is NOT consulted here: calculateConfidence starts at 0.5 and adds for the
 *    ticket's category, so a support ticket scores 0.7 with no match at all. A score without a
 *    match measures the ticket, not the answer.
 *  - 90% and over: the agent is sure, so the ticket is RESOLVED. Resolved is the last AI state:
 *    the ticket is never closed by the AI. Closing is the follow-up window's job (a resolved
 *    ticket can be reopened, and autoCloseDays exists for exactly that), not the analysis's.
 *  - 50-90%: a real answer the AI is not sure of, so IN_PROGRESS; a person takes it from there.
 *  - below 50%: nothing usable, OPEN.
 *
 * `hasMatch` is the honest "did the AI have anything to answer from" flag, and it decides first.
 */
export function statusForConfidence(confidence: number, hasMatch = true): TicketStatus {
  // No real match means no answer, whatever the score works out to (see above).
  if (!hasMatch) return "open";

  // The score is BUILT by adding tenths (0.5 + 0.3 + 0.1), so 0.9 is really 0.8999999999999999 and
  // a naive `>= 0.9` put a 90% answer in the on_hold band. Compare on a whole-number percentage,
  // which is also the number the customer is shown ("confidence 90.0%").
  const percent = Number.isFinite(confidence) ? Math.round(Math.max(0, Math.min(1, confidence)) * 100) : 0;
  if (percent >= 90) return "resolved";
  if (percent >= 50) return "in_progress";
  return "open";
}

/** True when the article is a strong enough match to count as knowledge for the ticket. */
function isRelevantMatch(article: any, terms: string[]): boolean {
  const { titleTagHits, contentHits } = articleMatch(article, terms);
  return titleTagHits > 0 || contentHits >= MIN_CONTENT_TERMS;
}

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
   * `shouldAutoRespond` is the one decision, made by calculateConfidence: it needs a real
   * match (a knowledge article or a similar resolved ticket) and the admin's enabled flag and
   * confidence threshold. The row is ALWAYS stored
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
    /**
     * True when the analysis had something real to answer from (a knowledge article or an earlier
     * resolved ticket). False means the reply is a guess at best, so the ticket must stay open.
     */
    hasMatch: boolean;
    autoResponseRowId?: number;
    /** True when no real answer was produced; `autoResponse` is the holding message. */
    degraded?: boolean;
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

      // Hindsight memory: past resolutions recall into the reply prompt only. Off by
      // default and never throws, so when it is off the two lines below are all that runs.
      // The recalled text is a prompt aid, not a knowledge match: it is added to the articles
      // the model sees, but confidence still counts only the real knowledge-base articles.
      // Recall is scoped to the ticket's creator: a customer only ever sees resolutions from
      // their own earlier tickets, never another customer's (Hindsight tag filter).
      const memories = await recallMemories(
        `${ticket.title} ${ticket.description || ""}`,
        undefined,
        undefined,
        ticket.createdBy
      );
      const responseArticles = memories.length > 0
        ? [...relevantArticles, ...memories.map((summary) => ({ title: "Recalled memory", summary }))]
        : relevantArticles;

      const analysis = ticketAnalysisResultSchema.parse(await bedrockIntegration.analyzeTicket(ticket));

      const responseResult = generatedResponseSchema.parse(await bedrockIntegration.generateResponse(
        ticket,
        responseArticles
      ));

      const confidenceResult = confidenceResultSchema.parse(await bedrockIntegration.calculateConfidence(
        ticket,
        relevantArticles.length,
        analysis.complexityScore,
        // A similar resolved ticket is a real match too: a repeat of an earlier problem is
        // answerable from how it was fixed, even before the knowledge base has an article.
        similarTickets.length,
        // The model's own confidence in the reply it just wrote: the score, gated by a real match.
        responseResult.confidence
      ));

      // Calculate complexity factors
      const factors = this.calculateComplexityFactors(ticket, similarTickets);

      // Store the AI response in the database (only if ticket has an ID). The admin setting is a
      // character budget; cutting at an arbitrary character used to leave a half-written word or
      // sentence ("... - Work w"). Cut on a word boundary instead, and end on a sentence where one
      // is available so the customer never reads a severed line.
      const maxLength = Math.max(
        100,
        Math.min(5000, Number((await getAISettings()).maxResponseLength) || 1000)
      );
      const responseText = trimToLength(responseResult.response, maxLength);

      // A degraded generation has no real answer: never auto-respond on it (the holding
      // message is not a matched solution), so the ticket is classified and routed instead.
      const shouldAutoRespond = confidenceResult.shouldAutoRespond && responseResult.degraded !== true;

      let autoResponseRowId: number | undefined;
      if (responseText && confidenceResult.confidenceScore > 0 && ticket.id && !responseResult.degraded) {
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
        shouldEscalate: !shouldAutoRespond,
        shouldAutoRespond,
        hasMatch: relevantArticles.length > 0 || similarTickets.length > 0,
        autoResponseRowId,
        ...(responseResult.degraded === true ? { degraded: true } : {}),
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
        hasMatch: false,
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
      // This path splits on spaces only, which already keeps non-Latin words intact.
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

      // Fallback to keyword search if semantic search fails. Every word of four or more
      // characters is a candidate term, but a single word shared with an article's body is not
      // a match: common words ("request", "install", "team") make unrelated articles look
      // relevant, which used to inflate the reply confidence and skip routing. A title or tag
      // hit is worth more than a body hit, and only articles that clear MIN_RELEVANCE are kept.
      const searchTerms = Array.from(new Set(toSearchTerms(`${title} ${description}`)));

      if (searchTerms.length === 0) return [];

      const conditions = searchTerms.map((term) =>
        or(
          ilike(knowledgeArticles.title, containsPattern(term)),
          ilike(knowledgeArticles.content, containsPattern(term)),
          sql`${knowledgeArticles.tags}::text ILIKE ${containsPattern(term)}`
        )
      );

      const candidates = await db
        .select()
        .from(knowledgeArticles)
        .where(and(eq(knowledgeArticles.isPublished, true), or(...conditions)))
        .orderBy(
          desc(knowledgeArticles.effectivenessScore),
          desc(knowledgeArticles.usageCount)
        );

      const articles = candidates
        .map((article) => ({ article, relevance: articleRelevance(article, searchTerms) }))
        .filter((scored) => isRelevantMatch(scored.article, searchTerms))
        .sort(
          (a, b) =>
            b.relevance - a.relevance ||
            Number(b.article.effectivenessScore ?? 0) - Number(a.article.effectivenessScore ?? 0) ||
            Number(b.article.usageCount ?? 0) - Number(a.article.usageCount ?? 0)
        )
        .slice(0, limit)
        .map((scored) => scored.article);

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
      const knowledge = extractedKnowledgeSchema.parse(await bedrockIntegration.updateKnowledgeBase(
        ticket,
        resolution
      ));

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
