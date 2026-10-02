/**
 * Login lockout rules. Pure functions only; the counter itself is updated by
 * storage.recordFailedLogin / storage.resetFailedLogins.
 */

/** Wrong passwords allowed before the account locks. */
export const MAX_FAILED_LOGINS = 5;
/** How long a locked account stays locked. */
export const LOCKOUT_MINUTES = 15;

type LockState = { failedLoginAttempts?: number | null; lockedUntil?: Date | null };

/** True while the account is inside its lockout window. */
export function isLocked(user: LockState, now: Date = new Date()): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > now.getTime();
}

/** True when a lock has run out and the old failures should be forgotten. */
export function lockExpired(user: LockState, now: Date = new Date()): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() <= now.getTime();
}
