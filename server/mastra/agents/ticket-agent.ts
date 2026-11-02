/**
 * The TicketFlow triage agent.
 *
 * It is a second driver, not a second brain: every capability it has is an MCP tool that the
 * TicketFlow server exposes and authorises, so role checks, validation and audit logging stay
 * in one place. The agent is told to read before it writes and to never post a reply on a
 * guess, which mirrors the create-time gate in server/services/ai.
 *
 * Two jobs share this one agent, chosen by who is talking:
 *
 *   staff (no actor)  - read a ticket, find the fix, name the owning team.
 *   customer (copilot) - raise a ticket from a conversation and follow it up. See
 *                        CUSTOMER_INSTRUCTIONS; the tool list is narrowed by the caller.
 */
import { Agent } from "@mastra/core/agent";
import { openRun } from "../../mcp/actAs";

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

/**
 * A customer raising and following up their own tickets through the copilot.
 *
 * The rules that matter:
 * - Ask before creating, but only what is missing, and at most a few questions: the customer is
 *   describing a problem, not filling in a form. Never invent details they did not give.
 * - The ticket is created as THIS customer (the tools are already scoped to them), so it shows
 *   up in their own list and they can follow it up later.
 * - The department/team is a SUGGESTION (routeId). The right team is confirmed by TicketFlow's
 *   routing when the ticket is created, so never promise the customer an owner as a fact.
 * - The AI may answer from the knowledge base before a ticket is even created; if a known fix
 *   exists, offer it first and create a ticket only if it did not help.
 */
export const CUSTOMER_INSTRUCTIONS = [
  "You are TicketFlow's support assistant, talking to a customer about their own problem.",
  "First understand the issue. If the problem is not yet clear enough to act on, ask the few",
  "clarifying questions that actually matter (what they were doing, what they expected, what",
  "happened instead, any error message, and since when). Ask at most three questions in one turn,",
  "and never ask for information they already gave.",
  "Ask ONCE, and only when a fact you cannot infer is missing. If the customer has already said",
  "what is wrong and where or when it happens, you have enough: create the ticket in that SAME",
  "turn, before asking anything. Do not ask a question whose answer would not change the title,",
  "the description, the category or the owning team (a likely cause, an invoice number, a date",
  "range, or how they feel about it are all irrelevant to creating the ticket). A second round of",
  "questions is only for a detail you genuinely cannot infer, and you must never ask two rounds",
  "of questions in a row.",
  "You may look for an existing answer before creating anything: call search_knowledge, then",
  "get_knowledge_article on the best match. If a clear fix exists, give it in plain language and",
  "ask whether it solved the problem. Do not create a ticket the knowledge base already answers",
  "unless the customer says the fix did not work.",
  "When you have enough detail, create the ticket with create_ticket. Write a short, specific",
  "title (not 'Issue' or 'Help') and a description that records what the customer told you.",
  "If you already have the problem and where or when it happens, call create_ticket NOW, in this",
  "same turn, before writing any question or summary. A ticket with a slightly incomplete",
  "description is always better than a conversation that never creates one: staff can ask for",
  "more detail on the ticket itself.",
  "Choose the category from the allowed list. Pick the priority from the impact they described:",
  "urgent only when they are blocked entirely.",
  "To choose the owning department and team, call list_routing_options and pick the closest",
  "match, then pass it as routeId (the team id). If nothing fits, call create_ticket with no",
  "routeId and say the team will be assigned. It is a suggestion: TicketFlow confirms the",
  "assignment, so never promise a specific team as a fact.",
  "After creating, tell the customer the ticket number and what happens next, in one short",
  "paragraph. Never invent a ticket number: use the one create_ticket returned.",
  "For follow-up, use list_tickets or get_ticket with the number they mention, and get_ticket_history",
  "for how far it has got. Summarise status and progress plainly. Never reveal other customers'",
  "tickets, internal notes, or anything about staff.",
  "If they want to add information to an existing ticket, use add_comment on that ticket.",
].join(" ");

