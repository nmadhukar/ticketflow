/**
 * The TicketFlow triage agent.
 *
 * It is a second driver, not a second brain: every capability it has is an MCP tool that the
 * TicketFlow server exposes and authorises, so role checks, validation and audit logging stay
 * in one place. The agent is told to read before it writes and to never post a reply on a
 * guess, which mirrors the create-time gate in server/services/ai.
 */
import { Agent } from "@mastra/core/agent";

export const TICKET_AGENT_INSTRUCTIONS = [
  "You help staff work a TicketFlow ticket queue. Every action goes through the TicketFlow tools.",
  "Start by reading: call get_ticket with includeComments to see the ticket, then search_knowledge",
  "and search_documents with the key words of the problem. Quote the title of anything you used.",
  "Only when a real match exists, draft a reply that answers the customer's actual problem.",
  "Drafting is not sending: do not call add_comment unless the operator explicitly asks you to.",
  "When nothing matches, say so plainly, then name the owning team from list_teams/list_departments",
  "and explain your reasoning in one sentence. Never guess an answer and never invent a source.",
  "Tickets belong to the person whose API key you hold; never describe tickets that are not",
  "returned to you.",
].join(" ");

/** Tool names arrive namespaced by the MCP client, e.g. ticketflow_get_ticket. */
export function createTicketAgent(tools: Record<string, unknown>, modelId: string): Agent {
  return new Agent({
    id: "ticketflow-triage",
    name: "TicketFlow Triage",
    instructions: TICKET_AGENT_INSTRUCTIONS,
    model: modelId,
    tools: tools as never,
  });
}
