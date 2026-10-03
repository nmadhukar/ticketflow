import { HttpError } from "./errors";

/** Every id column is a serial (int4): a larger number cannot exist, and the database would answer it with a 500. */
const MAX_ID = 2147483647;

export function parseIdParam(raw: unknown, name = "id"): number {
  const n = typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_ID) {
    throw new HttpError(400, "invalid_id", `${name} must be a positive integer`);
  }
  return n;
}
