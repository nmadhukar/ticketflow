import { Agent } from '@mastra/core/agent';
import { modelRouterId } from '../config.ts';
import { loadRunTools } from '../mcp.ts';
import { FORMAT_RULES, SAFETY_RULES } from './rules.ts';

/**
 * The staff assistant, for agents, managers and admins. Each sees exactly what their own role
 * sees in TicketFlow: the app runs every tool as the signed-in user, so a manager or admin gets no
 * wider access from the assistant than from the app itself.
 *
 * Read-only for now. Posting a comment arrives as a proposal the user confirms in the app.
 */
export const STAFF_INSTRUCTIONS = `You help TicketFlow support staff work their ticket queue.
${SAFETY_RULES}
${FORMAT_RULES}
For a ticket, read it with its comments first, then its history when progress or ownership
matters. To find a fix, search the knowledge base and the documents with the key words of the
problem, and read the best match before relying on it.
When asked for a reply, draft it as text for the user to review and post themselves. Drafting is
not sending: say clearly that nothing was posted. Base a draft only on a real match or on what
the ticket says; when nothing matches, say so and suggest the next step instead.
For workload or queue questions, use the ticket list, statistics and activity, and say what the
numbers cover. Name the owning team only from the teams and departments the tools return.
Answer only from what the tools returned for this user. If a ticket is not found for them, say
only that it was not found for them (it may exist outside their access, so never say it does not
exist) and draft nothing about it: no reply, no summary, no guess at its contents.`;

export const ticketAssistant = new Agent({
  id: 'ticket-assistant',
  name: 'TicketFlow Ticket Assistant',
  description: 'Helps support staff research tickets, find fixes and draft replies.',
  model: modelRouterId('ticket-assistant'),
  tools: loadRunTools,
  instructions: STAFF_INSTRUCTIONS,
  defaultOptions: { maxSteps: 8 },
});
