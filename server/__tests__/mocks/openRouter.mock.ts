/** OpenRouter HTTP fake: exercises the real client, pricing, budget, and workflow code. */
import { jest } from "@jest/globals";
export const MOCK_MODEL_ID = "deepseek/deepseek-v4-pro";

const ticketAnalysis = {
  complexity: "low", category: "support", priority: "medium",
  estimatedResolutionTime: 2, tags: ["test"], confidence: 80, reasoning: "mock",
};

type Handler = (prompt: string) => string | Error;

function defaultHandler(complexityScore: number): Handler {
  return (prompt) => {
    if (prompt.includes("expert IT support analyst")) return JSON.stringify({
      keyIssues: ["issue"], suggestedCategory: "support", recommendedPriority: "medium",
      complexityScore, requiredExpertise: ["it"], estimatedHours: 1,
    });
    if (prompt.includes("helpful IT support assistant")) return JSON.stringify({
      response: "Try restarting the service.", confidence: 0.85, knowledgeBaseArticles: [],
    });
    if (prompt.includes("expert helpdesk AI analyst")) return JSON.stringify(ticketAnalysis);
    if (prompt.includes("professional helpdesk support agent")) return JSON.stringify({
      response: "Try restarting the service.", confidence: 85, knowledgeBaseArticles: [],
      followUpActions: [], escalationNeeded: false,
    });
    return "{}";
  };
}

export const aiModelMock = {
  handler: defaultHandler(20) as Handler,
  prompts: [] as string[],

  totalCalls() { return aiModelMock.prompts.length; },
  seen() { return aiModelMock.prompts.join("\n---\n"); },

  reset(opts: { complexityScore?: number } = {}) {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    aiModelMock.handler = defaultHandler(opts.complexityScore ?? 20);
    aiModelMock.prompts = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "https://openrouter.ai/api/v1/models") return new Response(JSON.stringify({
        data: [{ id: MOCK_MODEL_ID, pricing: { prompt: "0.000001", completion: "0.000002" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("https://openrouter.ai/api/v1/generation")) return new Response("{}", { status: 404 });
      if (url !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("Unexpected HTTP request in AI test");
      const body = JSON.parse(String(init?.body ?? "{}"));
      const prompt = Array.isArray(body.messages) ? body.messages.map((message: { content?: string }) => message.content ?? "").join("\n") : "";
      aiModelMock.prompts.push(prompt);
      const output = aiModelMock.handler(prompt);
      if (output instanceof Error) {
        const status = (output as Error & { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status) return new Response("{}", { status });
        throw output;
      }
      return new Response(JSON.stringify({
        model: MOCK_MODEL_ID,
        choices: [{ message: { content: output } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  },
};
