import { createHash } from "crypto";

/**
 * Password reset tokens are stored as a sha256 hex digest; the plain token
 * exists only in the email. A leaked database row is not a usable token.
 */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
