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
