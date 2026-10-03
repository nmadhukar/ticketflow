/**
 * Identity of the AI system user, with no imports so any module (including
 * ones loaded by unit tests without a database) may use it.
 * The row itself is created by server/utils/aiSystemUser.ts.
 */
export const AI_SYSTEM_USERNAME = "ai-assistant";
export const AI_SYSTEM_USER_ID = AI_SYSTEM_USERNAME;
export const AI_SYSTEM_USER_EMAIL = "ai-assistant@ticketflow.invalid";

export function isAiSystemUserId(id: unknown): boolean {
  return id === AI_SYSTEM_USER_ID;
}

/**
 * The legacy "system" user (role admin, active, no password) that machine-made
 * rows such as AI settings and API keys are attributed to. It cannot sign in.
 * Rows reference it, so it stays; it is hidden like the AI system user instead.
 */
export const LEGACY_SYSTEM_USER_ID = "system";
export const LEGACY_SYSTEM_USER_EMAIL = "system@ticketflow.local";

/** Every account that is not a person. The one list behind every listing, picker, count and guard. */
export const SYSTEM_ACCOUNT_IDS: readonly string[] = [AI_SYSTEM_USER_ID, LEGACY_SYSTEM_USER_ID];

export function isSystemAccountId(id: unknown): boolean {
  return typeof id === "string" && SYSTEM_ACCOUNT_IDS.includes(id);
}
