/**
 * The helpdesk process as a workflow, so the steps are explicit and every step's input and output
 * can be inspected in Studio's Workflows page.
 *
 * The agent does this same work in one conversation (ticket-assistant.ts); the workflow is the
 * auditable version the manager can run step by step: read the ticket, look for what already
 * worked, then draft a customer-ready reply. Each step calls the real agent, so nothing here
 * invents data: every fact still comes from a TicketFlow tool.
 *
 * Run it in Studio: Workflows → helpdesk-resolution → Run, with
 *   { "ticketId": "TKT-2099-0002", "problem": "Invoice export fails with a timeout" }
 */
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { ticketAssistant } from '../agents/ticket-assistant.ts';

const ticketInput = z.object({
  ticketId: z.string().describe('Ticket id or number, e.g. TKT-2099-0002'),
  problem: z.string().describe("The customer's own words"),
});

const summary = z.object({
  ticketId: z.string(),
  summary: z.string(),
});

const findings = summary.extend({
  similarTickets: z.array(z.string()),
  sources: z.array(z.string()),
});

const resolution = findings.extend({
  reply: z.string(),
});

/** Step 1: read the ticket and state the problem in one line. */
const readTicket = createStep({
  id: 'read-ticket',
  description: 'Reads the ticket with its comments and summarises the problem.',
  inputSchema: ticketInput,
  outputSchema: summary,
  execute: async ({ inputData }) => {
    const result = await ticketAssistant.generate(
      `Read ticket ${inputData.ticketId} with its comments. Summarise the problem in one sentence, ` +
      `naming the ticket number and its status. The customer said: "${inputData.problem}"`,
    );
    return { ticketId: inputData.ticketId, summary: result.text };
  },
});

/** Step 2: find similar tickets and the resolution that worked, with sources. */
const findSimilar = createStep({
  id: 'find-solution',
  description: 'Searches similar tickets and the knowledge base for a fix that already worked.',
  inputSchema: summary,
  outputSchema: findings,
  execute: async ({ inputData }) => {
    const result = await ticketAssistant.generate(
      `For ${inputData.ticketId}: ${inputData.summary}\n` +
      'Find similar tickets with list_tickets and get_ticket_history, then the best knowledge ' +
      'article with search_knowledge and get_knowledge_article. List the ticket numbers you used ' +
      'and the article titles in a plain list, then the fix that worked.',
    );
    const ticketNumbers = [...new Set(result.text.match(/TKT-\d{4}-\d+/g) ?? [])].filter((id) => id !== inputData.ticketId);
    const sources = [...new Set(result.text.match(/"[^"]{4,80}"/g) ?? [])].map((title) => title.replace(/"/g, ''));
    return { ...inputData, similarTickets: ticketNumbers, sources: sources.slice(0, 5) };
  },
});

/** Step 3: write the reply the support agent will send. Nothing is posted here. */
const draftReply = createStep({
  id: 'draft-reply',
  description: 'Writes a customer-ready reply. It is a draft: nothing is posted.',
  inputSchema: findings,
  outputSchema: resolution,
  execute: async ({ inputData }) => {
    const result = await ticketAssistant.generate(
      `Write the customer-ready reply for ${inputData.ticketId}.\n` +
      `Problem: ${inputData.summary}\n` +
      `Similar tickets: ${inputData.similarTickets.join(', ') || 'none'}\n` +
      `Sources: ${inputData.sources.join('; ') || 'none'}\n` +
      'Direct answer first, then numbered steps, then what happens next. Cite the ticket ' +
      'numbers and article titles. Do not post it: this is a draft for the support agent.',
    );
    return { ...inputData, reply: result.text };
  },
});

export const helpdeskWorkflow = createWorkflow({
  id: 'helpdesk-resolution',
  description:
    'Resolve a ticket by reusing the fix from similar past tickets and the knowledge base: read, find, draft.',
  inputSchema: ticketInput,
  outputSchema: resolution,
})
  .then(readTicket)
  .then(findSimilar)
  .then(draftReply)
  .commit();
