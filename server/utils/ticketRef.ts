/**
 * The shape of a ticket number as the UI shows it: a prefix, then one or more
 * dash-separated segments, e.g. TKT-2026-0610 or TKT-1. It is deliberately
 * generous about the exact segments because the company prefix is configurable,
 * but it never matches a bare number or a plain word. So a value that is not a
 * ticket number still reaches the numeric id check and comes back as VALIDATION,
 * which keeps "abc" and the like refused exactly as before.
 */
const TICKET_NUMBER_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+$/;

/** True when `ref` is shaped like a ticket number rather than a database id. */
export const looksLikeTicketNumber = (ref: unknown): ref is string =>
  typeof ref === "string" && TICKET_NUMBER_PATTERN.test(ref);