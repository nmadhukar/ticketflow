import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const saveTicketAnalysis = jest.fn<(...args: unknown[]) => Promise<void>>();
const runTicketAnalysisPrompt = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const runAutoResponseForTicketPrompt = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("../../storage", () => ({ storage: { saveTicketAnalysis } }));
jest.mock("../../security", () => ({ logSecurityEvent: jest.fn() }));
jest.mock("../../admin/aiSettings", () => ({ getAISettings: jest.fn(async () => ({ responseTimeout: 30 })) }));
jest.mock("../../services/ai/bedrockIntegration", () => ({ runTicketAnalysisPrompt, runAutoResponseForTicketPrompt }));

import { analyzeTicket, generateAutoResponseForTicket } from "../../services/ai/aiTicketAnalysis";
import type { TicketAnalysis } from "../../services/ai/aiTicketAnalysis";

const ticket = { title: "Login fails", description: "Password rejected", reporterId: "user-1" };
const valid = {
  complexity: "low", category: "support", priority: "medium", estimatedResolutionTime: 2,
  tags: ["login"], confidence: 85, reasoning: "Common issue",
};

describe("ticket analysis output validation", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("saves valid OpenRouter wrapper output without Bedrock credentials", async () => {
    runTicketAnalysisPrompt.mockResolvedValue({ response: JSON.stringify(valid) });
    expect(await analyzeTicket(ticket)).toEqual(valid);
    expect(saveTicketAnalysis).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed model output before a database write", async () => {
    runTicketAnalysisPrompt.mockResolvedValue({ response: JSON.stringify({ ...valid, confidence: 999 }) });
    expect(await analyzeTicket(ticket)).toBeNull();
    expect(saveTicketAnalysis).not.toHaveBeenCalled();
  });

  it("rejects incomplete generated replies", async () => {
    runAutoResponseForTicketPrompt.mockResolvedValue({ response: JSON.stringify({ response: "Try again", confidence: 80 }) });
    expect(await generateAutoResponseForTicket(
      { title: ticket.title, description: ticket.description, category: "support", priority: "medium" },
      valid as TicketAnalysis
    )).toBeNull();
  });
});
