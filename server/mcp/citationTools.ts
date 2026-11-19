import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "@shared/schema";
import { getReadableKnowledgeArticle, searchKnowledgeArticles } from "../services/workspaceReads";
import { runTool } from "./errors";

/**
 * The RAG citation gate, as a tool the assistant must call before it answers.
 *
 * Why a tool and not a prompt: a prompt can be argued with, a tool result cannot. The old behaviour
 * was the model saying "try these seven steps" from memory, which is exactly the hallucination a
 * manager spots first. This tool answers one question: "does the knowledge base hold, verbatim, at
 * least this article for this problem?" — and returns the citation fields the answer must carry.
 *
 * It is read-only and visible to the same viewers as search_knowledge, so it widens nothing.
 */

/** Anything that is not a letter or a digit, in any script. */
const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "gu");

/** Terms of four or more letters, stop-worded, used to check the claim against the article. */
const STOP = new Set([
  "with", "that", "this", "from", "have", "will", "your", "you", "was", "were", "been", "being",
  "issue", "problem", "ticket", "please", "about", "when", "what", "which", "there", "their",
  "then", "than", "them", "they", "after", "before", "into", "over", "some", "such", "only",
]);

function terms(text: string): string[] {
  return Array.from(
    new Set(text.toLowerCase().split(NON_WORD).filter((t) => t.length > 3 && !STOP.has(t))),
  );
}

export interface CitationCheck {
  grounded: boolean;
  articleId: number | null;
  articleTitle: string | null;
  /** Share of the answer's own terms that the article actually contains, 0-1. */
  overlap: number;
  /** What to tell the model, in one sentence. */
  verdict: string;
}

/** Pure: how much of the answer is covered by the article, and whether that is enough to cite it. */
export function checkCitation(
  draft: string,
  article: { id: number; title: string; content?: string | null; summary?: string | null } | null,
): CitationCheck {
  if (!article) {
    return {
      grounded: false,
      articleId: null,
      articleTitle: null,
      overlap: 0,
      verdict: "No published article matches this problem: say you found no matching article and route the ticket to a person instead of giving steps.",
    };
  }
  const draftTerms = terms(draft);
  const body = `${article.title} ${article.summary ?? ""} ${article.content ?? ""}`.toLowerCase();
  const hits = draftTerms.filter((t) => body.includes(t)).length;
  const overlap = draftTerms.length === 0 ? 0 : hits / draftTerms.length;
  // One in three of the answer's own terms is a deliberately forgiving floor: the model paraphrases.
  const grounded = overlap >= 0.34;
  return {
    grounded,
    articleId: article.id,
    articleTitle: article.title,
    overlap: Number(overlap.toFixed(2)),
    verdict: grounded
      ? `Grounded in "${article.title}". Cite it by title and keep the steps to what that article says.`
      : `"${article.title}" does not cover enough of this answer (${Math.round(overlap * 100)}%). Answer from it only, or say no matching article was found.`,
  };
}

/**
 * Registers check_citation. The search is the app's own (searchKnowledgeArticles), so the model can
 * only be "grounded" in an article this user could open anyway.
 */
export function registerCitationTools(server: McpServer, _user: User): void {
  server.registerTool(
    "check_citation",
    {
      description:
        "Before answering a customer with steps, verify the answer is grounded in a published knowledge article. Give the problem and your draft answer; returns { grounded, articleId, articleTitle, overlap, verdict }. If grounded is false, do not send the draft: say no matching article was found.",
      inputSchema: z.object({
        problem: z.string().describe("The customer's problem, a few words or one sentence"),
        draft: z.string().describe("The answer you are about to give, as plain text"),
        category: z.string().describe("Optional article category to search in").optional(),
      }),
      annotations: { readOnlyHint: true, title: "Check a citation" },
    },
    (args: { problem: string; draft: string; category?: string }) =>
      runTool(async () => {
        const parsed = z
          .object({ problem: z.string().min(3), draft: z.string().min(10), category: z.string().optional() })
          .parse(args ?? {});
        const articles = await searchKnowledgeArticles({
          query: parsed.problem.slice(0, 200),
          ...(parsed.category ? { category: parsed.category } : {}),
          limit: 1,
        });
        const best = articles[0] ? await getReadableKnowledgeArticle(articles[0].id).catch(() => null) : null;
        return checkCitation(parsed.draft, best);
      }),
  );
}
