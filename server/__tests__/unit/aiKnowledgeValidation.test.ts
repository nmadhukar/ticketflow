import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const runKnowledgePatternPrompt = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const runKnowledgeSearchPrompt = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const runKnowledgeArticleGenerationPrompt = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const searchKnowledgeBase = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const getPublishedKnowledgeArticles = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const values = jest.fn<(...args: unknown[]) => Promise<void>>();
const insert = jest.fn(() => ({ values }));

jest.mock("../../storage", () => ({ storage: { searchKnowledgeBase, getPublishedKnowledgeArticles } }));
jest.mock("../../storage/db", () => ({ db: { insert } }));
jest.mock("../../security", () => ({ logSecurityEvent: jest.fn() }));
jest.mock("../../utils/aiSystemUser", () => ({ ensureAiSystemUser: jest.fn(async () => "ai-user") }));
jest.mock("../../services/ai/bedrockIntegration", () => ({ runKnowledgePatternPrompt, runKnowledgeSearchPrompt, runKnowledgeArticleGenerationPrompt }));

import { generateKnowledgeArticle, intelligentKnowledgeSearch } from "../../services/ai/knowledgeBaseLearning";
import { KnowledgeBaseService } from "../../services/ai/knowledgeBase";

const pattern = {
  problemType: "Login failures", commonSolutions: ["Reset password"], preventiveMeasures: [],
  frequency: 4, averageResolutionTime: 2, successRate: 80,
};

describe("knowledge model output validation", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("rejects incomplete generated articles before they reach persistence", async () => {
    runKnowledgePatternPrompt.mockResolvedValue({ response: JSON.stringify({ title: "Missing content" }) });
    expect(await generateKnowledgeArticle(pattern, [4])).toBeNull();
  });

  it("falls back when model ranking references an article outside the result set", async () => {
    getPublishedKnowledgeArticles.mockResolvedValue([{ id: 1, title: "Login", content: "Reset password", tags: [] }]);
    runKnowledgeSearchPrompt.mockResolvedValue({ response: JSON.stringify([{ articleIndex: 12, relevanceScore: 90, matchedContent: "login" }]) });
    searchKnowledgeBase.mockResolvedValue([{ id: 1, content: "Reset password" }]);

    const results = await intelligentKnowledgeSearch("login", undefined, 5);
    expect(results).toEqual([{ article: { id: 1, content: "Reset password" }, relevanceScore: 50, matchedContent: "Reset password..." }]);
  });

  it("stores the ticket resolution instead of malformed generated article fields", async () => {
    runKnowledgeArticleGenerationPrompt.mockResolvedValue({ response: JSON.stringify({ title: 42, summary: "Invalid" }) });
    const service = new KnowledgeBaseService() as unknown as {
      createKnowledgeArticle: (ticket: object, resolution: object, requireApproval: boolean) => Promise<void>;
    };
    await service.createKnowledgeArticle(
      { id: 3, title: "Login", ticketNumber: "T-3", category: "support" },
      { problem: "Login fails", solution: "Reset password", steps: [], tags: ["login"] },
      true
    );

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ title: "Solution: Login", content: expect.stringContaining("Reset password") }));
  });
});
