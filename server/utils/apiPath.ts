/**
 * True for `/api` and `/api/...` (any case: Express routes case-insensitively),
 * false for look-alikes such as `/apixyz` or `/api-docs`. The one definition
 * behind the bearer, revocation and forced-password-change checks.
 */
export function isApiPath(path: string | undefined): boolean {
  return /^\/api(\/|$)/i.test(path ?? "");
}
