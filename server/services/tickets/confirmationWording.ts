/**
 * How a customer's reply reads: "that solved it" or "still broken".
 *
 * Kept free of storage/DB imports so it can be reasoned about (and tested) on its own; the writes
 * that act on the answer are in customerConfirmation.ts.
 *
 * Deliberately conservative: a thank-you that also says it is still broken is a complaint, and
 * anything neither pattern matches changes nothing (the customer can still use the button).
 */

const THANK_YOU =
  /\b(thanks|thank you|thx|ty|worked|that worked|it works|works now|fixed|sorted|resolved|solved|great|perfect|all good|yes,? (that|it)|no issue)\b/i;
/** A reply that also says it is still broken is a complaint, never a confirmation. */
const STILL_BROKEN =
  /\b(not (fixed|working|resolved|solved)|still (not|broken|failing|happening|an issue|the same)|doesn'?t work|didn'?t work|same problem|no luck)\b/i;

/** True when a customer's reply reads as "that solved it". */
export function isConfirmationReply(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (STILL_BROKEN.test(value)) return false;
  return THANK_YOU.test(value);
}

/** True when a customer's reply says the problem is still there. */
export function isNotFixedReply(text: string): boolean {
  return STILL_BROKEN.test(text);
}
