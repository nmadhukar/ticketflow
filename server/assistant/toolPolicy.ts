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
  "check_citation",
  "list_routing_options",
] as const;

/**
 * Tools that PROPOSE a write (proposals.ts): they record a draft the user confirms on a card, and
 * write nothing to tickets. Customers may propose a ticket or a comment; staff a comment only.
 * Switched off as a whole with ASSISTANT_WRITES_ENABLED=false.
 */
export const ASSISTANT_PROPOSAL_TOOLS: Record<AssistantAgentId, readonly string[]> = {
  // The customer confirms their own ticket is sorted, then closes it from the card.
  "support-assistant": ["propose_ticket", "propose_comment", "propose_close_ticket"],
  "ticket-assistant": ["propose_comment"],
};

/** Values that switch writes off. Any spelling of "off" an operator might reach for counts. */
const OFF_VALUES = new Set(["false", "0", "off", "no", "disabled"]);

/** On unless switched off: an emergency stop must not depend on the exact word typed. */
export function assistantWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !OFF_VALUES.has(env.ASSISTANT_WRITES_ENABLED?.trim().toLowerCase() ?? "");
}

export const ASSISTANT_READ_TOOLS: Record<AssistantAgentId, readonly string[]> = {
  // 10 read tools.
  "support-assistant": SHARED_READS,
  // 18 read tools + 1 proposal (propose_comment) = 19, the count Mastra Studio shows per agent.
  "ticket-assistant": [
    ...SHARED_READS,
    "list_guideline_categories",
    "list_teams",
    "get_team",
    "list_departments",
    "list_users",
    "get_stats",
    "list_activity",
    "list_notifications",
  ],
};

/**
 * Coverage rule (tests/unit/assistant/toolPolicy): every ticket tool the MCP server registers is
 * either granted to an assistant or recorded here with the reason it is not. This is what keeps the
 * Studio count honest - a new tool cannot silently go missing from both agents.
 */
export const UNGRANTED_TICKET_TOOLS: Record<string, string> = {
  create_ticket: "staff assistant proposes a comment; tickets are created by the customer assistant",
  add_comment: "writes on confirm, via propose_comment",
  update_ticket: "staff write, not exposed to a chat",
  close_ticket: "staff write, not exposed to a chat (the customer offers propose_close_ticket)",
  reopen_ticket: "staff write, not exposed to a chat",
  delete_ticket: "destructive",
  mark_notifications_read: "inbox action, not a chat tool",
};
