import { z } from "zod";
import { TicketError } from "../services/tickets/ticketError";

/**
 * Argument helpers shared by every MCP tool.
 *
 * `id`, `limit` and `offset` accept a value of ANY JSON type, on purpose: any narrower schema
 * (`z.number()`, a number-or-string union) makes the SDK reject a value of another type (null,
 * true, an array, an object) itself, with a plain-text protocol error and no code. With
 * `anyValue` every value reaches the handler, which converts what it can and leaves the rest
 * for the service, whose assertId and listQuerySchema answer a coded VALIDATION
 * (`fieldErrors.id`, `.limit`, `.offset`). The `.describe()` text is what the model reads.
 *
 * Why a union and not `z.unknown()`: `z.unknown()` accepts `undefined`, so zod marks the key
 * optional and gives it no type, and tools/list then told every client that `id` was optional
 * and untyped (I2 of the final review). The union below rejects only `undefined`, so `id` is
 * advertised as required, with number and string the first types listed. A MISSING id is then
 * refused by the SDK (a protocol error), which is the right contract for a key the schema says is
 * required; every id that is present reaches the handler.
 */
// A function, not a shared schema object: one instance used twice makes the JSON schema point at itself with $ref.
export const anyValue = () =>
  z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.unknown()),
  ]);

/** A required id argument (see anyValue), described for the model. */
export const idArg = (what: string) =>
  anyValue().describe(`${what} id: a positive integer, as a number or a string of digits such as "12"`);

export const MAX_INT = 2147483647;
const ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/**
 * R47: a model often sends the id as a string, so a string of plain digits (no sign, space,
 * leading zero or decimal point) up to 2147483647 (int4, the largest id the database holds) is
 * that number. Everything else, "abc", "1.5", "", " 12", a number above int4, stays a VALIDATION.
 * `toId` narrows the type for the service, which re-checks it at run time.
 */
export const toId = (v: unknown): number => {
  if (typeof v === "string" && ID_PATTERN.test(v) && Number(v) <= MAX_INT) return Number(v);
  return v as number;
};

/** The check ticketService.assertId makes, for ids that are not ticket ids (teams, articles). Same message and details. */
export function assertToolId(v: unknown, field = "id"): number {
  const n = toId(v);
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > MAX_INT) {
    throw new TicketError("VALIDATION", `${field} must be a positive integer`, {
      formErrors: [],
      fieldErrors: { [field]: [`Must be a positive integer, at most ${MAX_INT}`] },
    });
  }
  return n;
}

/** limit/offset: a number, or a string of plain digits that is that number; anything else is left for the schema to refuse. */
export const pagingValue = (v: unknown): unknown =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,9})$/.test(v) && Number(v) <= MAX_INT ? Number(v) : v;

/** An absent argument may arrive as null or "" from a client: treat it as not given (as list_tickets does). */
export const given = (v: unknown): unknown => (v === undefined || v === null || v === "" ? undefined : v);
