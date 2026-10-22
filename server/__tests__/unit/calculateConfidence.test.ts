import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// The real calculateConfidence runs; only its settings source and the database it imports are stubbed.
jest.mock("../../storage", () => ({ storage: {} }));
jest.mock("../../storage/db", () => ({ db: {}, pool: {} }));
const mockGetAISettings = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock("../../admin/aiSettings", () => ({ getAISettings: (...a: any[]) => mockGetAISettings(...a) }));

import { calculateConfidence } from "../../services/ai/bedrockIntegration";

// support (+0.1), complexity 20 (+0.1), 1 knowledge match (+0.1) on a 0.5 base: about 0.8
const ticket: any = { id: 1, category: "support" };
const score = () => calculateConfidence(ticket, 1, 20);

function settings(over: Record<string, unknown>) {
  mockGetAISettings.mockResolvedValue({ autoResponseEnabled: true, confidenceThreshold: 0.7, ...over });
}

describe("calculateConfidence: the admin's settings decide shouldAutoRespond", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("computes the score itself (about 0.8 here), independent of the settings", async () => {
    settings({ confidenceThreshold: 0.9 });
    expect((await score()).confidenceScore).toBeCloseTo(0.8);
  });

  it("threshold 0.9: a 0.8 score does NOT auto-respond (the old hard-coded 0.7 would have)", async () => {
    settings({ confidenceThreshold: 0.9 });
    const r = await score();
    expect(r.shouldAutoRespond).toBe(false);
    expect(r.reasoning).toContain("human review");
  });

  it("threshold 0.7: the same 0.8 score auto-responds", async () => {
    settings({ confidenceThreshold: 0.7 });
    const r = await score();
    expect(r.shouldAutoRespond).toBe(true);
    expect(r.reasoning).toContain("automated response");
  });

  it("a threshold of 0.4 is honoured within a match (a 0.6 score passes at 0.4, fails at 0.7)", async () => {
    // 'other' + complexity 50 + one article scores 0.6: a real match, so the threshold decides.
    settings({ confidenceThreshold: 0.4 });
    expect((await calculateConfidence({ category: "other" } as any, 1, 50, 0)).shouldAutoRespond).toBe(true);
    settings({ confidenceThreshold: 0.7 });
    expect((await calculateConfidence({ category: "other" } as any, 1, 50, 0)).shouldAutoRespond).toBe(false);
  });

  it("no match at all never auto-responds, however high the score and low the threshold", async () => {
    // 'other' + complexity 50 scores 0.5 with no article and no resolved ticket, and 0.5 >= 0.4.
    settings({ confidenceThreshold: 0.4 });
    const noMatch = await calculateConfidence({ category: "other" } as any, 0, 50, 0);
    expect(noMatch.shouldAutoRespond).toBe(false);
    expect(noMatch.reasoning).toContain("No matching solution found");
  });

  it("a similar resolved ticket is a real match, even with no knowledge article", async () => {
    settings({ confidenceThreshold: 0.4 });
    const resolvedMatch = await calculateConfidence({ category: "other" } as any, 0, 50, 1);
    expect(resolvedMatch.shouldAutoRespond).toBe(true);
    expect(resolvedMatch.reasoning).toContain("automated response");
  });

  it("auto-response switched off: never auto-responds, whatever the score or threshold", async () => {
    settings({ autoResponseEnabled: false, confidenceThreshold: 0.1 });
    expect((await score()).shouldAutoRespond).toBe(false);
  });

  it("switched on again: it does", async () => {
    settings({ autoResponseEnabled: true, confidenceThreshold: 0.1 });
    expect((await score()).shouldAutoRespond).toBe(true);
  });

  it("settings are read on every call, not cached", async () => {
    settings({ confidenceThreshold: 0.9 });
    expect((await score()).shouldAutoRespond).toBe(false);
    settings({ confidenceThreshold: 0.7 });
    expect((await score()).shouldAutoRespond).toBe(true);
    expect(mockGetAISettings).toHaveBeenCalledTimes(2);
  });
});
