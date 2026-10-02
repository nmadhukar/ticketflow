/**
 * Replaces server/services/ai/bedrockIntegration in a test so no request ever
 * reaches AWS. Use it from the top of a test file:
 *
 *   jest.mock("../../services/ai/bedrockIntegration", () =>
 *     require("../mocks/aws-bedrock.mock").createBedrockIntegrationModule());
 *
 * then drive it with `bedrockMock` (same instance: jest resolves both through
 * one module registry). Call `bedrockMock.reset()` in beforeEach.
 */

import { jest } from "@jest/globals";

type Fn = ReturnType<typeof jest.fn<(...args: any[]) => any>>;

const analysisJson = {
  complexity: "low",
  category: "support",
  priority: "medium",
  estimatedResolutionTime: 2,
  tags: ["test"],
  confidence: 80,
  reasoning: "mock",
};

const autoResponseJson = {
  response: "Try restarting the service.",
  confidence: 85,
  knowledgeBaseArticles: [],
  followUpActions: [],
  escalationNeeded: false,
};

export const bedrockMock = {
  getBedrockClient: jest.fn<(...args: any[]) => any>(),
  analyzeTicket: jest.fn<(...args: any[]) => any>(),
  generateResponse: jest.fn<(...args: any[]) => any>(),
  calculateConfidence: jest.fn<(...args: any[]) => any>(),
  updateKnowledgeBase: jest.fn<(...args: any[]) => any>(),
  runTicketAnalysisPrompt: jest.fn<(...args: any[]) => any>(),
  runAutoResponseForTicketPrompt: jest.fn<(...args: any[]) => any>(),
  runKnowledgeArticleGenerationPrompt: jest.fn<(...args: any[]) => any>(),
  runKnowledgeImproveArticlePrompt: jest.fn<(...args: any[]) => any>(),
  runKnowledgePatternAnalysisPrompt: jest.fn<(...args: any[]) => any>(),
  runKnowledgePatternPrompt: jest.fn<(...args: any[]) => any>(),
  runKnowledgeSearchPrompt: jest.fn<(...args: any[]) => any>(),
  runChatPrompt: jest.fn<(...args: any[]) => any>(),

  /** Every mocked call made so far, across all functions. */
  totalCalls(): number {
    return Object.values(bedrockMock)
      .filter((v): v is Fn => typeof v === "function" && "mock" in v)
      .reduce((n, f) => n + f.mock.calls.length, 0);
  },

  /** Happy-path defaults: a configured client, a 0.8-confidence reply. */
  reset(opts: { confidence?: number } = {}) {
    const confidence = opts.confidence ?? 0.8;
    for (const v of Object.values(bedrockMock)) {
      if (typeof v === "function" && "mock" in v) (v as Fn).mockReset();
    }
    bedrockMock.getBedrockClient.mockResolvedValue({ bedrockClient: {}, bedrockModelId: "mock-model" });
    bedrockMock.analyzeTicket.mockResolvedValue({
      keyIssues: [],
      suggestedCategory: "support",
      recommendedPriority: "medium",
      complexityScore: 20,
      requiredExpertise: [],
      estimatedHours: 1,
    });
    bedrockMock.generateResponse.mockResolvedValue({
      response: "Try restarting the service.",
      confidence,
      suggestedArticles: [],
    });
    // Same rule as the real calculateConfidence: the admin's settings, read per call.
    bedrockMock.calculateConfidence.mockImplementation(async () => {
      const { getAISettings } = await import("../../admin/aiSettings");
      const s = await getAISettings();
      return {
        confidenceScore: confidence,
        shouldAutoRespond: s.autoResponseEnabled && confidence >= Number(s.confidenceThreshold),
        reasoning: "mock",
      };
    });
    bedrockMock.runTicketAnalysisPrompt.mockResolvedValue({ response: JSON.stringify(analysisJson) });
    bedrockMock.runAutoResponseForTicketPrompt.mockResolvedValue({
      response: JSON.stringify(autoResponseJson),
    });
  },
};

export function createBedrockIntegrationModule() {
  const { totalCalls: _t, reset: _r, ...fns } = bedrockMock;
  return { ...fns, bedrockIntegration: { ...fns } };
}
