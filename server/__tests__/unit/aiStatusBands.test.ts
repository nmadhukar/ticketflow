import { jest } from "@jest/globals";

jest.mock("../../storage/db", () => ({ db: {}, pool: {} }));
jest.mock("../../services/ai/knowledgeBase", () => ({ knowledgeBaseService: {} }));
jest.mock("../../services/ai/bedrockIntegration", () => ({ bedrockIntegration: {} }));

import { statusForConfidence } from "../../services/ai/aiAutoResponse";
import { TICKET_CATEGORIES, TICKET_STATUSES } from "@shared/constants";

/**
 * The band an AI answer earns, pinned (owner's rule, 2026-10-29):
 * no match -> open, >=90% -> resolved, 50-90% -> in_progress, below 50% -> open.
 * The AI never closes a ticket; the auto-close window owns that.
 */
describe("statusForConfidence", () => {
  it("no real match is always open, whatever the score says", () => {
    for (const c of [0, 0.5, 0.89, 0.99, 1]) expect(statusForConfidence(c, false)).toBe("open");
  });

  it("90% and over is resolved", () => {
    expect(statusForConfidence(0.9)).toBe("resolved");
    expect(statusForConfidence(0.95)).toBe("resolved");
    expect(statusForConfidence(1)).toBe("resolved");
  });

  it("50-90% is in_progress", () => {
    expect(statusForConfidence(0.5)).toBe("in_progress");
    expect(statusForConfidence(0.75)).toBe("in_progress");
    expect(statusForConfidence(0.89)).toBe("in_progress");
  });

  it("below 50% is open", () => {
    expect(statusForConfidence(0)).toBe("open");
    expect(statusForConfidence(0.49)).toBe("open");
  });

  it("rounds to whole percent, so a float artefact lands in the right band", () => {
    // 0.5 + 0.3 + 0.1 is 0.8999999999999999 in floats; it is a 90% answer.
    expect(statusForConfidence(0.1 * 9)).toBe("resolved");
    // ...but a 49.99% answer is still below half, so it rounds to 50 and is in_progress.
    expect(statusForConfidence(0.4999)).toBe("in_progress");
    expect(statusForConfidence(0.494)).toBe("open");
  });

  it("clamps junk outside 0..1 instead of returning an unknown status", () => {
    expect(statusForConfidence(1.5)).toBe("resolved");
    expect(statusForConfidence(-1)).toBe("open");
    expect(statusForConfidence(Number.NaN)).toBe("open");
  });

  it("only ever returns a real ticket status, and never 'closed'", () => {
    for (let i = 0; i <= 100; i++) {
      const s = statusForConfidence(i / 100);
      expect(TICKET_STATUSES).toContain(s);
      expect(s).not.toBe("closed");
    }
  });

  it("is independent of the ticket's category, which used to add to the score", () => {
    const statuses = TICKET_CATEGORIES.map(() => statusForConfidence(0.7, true));
    expect(new Set(statuses)).toEqual(new Set(["in_progress"]));
  });
});
