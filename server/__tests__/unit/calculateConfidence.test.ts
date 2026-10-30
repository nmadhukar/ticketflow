import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// The real calculateConfidence runs; only its settings source and the database it imports are stubbed.
jest.mock("../../storage", () => ({ storage: {} }));
jest.mock("../../storage/db", () => ({ db: {}, pool: {} }));
const mockGetAISettings = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock("../../admin/aiSettings", () => ({ getAISettings: (...a: any[]) => mockGetAISettings(...a) }));

import { calculateConfidence } from "../../services/ai/bedrockIntegration";

/**
 * The score is the MODEL's own confidence in the reply it wrote, not a score built from the
 * ticket. The old formula (0.5 base + category + complexity + matches) measured the TICKET: a
 * simple support ticket scored 0.7 with nothing to answer from, and the status bands saw that.
 *
 * Two inputs decide: a real match (a knowledge article or a similar resolved ticket) is a hard
 * gate, and the admin's threshold decides whether to auto-respond. The article counts and the
 * complexity still appear in the reasoning, but no longer move the number.
 */
const ticket: any = { id: 1, category: "support" };
const score = (modelConfidence?: number) => calculateConfidence(ticket, 1, 20, 0, modelConfidence);

function settings(over: Record<string, unknown>) {
  mockGetAISettings.mockResolvedValue({ autoResponseEnabled: true, confidenceThreshold: 0.7, ...over });
}

describe("calculateConfidence: the model's confidence, gated by a real match and the admin's threshold", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("reports the model's confidence as-is, whatever the ticket looks like", async () => {
    settings({ confidenceThreshold: 0.9 });
    expect((await score(0.8)).confidenceScore).toBeCloseTo(0.8);
    // A simple support ticket no longer contributes anything of its own.
    settings({ confidenceThreshold: 0.1 });
    expect((await calculateConfidence({ category: "other" } as any, 1, 50, 0, 0.42)).confidenceScore).toBeCloseTo(0.42);
  });

  it("clamps a model confidence outside 0-1, and a missing or non-finite one scores 0", async () => {
    settings({ confidenceThreshold: 0.1 });
    expect((await score(1.7)).confidenceScore).toBe(1);
    expect((await score(-2)).confidenceScore).toBe(0);
    expect((await score(Number.NaN)).confidenceScore).toBe(0);
    expect((await score(undefined)).confidenceScore).toBe(0);
  });

  it("threshold 0.9: a 0.8 answer does NOT auto-respond", async () => {
    settings({ confidenceThreshold: 0.9 });
    const r = await score(0.8);
    expect(r.shouldAutoRespond).toBe(false);
    expect(r.reasoning).toContain("human review");
  });

  it("threshold 0.7: the same 0.8 answer auto-responds", async () => {
    settings({ confidenceThreshold: 0.7 });
    const r = await score(0.8);
    expect(r.shouldAutoRespond).toBe(true);
    expect(r.reasoning).toContain("automated response");
  });

  it("a low threshold is honoured within a match (0.6 passes at 0.4, fails at 0.7)", async () => {
    settings({ confidenceThreshold: 0.4 });
    expect((await score(0.6)).shouldAutoRespond).toBe(true);
    settings({ confidenceThreshold: 0.7 });
    expect((await score(0.6)).shouldAutoRespond).toBe(false);
  });

  it("no match at all never auto-responds, however high the confidence and low the threshold", async () => {
    // The match is a hard gate: a confident answer with nothing behind it is still a guess.
    settings({ confidenceThreshold: 0 });
    const noMatch = await calculateConfidence({ category: "support" } as any, 0, 20, 0, 0.99);
    expect(noMatch.confidenceScore).toBe(0);
    expect(noMatch.shouldAutoRespond).toBe(false);
    expect(noMatch.reasoning).toContain("No matching solution found");
  });

  it("a similar resolved ticket is a real match, even with no knowledge article", async () => {
    settings({ confidenceThreshold: 0.4 });
    const resolvedMatch = await calculateConfidence({ category: "other" } as any, 0, 50, 1, 0.6);
    expect(resolvedMatch.confidenceScore).toBeCloseTo(0.6);
    expect(resolvedMatch.shouldAutoRespond).toBe(true);
    expect(resolvedMatch.reasoning).toContain("automated response");
  });

  it("auto-response switched off: never auto-responds, whatever the confidence or threshold", async () => {
    settings({ autoResponseEnabled: false, confidenceThreshold: 0.1 });
    expect((await score(0.95)).shouldAutoRespond).toBe(false);
  });

  it("switched on again: it does", async () => {
    settings({ autoResponseEnabled: true, confidenceThreshold: 0.1 });
    expect((await score(0.95)).shouldAutoRespond).toBe(true);
  });

  it("settings are read on every call, not cached", async () => {
    settings({ confidenceThreshold: 0.9 });
    expect((await score(0.8)).shouldAutoRespond).toBe(false);
    settings({ confidenceThreshold: 0.7 });
    expect((await score(0.8)).shouldAutoRespond).toBe(true);
    expect(mockGetAISettings).toHaveBeenCalledTimes(2);
  });

  it("explains the number with the article counts and complexity, without letting them move it", async () => {
    settings({ confidenceThreshold: 0.7 });
    const r = await calculateConfidence(ticket, 2, 30, 1, 0.75);
    expect(r.confidenceScore).toBeCloseTo(0.75);
    expect(r.reasoning).toContain("2 knowledge base matches");
    expect(r.reasoning).toContain("1 similar resolved tickets");
    expect(r.reasoning).toContain("complexity score of 30");
    expect(r.reasoning).toContain("model-reported");
  });
});
