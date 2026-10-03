/**
 * Login lockout rules. The attempt counter is claimed atomically in
 * storage.claimLoginAttempt (before the password is compared) and cleared by
 * storage.resetFailedLogins.
 */

/** Attempts allowed per lock window; the 5th claim starts the lock. */
export const MAX_FAILED_LOGINS = 5;
/** How long a locked account stays locked. */
export const LOCKOUT_MINUTES = 15;
