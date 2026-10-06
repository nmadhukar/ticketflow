/**
 * Keeps a ticket description inside the per-request token cap (M3).
 *
 * The cap (AI settings, maxTokensPerRequest, default 3000) is a ceiling on a request's prompt
 * plus the output it may produce, and assertBudgetAvailable enforces it. The prompt templates
 * put the ticket description in verbatim, so an emailed ticket past about 4.5 KB used to push the
 * prompt over the cap and the call was blocked outright: no analysis, no auto-response, and only
 * "blocked_by_cost_limit" in the log. The description is the one part of a prompt whose size the
 * sender controls, so it is the part that gets cut. The instructions and the JSON format around
 * it never are, and the cap itself is unchanged.
 *
 * This module is pure (no storage, no settings) so it can be tested without a database.
 */

/** Conservatively estimate multilingual prompt tokens for budget preflight. */
export function estimatePromptTokensForBudget(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 2) + 16;
}

/** Appended where a description was cut, so the model knows the text it was given is partial. */
export const DESCRIPTION_TRUNCATION_MARKER = "\n[description truncated]";

export interface FitDescriptionInput {
  description: string | null | undefined;
  /** The full prompt for a given description. It must insert the description verbatim, once. */
  buildPrompt: (description: string | null | undefined) => string;
  maxTokensPerRequest: number;
  /** The output the call will ask for. It stays available: the input is cut to leave room for it. */
  maxOutputTokens: number;
  operation: string;
  log?: (line: string) => void;
}

/**
 * The description to put in the prompt: the original when the prompt plus `maxOutputTokens` fits
 * under `maxTokensPerRequest`, otherwise its start cut (on a character boundary) to the longest
 * text that fits, followed by DESCRIPTION_TRUNCATION_MARKER. The log line carries only length
 * numbers and the operation name, never any of the text.
 *
 * It does not lift the ceiling. If the prompt cannot fit even with no description (a cap set
 * absurdly low, or other parts of the prompt too large), the call is still blocked downstream.
 */
export function fitDescriptionToBudget(input: FitDescriptionInput): string | null | undefined {
  const { description, buildPrompt } = input;
  if (!description) return description;
  const budgetTokens = input.maxTokensPerRequest - input.maxOutputTokens;
  if (estimatePromptTokensForBudget(buildPrompt(description)) <= budgetTokens) return description;

  // estimate = ceil(bytes / 2) + 16, so the prompt may hold at most 2 * (budget - 16) bytes. The
  // prompt built around the marker alone is everything but the description text, marker included.
  const maxPromptBytes = 2 * (budgetTokens - 16);
  const room = maxPromptBytes - Buffer.byteLength(buildPrompt(DESCRIPTION_TRUNCATION_MARKER), "utf8");
  // The description is not what makes the prompt too big: cutting it would not help.
  if (room >= Buffer.byteLength(description, "utf8")) return description;

  const kept =
    room > 0
      ? // A cut inside a multi-byte character decodes to U+FFFD; drop it rather than send it.
        Buffer.from(description, "utf8").subarray(0, room).toString("utf8").replace(/�+$/, "").trimEnd()
      : "";
  const log = input.log ?? ((line: string) => console.warn(line));
  log(
    `AI prompt description truncated to fit the token cap [operation=${input.operation} ` +
      `originalChars=${description.length} keptChars=${kept.length} budgetTokens=${budgetTokens}]`
  );
  return `${kept}${DESCRIPTION_TRUNCATION_MARKER}`;
}
