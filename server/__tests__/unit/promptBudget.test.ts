import {
  DESCRIPTION_TRUNCATION_MARKER,
  estimatePromptTokensForBudget,
  fitDescriptionToBudget,
  MIN_DESCRIPTION_CHARS,
  PromptTooLargeError,
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

  it("is a ceiling, not a bypass: with a cap too small for the prompt itself, the call is refused rather than sent without the description", () => {
    const log = jest.fn();
    let thrown: unknown;
    try {
      fitDescriptionToBudget({ ...base, maxTokensPerRequest: 200, description: "x".repeat(5000), log });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PromptTooLargeError);
  });
});

/**
 * N1: when everything in the prompt except the description is already over the budget, the
 * description used to be cut to the bare marker (keptChars=0) and the model was still called, so it
 * could write a customer-visible reply without ever seeing the ticket text. Now at least
 * MIN_DESCRIPTION_CHARS of the description stay in, or the call is refused the way the cost
 * monitor refuses an over-cap request (isBlocked), and nothing is sent.
 */
describe("fitDescriptionToBudget: the floor of ticket text (N1)", () => {
  const OUTPUT = 800;
  const bytes = (text: string) => Buffer.byteLength(text, "utf8");
  /** A template whose non-description part is `otherChars` bytes. */
  const templateOf = (otherChars: number) => (description: string | null | undefined) =>
    `HEAD ${"h".repeat(otherChars)}\nDescription: ${description || "No description provided"}\nTAIL`;
  /** A cap that leaves `room` bytes (or one more, for parity) for the description plus its marker. */
  const capLeaving = (room: number, buildPrompt: ReturnType<typeof templateOf>) => {
    const other = bytes(buildPrompt(DESCRIPTION_TRUNCATION_MARKER));
    return Math.ceil((room + other) / 2) + 16 + OUTPUT;
  };
  const run = (input: { description: string; buildPrompt: ReturnType<typeof templateOf>; maxTokensPerRequest: number; log?: (line: string) => void }) =>
    fitDescriptionToBudget({ operation: "generateResponse", maxOutputTokens: OUTPUT, log: () => undefined, ...input });
  const refusal = (input: Parameters<typeof run>[0]): any => {
    try {
      run(input);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it("the floor is a named constant of at least 500 characters", () => {
    expect(MIN_DESCRIPTION_CHARS).toBeGreaterThanOrEqual(500);
  });

  it("refuses when the rest of the prompt alone is over the budget, instead of sending '[description truncated]' alone", () => {
    const log = jest.fn();
    const error = refusal({ description: "y".repeat(5000), buildPrompt: templateOf(9000), maxTokensPerRequest: 3000, log });
    expect(error).toBeInstanceOf(PromptTooLargeError);
    // The same refusal the cost monitor gives an over-cap request, so every caller treats it alike.
    expect(error.isBlocked).toBe(true);
    expect(error.message).toBe("Request exceeds max tokens per request");
    expect(error.costEstimate).toMatchObject({ estimatedCost: 0 });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("refuses a short description too: the repro was 54 characters with a large rest-of-prompt", () => {
    const error = refusal({ description: "z".repeat(54), buildPrompt: templateOf(9000), maxTokensPerRequest: 3000 });
    expect(error).toBeInstanceOf(PromptTooLargeError);
  });

  it("logs the lengths and the operation, and nothing from the description", () => {
    const log = jest.fn();
    const secret = "my-password-is-hunter2";
    refusal({ description: `${secret} ${"q".repeat(3000)}`, buildPrompt: templateOf(9000), maxTokensPerRequest: 3000, log });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/operation=generateResponse/);
    expect(line).toMatch(/originalChars=\d+/);
    expect(line).toMatch(/floorChars=500/);
    expect(line).toMatch(/budgetTokens=\d+/);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("qqqq");
  });

  it("refuses when the room left is one byte short of the floor", () => {
    const buildPrompt = templateOf(2000);
    const maxTokensPerRequest = capLeaving(MIN_DESCRIPTION_CHARS - 3, buildPrompt);
    expect(refusal({ description: "y".repeat(5000), buildPrompt, maxTokensPerRequest })).toBeInstanceOf(PromptTooLargeError);
  });

  it("keeps the floor, and no fewer characters, when that is all the room there is", () => {
    const buildPrompt = templateOf(2000);
    const maxTokensPerRequest = capLeaving(MIN_DESCRIPTION_CHARS, buildPrompt);
    const kept = run({ description: "y".repeat(5000), buildPrompt, maxTokensPerRequest }) as string;
    expect(kept.endsWith(DESCRIPTION_TRUNCATION_MARKER)).toBe(true);
    const text = kept.slice(0, -DESCRIPTION_TRUNCATION_MARKER.length);
    expect(text.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
    expect(estimatePromptTokensForBudget(buildPrompt(kept)) + OUTPUT).toBeLessThanOrEqual(maxTokensPerRequest);
  });

  it("measures the floor in characters, not bytes: 500 four-byte characters do not fit in 1500 bytes", () => {
    const buildPrompt = templateOf(2000);
    const maxTokensPerRequest = capLeaving(1500, buildPrompt);
    const emoji = "😀".repeat(2000);
    expect(refusal({ description: emoji, buildPrompt, maxTokensPerRequest })).toBeInstanceOf(PromptTooLargeError);
    // The same room is plenty for 500 ASCII characters.
    expect(() => run({ description: "y".repeat(2000), buildPrompt, maxTokensPerRequest })).not.toThrow();
  });

  it("a normal long description is still cut and sent, as before", () => {
    const kept = run({ description: `START ${"x".repeat(10240)} END`, buildPrompt: templateOf(1500), maxTokensPerRequest: 3000 }) as string;
    expect(kept.startsWith("START ")).toBe(true);
    expect(kept.endsWith(DESCRIPTION_TRUNCATION_MARKER)).toBe(true);
    expect(kept.length).toBeGreaterThan(MIN_DESCRIPTION_CHARS);
    expect(kept).not.toContain("END");
  });
});
