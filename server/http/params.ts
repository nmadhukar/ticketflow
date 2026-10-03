import { HttpError } from "./errors";

export function parseIdParam(raw: unknown, name = "id"): number {
  const n = typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new HttpError(400, "invalid_id", `${name} must be a positive integer`);
  }
  return n;
}
