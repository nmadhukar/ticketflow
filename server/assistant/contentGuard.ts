/**
 * Deterministic content guardrails for text the assistants WRITE.
 *
 * Prompts alone are not a guardrail: the model can be talked into anything, and a manager watching a
 * demo is exactly the moment someone tries. These checks are code, they run before a proposal is
 * recorded, and they cannot be argued with.
 *
 * Two kinds of problem, refused separately so the caller can say which:
 *
 *   abuse   - profanity/insults (English + Telugu/Hindi romanised), an abusive tone aimed at a
 *             person, or threats. A support answer is never allowed to carry these.
 *   secret  - passwords, API keys, tokens, card numbers, or a literal credential the user pasted.
 *             Quoting a customer's password into a public comment is a leak, not a reply.
 *
 * Deliberately narrow: a false positive blocks a real answer, so a term is listed only when it is
 * abusive in every sense (never a normal helpdesk word), and "negative" wording about the PRODUCT
 * ("still failing", "not working") is allowed — that is a fact, not an insult.
 */

export type GuardKind = "abuse" | "secret";

export interface GuardVerdict {
  ok: boolean;
  kind?: GuardKind;
  /** What tripped it, by category only — never the matched text, which may be the abuse itself. */
  reason?: string;
}

/**
 * Abusive words, matched on word boundaries so "ass" does not fire inside "class" or "password".
 * English profanity plus the romanised Telugu/Hindi abuse that actually shows up in support chat on
 * Indian deployments. Ambiguous everyday words ("bitch" in a dog rescue, "sala" as a name) are
 * left out: a false positive blocks a real customer answer, which is worse than a miss.
 */
const ABUSE_WORDS = [
  // English
  "fuck", "fucking", "fucked", "fucker", "shit", "shitty", "bullshit", "bastard", "asshole",
  "dickhead", "motherfucker",
  // Telugu
  "lanja", "lanjakodaka", "lanjakoduka", "pooku", "erripooku", "erripuku", "denguta", "dengudu",
  "moddalo", "sulli", "vedhava", "vedava",
  // Hindi
  "madarchod", "madarchot", "bhenchod", "behenchod", "bhosdike", "bhosdi", "chutiya", "chutiye",
  "chutiyapa", "haramkhor", "gaandu", "bhosda",
] as const;

/** An insult aimed at a person, which the word list alone would miss. */
const INSULT_PATTERNS = [
  /\byou(?:'re| are)(?:\s+(?:such|so|really|just|an?))*\s+(?:idiot|moron|stupid|dumb|useless|worthless|pathetic)\b/i,
  /\b(?:shut up|get lost|screw you|sod off|piss off)\b/i,
  /\bnothing but (?:an? )?(?:idiot|moron|fool)\b/i,
  // Telugu/Hindi: "ney bevanu", "nuvvu waste ra", "bewakoof ho", "pagal hai"
  /\b(?:ney|nuvvu|nuv|tu|tum)\s+(?:waste|useless|pagal|bewakoof|chutiya)\b/i,
];

const THREAT_PATTERNS = [
  /\bi(?:'ll| will)\s+(?:find you|beat you|kill you|hack you|destroy you)\b/i,
  /\b(?:you|nuvvu|tu)\s+(?:will (?:pay|regret)|chanipothav|mar jaega)\b/i,
];

/** Credentials and card numbers. Matched anywhere, because a key is not a word. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}/, "an API key"],
  [/\bghp_[A-Za-z0-9]{20,}/, "an access token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "an access token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a JSON web token"],
  [/(?:password|passwd|pwd)\s*(?:is|:|=)\s*\S{3,}/i, "a password"],
  // A card number: 13-19 digits, optionally grouped. Requires no other digit next to it.
  [/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/, "a card number"],
];

const words = new RegExp(`\\b(?:${ABUSE_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

/**
 * Checks one piece of text. Empty or non-string input is fine (something else rejects it), so this
 * only ever says "refused: …" or "ok".
 */
export function checkAssistantText(text: unknown): GuardVerdict {
  if (typeof text !== "string" || text.trim() === "") return { ok: true };

  for (const [pattern, what] of SECRET_PATTERNS) {
    if (pattern.test(text)) return { ok: false, kind: "secret", reason: `contains ${what}` };
  }
  if (words.test(text)) return { ok: false, kind: "abuse", reason: "contains abusive language" };
  for (const pattern of INSULT_PATTERNS) {
    if (pattern.test(text)) return { ok: false, kind: "abuse", reason: "contains an insult aimed at a person" };
  }
  for (const pattern of THREAT_PATTERNS) {
    if (pattern.test(text)) return { ok: false, kind: "abuse", reason: "contains a threat" };
  }
  return { ok: true };
}

/** The message a refused proposal returns: actionable, and it never repeats the offending text. */
export function guardRefusal(verdict: GuardVerdict): string {
  if (verdict.kind === "secret") {
    return `This draft was refused by the content guard (${verdict.reason}). Ask for the details to be shared another way, and remove it from the text.`;
  }
  return `This draft was refused by the content guard (${verdict.reason}). Rewrite it without insults or threats, or raise it with a manager if the conversation is abusive.`;
}

/** Every free-text field of a proposal payload, for one pass through the guard. */
export function checkProposalPayload(payload: Record<string, unknown>): GuardVerdict {
  for (const value of Object.values(payload)) {
    const verdict = checkAssistantText(value);
    if (!verdict.ok) return verdict;
  }
  return { ok: true };
}
