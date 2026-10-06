import {
  DESCRIPTION_TRUNCATION_MARKER,
  estimatePromptTokensForBudget,
  fitDescriptionToBudget,
} from "../../services/ai/promptBudget";

/**
 * M3: the cap on tokens per request (default 3000) used to block the call outright once a
 * ticket description passed about 4.5 KB. The description is cut to fit instead; everything
 * around it in the prompt (the instructions, the JSON format) is never cut.
 */
const template = (description: string | null | undefined) =>
  `HEADER ${"h".repeat(1200)}\nDescription: ${description || "No description provided"}\nFOOTER CRITICAL FORMAT REQUIREMENTS ${"f".repeat(300)}`;

describe("fitDescriptionToBudget", () => {
  const base = { buildPrompt: template, maxTokensPerRequest: 3000, maxOutputTokens: 800, operation: "analyzeTicket" };

  it("returns a description that already fits unchanged, without logging", () => {
    const log = jest.fn();
    const short = "printer is jammed";
    expect(fitDescriptionToBudget({ ...base, description: short, log })).toBe(short);
    expect(fitDescriptionToBudget({ ...base, description: null, log })).toBeNull();
    expect(fitDescriptionToBudget({ ...base, description: undefined, log })).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("cuts a 10 KB description so the prompt plus the full output allowance fits the cap", () => {
    const log = jest.fn();
    const long = `START ${"x".repeat(10 * 1024)} END`;
    const kept = fitDescriptionToBudget({ ...base, description: long, log }) as string;
    expect(kept.length).toBeLessThan(long.length);
    expect(kept.startsWith("START ")).toBe(true);
    expect(kept.endsWith(DESCRIPTION_TRUNCATION_MARKER)).toBe(true);
    expect(kept).not.toContain("END");
    const prompt = template(kept);
    expect(estimatePromptTokensForBudget(prompt) + base.maxOutputTokens).toBeLessThanOrEqual(base.maxTokensPerRequest);
    // Nothing around the description was cut.
    expect(prompt).toContain("FOOTER CRITICAL FORMAT REQUIREMENTS");
  });

  it("keeps as much of the description as the budget allows (not a token fewer than needed)", () => {
    const long = "y".repeat(20000);
    const kept = fitDescriptionToBudget({ ...base, description: long, log: () => undefined }) as string;
    const prompt = template(kept);
    // One more character would not have fit.
    expect(estimatePromptTokensForBudget(template(`${kept}y`)) + base.maxOutputTokens).toBeGreaterThan(base.maxTokensPerRequest);
    expect(estimatePromptTokensForBudget(prompt) + base.maxOutputTokens).toBeLessThanOrEqual(base.maxTokensPerRequest);
  });

  it("logs the length numbers and nothing from the description", () => {
    const log = jest.fn();
    const secret = "my-password-is-hunter2";
    fitDescriptionToBudget({ ...base, description: `${secret} ${"z".repeat(9000)}`, log });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/originalChars=\d+/);
    expect(line).toMatch(/keptChars=\d+/);
    expect(line).toMatch(/operation=analyzeTicket/);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("zzzz");
  });

  it("does not split a multi-byte character at the cut", () => {
    const long = "日本語のチケット。".repeat(2000); // 3 bytes per character
    const kept = fitDescriptionToBudget({ ...base, description: long, log: () => undefined }) as string;
    expect(kept).not.toContain("�");
    expect(kept.endsWith(DESCRIPTION_TRUNCATION_MARKER)).toBe(true);
    expect(estimatePromptTokensForBudget(template(kept)) + base.maxOutputTokens).toBeLessThanOrEqual(base.maxTokensPerRequest);
  });

  it("is a ceiling, not a bypass: with a cap too small for the prompt itself, the description is dropped and the prompt still does not fit", () => {
    const kept = fitDescriptionToBudget({ ...base, maxTokensPerRequest: 200, description: "x".repeat(5000), log: () => undefined }) as string;
    expect(kept).toBe(DESCRIPTION_TRUNCATION_MARKER);
    expect(estimatePromptTokensForBudget(template(kept)) + base.maxOutputTokens).toBeGreaterThan(200);
  });
});
