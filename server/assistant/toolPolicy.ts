import type { AssistantAgentId } from "@shared/assistant";

/**
 * The MCP tools each assistant may call, by the names the public MCP server registers them under
 * (server/mcp/*). Read tools only for now: writes come later through a proposal and an explicit
 * confirmation in the UI, never as a direct tool call.
 *
 * Listing a tool here grants nothing by itself. Every tool runs as the signed-in user and applies
 * the same service rules as REST (ticketAccess, workspaceReads, document visibility), so a manager
 * or admin sees what their own role sees and a customer only their own tickets.
 *
 * Never listed: update_ticket, close_ticket, reopen_ticket, delete_ticket, create_ticket,
 * add_comment, mark_notifications_read and every document/policy/guideline/knowledge write.
 */
const SHARED_READS = [
  "whoami",
  "list_tickets",
  "get_ticket",
  "get_ticket_history",
  "search_knowledge",
  "get_knowledge_article",
  "search_documents",
  "get_document",
] as const;

/**
 * Tools that PROPOSE a write (proposals.ts): they record a draft the user confirms on a card, and
 * write nothing to tickets. Customers may propose a ticket or a comment; staff a comment only.
 * Switched off as a whole with ASSISTANT_WRITES_ENABLED=false.
 */
export const ASSISTANT_PROPOSAL_TOOLS: Record<AssistantAgentId, readonly string[]> = {
  "support-assistant": ["propose_ticket", "propose_comment"],
  "ticket-assistant": ["propose_comment"],
};

/** Values that switch writes off. Any spelling of "off" an operator might reach for counts. */
const OFF_VALUES = new Set(["false", "0", "off", "no", "disabled"]);

/** On unless switched off: an emergency stop must not depend on the exact word typed. */
export function assistantWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !OFF_VALUES.has(env.ASSISTANT_WRITES_ENABLED?.trim().toLowerCase() ?? "");
}

export const ASSISTANT_READ_TOOLS: Record<AssistantAgentId, readonly string[]> = {
  "support-assistant": SHARED_READS,
  "ticket-assistant": [
    ...SHARED_READS,
    "list_guideline_categories",
    "list_teams",
    "get_team",
    "list_departments",
    "list_users",
    "get_stats",
    "list_activity",
  ],
};
