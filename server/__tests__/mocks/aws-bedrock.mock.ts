/**
 * Fakes AWS at the SDK boundary: `BedrockRuntimeClient.prototype.send` answers
 * with canned Claude-format replies, so the REAL bedrockIntegration,
 * costMonitoring and aiAutoResponse code (prompts, JSON parsing, usage rows,
 * calculateConfidence and its settings rule) all run. Nothing here re-implements
 * a production rule; the confidence a ticket gets comes from the real function.
 *
 * Use: call `bedrockMock.reset()` in beforeEach (after any jest.restoreAllMocks),
 * set `bedrockMock.handler` to change what the model says.
 */
import { jest } from "@jest/globals";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

export const MOCK_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0";

const ticketAnalysis = {
  complexity: "low",
  category: "support",
  priority: "medium",
  estimatedResolutionTime: 2,
  tags: ["test"],
  confidence: 80,
  reasoning: "mock",
};

type Handler = (prompt: string) => string | Error;

function defaultHandler(complexityScore: number): Handler {
  return (prompt) => {
    if (prompt.includes("expert IT support analyst")) {
      return JSON.stringify({
        keyIssues: ["issue"],
        suggestedCategory: "support",
        recommendedPriority: "medium",
        complexityScore,
        requiredExpertise: ["it"],
        estimatedHours: 1,
      });
    }
    if (prompt.includes("helpful IT support assistant")) {
      return JSON.stringify({
        response: "Try restarting the service.",
        confidence: 0.85,
        knowledgeBaseArticles: [],
      });
    }
    if (prompt.includes("expert helpdesk AI analyst")) return JSON.stringify(ticketAnalysis);
    if (prompt.includes("professional helpdesk support agent")) {
      return JSON.stringify({
        response: "Try restarting the service.",
        confidence: 85,
        knowledgeBaseArticles: [],
        followUpActions: [],
        escalationNeeded: false,
      });
    }
    return "{}";
  };
}

export const bedrockMock = {
  /** What the model answers for a prompt; return an Error to make the call throw it. */
  handler: defaultHandler(20) as Handler,
  /** Every prompt sent, in order. */
  prompts: [] as string[],
  spy: undefined as unknown as ReturnType<typeof jest.spyOn>,

  totalCalls(): number {
    return bedrockMock.prompts.length;
  },

  /** Joined text of every prompt sent (to assert what the model was shown). */
  seen(): string {
    return bedrockMock.prompts.join("\n---\n");
  },

  /**
   * Installs the fake. `complexityScore` is what the model reports for the analysis;
   * together with the ticket category and the knowledge matches it fixes the
   * confidence the REAL calculateConfidence computes (support + score 20 + one
   * matching article = about 0.8; no article = 0.7).
   */
  reset(opts: { complexityScore?: number } = {}) {
    bedrockMock.handler = defaultHandler(opts.complexityScore ?? 20);
    bedrockMock.prompts = [];
    bedrockMock.spy = jest
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockImplementation((async (command: { input: { body: string } }) => {
        const body = JSON.parse(command.input.body);
        const prompt: string = body.messages?.[0]?.content ?? "";
        bedrockMock.prompts.push(prompt);
        const out = bedrockMock.handler(prompt);
        if (out instanceof Error) throw out;
        return {
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [{ text: out }],
              usage: { input_tokens: 10, output_tokens: 20 },
            })
          ),
        };
      }) as never);
  },
};
