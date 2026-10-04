/**
 * Login lockout rules. The attempt counter is claimed atomically in
 * storage.claimLoginAttempt (before the password is compared) and cleared by
 * storage.resetFailedLogins. Login and change-password (a wrong current password)
 * spend the same budget.
 *
 * Decay (R53): the counter restarts at 1 when a whole lockout window
 * (LOCKOUT_MINUTES) has passed since the last failed attempt, recorded in
 * users.last_failed_login_at (never sent to clients). So a person who mistypes
 * now and then is not locked out by misses spread over days, while 5 misses
 * inside one window still lock. A row from before that column existed (a NULL
 * stamp) counts as it always did, until its next miss stamps it. A success, a
 * token reset, an admin reset or an expired lock clears the count and the stamp.
 * Slow guessing (one miss per window) is not stopped here; the per-IP rate limit
 * is the control on guessing speed.
 */

/** Attempts allowed per lock window; the 5th claim starts the lock. */
export const MAX_FAILED_LOGINS = 5;
/** How long a locked account stays locked. */
export const LOCKOUT_MINUTES = 15;
