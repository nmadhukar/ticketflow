/**
 * The in-app assistant: which agent each role talks to.
 *
 * The agents run in the Mastra sidecar (agents/). That package cannot import this file (it is its
 * own Docker build context), so agents/src/mastra/session-token.ts repeats the ids, and
 * server/__tests__/unit/assistant/sessionToken.contract.test.ts holds the two together.
 */
export const ASSISTANT_AGENT_IDS = ["support-assistant", "ticket-assistant"] as const;
export type AssistantAgentId = (typeof ASSISTANT_AGENT_IDS)[number];

export function isAssistantAgentId(value: unknown): value is AssistantAgentId {
  return (ASSISTANT_AGENT_IDS as readonly unknown[]).includes(value);
}

/**
 * The agent for a role that has already been through normalizeRole (server/permissions/roles.ts).
 * Customers get the support assistant; agents, managers and admins the ticket assistant. A manager
 * or admin gets no wider access from this: every tool still applies that user's own permissions.
 * Anything else (null, an unknown role) has no assistant.
 */
export function agentForRole(role: string | null | undefined): AssistantAgentId | null {
  switch (role) {
    case "customer":
      return "support-assistant";
    case "agent":
    case "manager":
    case "admin":
      return "ticket-assistant";
    default:
      return null;
  }
}
