import {
  DESCRIPTION_TRUNCATION_MARKER,
  estimatePromptTokensForBudget,
  fitDescriptionToBudget,
  MIN_DESCRIPTION_CHARS,
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

  it("is a ceiling, not a bypass: with a cap too small for the prompt itself, the description is sent whole and the budget check downstream is left to block it", () => {
    const description = "x".repeat(5000);
    const kept = fitDescriptionToBudget({ ...base, maxTokensPerRequest: 200, description, log: () => undefined });
    expect(kept).toBe(description);
    expect(estimatePromptTokensForBudget(template(kept)) + base.maxOutputTokens).toBeGreaterThan(200);
  });
});

/**
 * N1: when everything in the prompt except the description is already over the budget, the
 * description used to be cut to the bare marker (keptChars=0) and the model was still called, so it
 * could write a customer-visible reply without ever seeing the ticket text. Now a cut description
 * keeps at least MIN_DESCRIPTION_CHARS characters (or all of a shorter one). Where even that does
 * not fit, nothing is cut: the description is returned whole, as before truncation existed, and the
 * cost monitor's budget check decides whether the call is blocked or runs.
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
  /** The description without the marker, if one was appended. */
  const textOf = (prompted: string | null | undefined) =>
    (prompted ?? "").endsWith(DESCRIPTION_TRUNCATION_MARKER) ? (prompted as string).slice(0, -DESCRIPTION_TRUNCATION_MARKER.length) : (prompted ?? "");

  it("the floor is a named constant of at least 500 characters", () => {
    expect(MIN_DESCRIPTION_CHARS).toBeGreaterThanOrEqual(500);
  });

  it("returns the whole description when the rest of the prompt alone is over the budget, never '[description truncated]' alone", () => {
    const log = jest.fn();
    const description = "y".repeat(5000);
    const kept = run({ description, buildPrompt: templateOf(9000), maxTokensPerRequest: 3000, log });
    expect(kept).toBe(description);
    expect(kept).not.toContain(DESCRIPTION_TRUNCATION_MARKER);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("returns a short description whole too: the repro was 54 characters with a large rest-of-prompt", () => {
    const description = "z".repeat(54);
    expect(run({ description, buildPrompt: templateOf(9000), maxTokensPerRequest: 3000 })).toBe(description);
  });

  it("does not throw: the budget check downstream is what blocks or runs the call", () => {
    expect(() => run({ description: "y".repeat(5000), buildPrompt: templateOf(9000), maxTokensPerRequest: 200 })).not.toThrow();
  });

  it("logs one line with the lengths and the operation, and nothing from the description", () => {
    const log = jest.fn();
    const secret = "my-password-is-hunter2";
    run({ description: `${secret} ${"q".repeat(3000)}`, buildPrompt: templateOf(9000), maxTokensPerRequest: 3000, log });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain("AI prompt description not truncated: below the floor");
    expect(line).toMatch(/operation=generateResponse/);
    expect(line).toMatch(/originalChars=\d+/);
    expect(line).toMatch(/floorChars=500/);
    expect(line).toMatch(/budgetTokens=\d+/);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("qqqq");
  });

  it("returns the description whole when the room left is a few bytes short of the floor", () => {
    const buildPrompt = templateOf(2000);
    const maxTokensPerRequest = capLeaving(MIN_DESCRIPTION_CHARS - 3, buildPrompt);
    const description = "y".repeat(5000);
    expect(run({ description, buildPrompt, maxTokensPerRequest })).toBe(description);
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

  it("measures the floor in characters, not bytes: 500 four-byte characters do not fit in 1500 bytes, so that description is not cut", () => {
    const buildPrompt = templateOf(2000);
    const maxTokensPerRequest = capLeaving(1500, buildPrompt);
    const emoji = "😀".repeat(2000);
    expect(run({ description: emoji, buildPrompt, maxTokensPerRequest })).toBe(emoji);
    // The same room is plenty for 500 ASCII characters, which are cut to what fits.
    const ascii = "y".repeat(2000);
    const kept = run({ description: ascii, buildPrompt, maxTokensPerRequest }) as string;
    expect(kept.endsWith(DESCRIPTION_TRUNCATION_MARKER)).toBe(true);
    expect(textOf(kept).length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
  });

  it("no prompt is ever built with fewer than min(500, length) characters of the description, at any cap", () => {
    const descriptions = [
      "z".repeat(54),
      "w".repeat(499),
      "w".repeat(500),
      "w".repeat(501),
      "y".repeat(5000),
      "日本語のチケット。".repeat(1000), // 3 bytes per character
      "😀".repeat(2000), // 4 bytes per character
      "Привет мир ".repeat(500), // 2 bytes per character
    ];
    let cases = 0;
    for (const otherChars of [0, 800, 2000, 4000, 9000]) {
      const buildPrompt = templateOf(otherChars);
      for (let cap = 820; cap <= 4600; cap += 13) {
        for (const description of descriptions) {
          const kept = fitDescriptionToBudget({ description, buildPrompt, maxTokensPerRequest: cap, maxOutputTokens: OUTPUT, operation: "generateResponse", log: () => undefined });
          const text = textOf(kept);
          const wanted = Math.min(MIN_DESCRIPTION_CHARS, Array.from(description).length);
          expect(Array.from(text).length).toBeGreaterThanOrEqual(wanted);
          expect(description.startsWith(text)).toBe(true);
          // Either all of it, or a cut that says so.
          if (text !== description) expect(kept!.endsWith(DESCRIPTION_TRUNCATION_MARKER)).toBe(true);
          expect(text).not.toContain("�");
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(1000);
  });

  it("a normal long description is still cut and sent, as before", () => {
    const kept = run({ description: `START ${"x".repeat(10240)} END`, buildPrompt: templateOf(1500), maxTokensPerRequest: 3000 }) as string;
    expect(kept.startsWith("START ")).toBe(true);
    expect(kept.endsWith(DESCRIPTION_TRUNCATION_MARKER)).toBe(true);
    expect(kept.length).toBeGreaterThan(MIN_DESCRIPTION_CHARS);
    expect(kept).not.toContain("END");
  });
});
