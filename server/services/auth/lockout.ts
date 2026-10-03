/**
 * Login lockout rules. The attempt counter is claimed atomically in
 * storage.claimLoginAttempt (before the password is compared) and cleared by
 * storage.resetFailedLogins. Login and change-password (a wrong current password)
 * spend the same budget.
 *
 * Accepted: the counter does not decay with time. Misses stay counted until a
 * success, a token reset, an admin reset or an expired lock clears them, so slow
 * guessing (fewer than 5 misses between successes) is never forgotten; the
 * per-IP rate limit is the control on guessing speed.
 */

/** Attempts allowed per lock window; the 5th claim starts the lock. */
export const MAX_FAILED_LOGINS = 5;
/** How long a locked account stays locked. */
export const LOCKOUT_MINUTES = 15;
