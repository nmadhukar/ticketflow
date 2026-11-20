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
import { checkUserMessage } from "../../assistant/contentGuard";

/**
 * Guardrails on what the customer TYPES, as a Mastra input processor - the second, in-process layer
 * beside the code-level check in server/copilot/guard.ts (and the model-backed OpenAI moderation at
 * the copilot runtime). A message that is only abuse, a threat or a pasted credential is refused
 * before any ticket tool runs, which is also what keeps an abusive run from spending tokens.
 */
function inputGuardrails() {
  // The deterministic check needs no model and no network: it runs first and answers instantly.
  const abuseCheck = {
    id: "ticketflow-content-guard" as const,
    processInput({ messages, abort }: { messages: unknown[]; abort: (reason?: string) => never }) {
      const verdict = checkUserMessage(lastMessageText(messages));
      if (!verdict.ok) abort("This message was blocked by the content guard. Ask the customer to rephrase politely and to share no credentials.");
      return messages as never;
    },
  };
  return [abuseCheck] as never[];
}

/**
 * The text of the newest message, whatever shape Mastra's MessageList gives it: a string `content`, a
 * content-parts array, or the nested `content.content` of a stored message.
 */
function lastMessageText(messages: unknown[]): string {
  const latest = messages[messages.length - 1] as { content?: unknown } | undefined;
  let content = latest && typeof latest === "object" ? latest.content : undefined;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    content = (content as { content?: unknown }).content;
  }
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => !!part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => (part as { text: string }).text)
    .join("\n");
}

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
  "A ticket number the customer mentioned (TKT-...) is a request about THAT ticket: look it up with",
  "get_ticket, never with propose_ticket.",
  "A REQUEST TO RAISE A TICKET IS ALWAYS ANSWERED WITH propose_ticket, in the same turn, before any",
  "lookup. If the customer asks for a ticket or to record their problem, call propose_ticket first;",
  "do not call get_ticket, search_knowledge or check_citation first, and do not end the turn",
  "without proposing.",
  "First understand the issue. If the problem is not yet clear enough to act on, ask the few",
  "clarifying questions that actually matter (what they were doing, what they expected, what",
  "happened instead, any error message, and since when). Ask at most three questions in one turn,",
  "and never ask for information they already gave.",
  "Ask ONCE, and only when a fact you cannot infer is missing. If the customer has already said",
  "what is wrong and where or when it happens, you have enough: propose the ticket in that SAME",
  "turn, before asking anything. Do not ask a question whose answer would not change the title,",
  "the description, the category or the owning team (a likely cause, an invoice number, a date",
  "range, or how they feel about it are all irrelevant to proposing the ticket). A second round of",
  "questions is only for a detail you genuinely cannot infer, and you must never ask two rounds",
  "of questions in a row.",
  "You may look for an existing answer before proposing anything: call search_knowledge, then",
  "get_knowledge_article on the best match. If a clear fix exists, give it in plain language and",
  "ask whether it solved the problem. Do not propose a ticket the knowledge base already answers",
  "unless the customer says the fix did not work.",
  "CRITICAL: you cannot create tickets yourself. The ONLY way to raise one is propose_ticket, which",
  "shows the customer a card they confirm. There is no create_ticket tool, so never say a ticket was",
  "created and never state a ticket number for it.",
  "When the customer asks to raise, create or open a ticket, call propose_ticket IMMEDIATELY, as the",
  "first and only tool call of that turn. Do NOT call get_ticket, list_tickets, list_routing_options,",
  "search_knowledge or check_citation first, and do not ask a follow-up question: compose the title,",
  "description and category from what they already said and propose in that same turn. A draft they",
  "can review on the card is always better than another question or another lookup.",
  "When you have enough detail, call propose_ticket. Write a short, specific title (not 'Issue' or",
  "'Help') and a description that records what the customer told you.",
  "If you already have the problem and where or when it happens, call propose_ticket NOW, in this",
  "same turn, before writing any question or summary. A slightly incomplete draft is always better",
  "than a conversation that never proposes one: the customer reviews it on the card before anything",
  "is created.",
  "Choose the category from the allowed list. Pick the priority from the impact they described:",
  "urgent only when they are blocked entirely.",
  "To choose the owning department and team, call list_routing_options and pick the closest",
  "match, then pass it as routeId (the team id). If nothing fits, call propose_ticket with no",
  "routeId and say the team will be assigned. It is a suggestion: TicketFlow confirms the",
  "assignment, so never promise a specific team as a fact.",
  "After calling propose_ticket, tell the customer in one sentence to check the card and press",
  "Confirm. The ticket number appears only after they confirm, so never state one for a proposal.",
  "For follow-up, use list_tickets or get_ticket with the number they mention, and get_ticket_history",
  "for how far it has got. Summarise status and progress plainly. Never reveal other customers'",
  "tickets, internal notes, or anything about staff.",
  "If they want to add information to an existing ticket, use propose_comment on that ticket; it is",
  "posted only when they confirm the card. If they say it is sorted, offer propose_close_ticket.",
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
    // Abuse/threat filtering before the model sees the message.
    inputProcessors: inputGuardrails() as never,
    // A customer's first turn may look at the knowledge base, then propose; the default of a few
    // steps ran out mid-flow and the turn ended with neither an answer nor a card.
    defaultOptions: { maxSteps: 12 },
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

