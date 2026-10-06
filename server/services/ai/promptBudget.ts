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

/**
 * The least ticket text a cut prompt may carry (N1). A description is never cut below this many
 * characters (or its own length, if shorter): a model that has not seen the ticket must not write a
 * reply the customer will read. Where even this much does not fit, the description is not cut at
 * all and the budget check downstream decides, as it did before descriptions were truncated.
 */
export const MIN_DESCRIPTION_CHARS = 500;

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
 * It does not lift the ceiling, and it never trades the ticket text away to stay under it. A cut
 * description keeps at least MIN_DESCRIPTION_CHARS characters (all of it, if it is shorter). When
 * the rest of the prompt leaves less room than that, cutting cannot help: the description is
 * returned whole, exactly as before truncation existed, and the cost monitor's budget check
 * (assertBudgetAvailable) blocks the call if it is over the cap or lets it run with a smaller
 * output allowance. So a prompt carries either the floor or more of the ticket, or all of it, and
 * nothing is refused that the old code would have run. The log lines carry only lengths and the
 * operation name.
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

  const log = input.log ?? ((line: string) => console.warn(line));
  // The floor counts characters (code points), not bytes: 500 characters of any script.
  const floor = Array.from(description.slice(0, MIN_DESCRIPTION_CHARS * 2)).slice(0, MIN_DESCRIPTION_CHARS).join("");
  if (room < Buffer.byteLength(floor, "utf8")) {
    log(
      `AI prompt description not truncated: below the floor [operation=${input.operation} ` +
        `originalChars=${description.length} floorChars=${floor.length} budgetTokens=${budgetTokens}]`
    );
    return description;
  }

  // A cut inside a multi-byte character decodes to U+FFFD; drop it rather than send it.
  const kept = Buffer.from(description, "utf8").subarray(0, room).toString("utf8").replace(/�+$/, "").trimEnd();
  log(
    `AI prompt description truncated to fit the token cap [operation=${input.operation} ` +
      `originalChars=${description.length} keptChars=${kept.length} budgetTokens=${budgetTokens}]`
  );
  return `${kept}${DESCRIPTION_TRUNCATION_MARKER}`;
}