/** Who the agent is speaking for. Absent means the standalone service (staff, the key owner). */
export interface CopilotActor {
  id: string;
  role: string;
}

export function instructionsFor(role: string | undefined): string {
  return role === "customer" ? CUSTOMER_INSTRUCTIONS : TICKET_AGENT_INSTRUCTIONS;
}

/** Tool names arrive namespaced by the MCP client, e.g. ticketflow_get_ticket. */
export function createTicketAgent(
  tools: Record<string, unknown>,
  model: unknown,
  role?: string,
  /**
   * Who the agent's runs are for, when it was built for a signed-in person (the copilot). Each
   * run is recorded for its whole life, which is how the MCP calls it makes carry that person's
   * identity (see server/mcp/actAs.ts). Omitted by the standalone service, which acts as the
   * API key's owner and needs no wrapper at all.
   */
  actor?: { id: string },
): Agent {
  const agent = new Agent({
    id: "ticketflow-triage",
    name: "TicketFlow Triage",
    instructions: instructionsFor(role),
    model: model as never,
    tools: (actor ? bindToolsToRun(tools, actor) : tools) as never,
  });
  if (!actor) return agent;

  // The run is opened around `stream`/`generate` for the cheap cases, but the authoritative
  // marker is set per tool execution (see bindToolsToRun): that is the only point guaranteed to
  // be inside the run, because Mastra executes tools on its own async chain.

  // `generate` finishes before it returns, so the run can be opened around the promise.
  const generate = agent.generate.bind(agent) as (...args: unknown[]) => Promise<unknown>;
  (agent as unknown as Record<string, unknown>).generate = (...args: unknown[]) => {
    const run = openRun(actor);
    return generate(...args).finally(run.close);
  };

  // `stream` returns at once; the model's tool calls happen while the caller consumes it, so the
  // run must stay open until the stream ends. The result object keeps its identity (the bridge
  // reads its fields and awaits its stream); only its `fullStream` is replaced.
  const stream = agent.stream.bind(agent) as (...args: unknown[]) => unknown;
  (agent as unknown as Record<string, unknown>).stream = (...args: unknown[]) => {
    const result = stream(...args) as Record<string, unknown>;
    const source = result?.fullStream;
    if (!source || typeof (source as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") {
      return result;
    }
    return holdRunOpen(result, source as AsyncIterable<unknown>, actor);
  };
  return agent;
}

/**
 * Wraps every tool so each execution records who the run is for, for exactly its duration.
 *
 * This is where the identity MUST be set. Mastra executes a tool on its own async chain, and the
 * agent's `stream()` returns before its tools run, so neither an ambient scope around the HTTP
 * request nor a scope around `stream()` is still alive when the MCP fetch happens. The tool's own
 * execute call is: it runs immediately before the fetch and finishes after it.
 *
 * Tools are shallow-copied, so the shared catalog is never mutated.
 */
function bindToolsToRun(
  tools: Record<string, unknown>,
  actor: { id: string },
): Record<string, unknown> {
  const bound: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const original = (tool as { execute?: (...args: unknown[]) => Promise<unknown> }).execute;
    if (typeof original !== "function") {
      bound[name] = tool;
      continue;
    }
    bound[name] = {
      ...(tool as Record<string, unknown>),
      execute: async (...args: unknown[]) => {
        const run = openRun(actor);
        try {
          return await original(...args);
        } finally {
          run.close();
        }
      },
    };
  }
  return bound;
}
function holdRunOpen(
  result: Record<string, unknown>,
  source: AsyncIterable<unknown>,
  actor: { id: string },
): Record<string, unknown> {
  const run = openRun(actor);
  result.fullStream = (async function* () {
    try {
      yield* source;
    } finally {
      run.close();
    }
  })();
  return result;
}
