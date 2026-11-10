/**
 * Acting for a signed-in person over MCP.
 *
 * The copilot popup is used by a customer to raise and follow up their own tickets. It cannot
 * call /api/mcp directly: MCP accepts only an API key (router.requireMcpKey), and a browser must
 * never hold the mcp:tickets key. So the request travels popup -> copilot runtime -> agent ->
 * MCP, and the agent sends X-TicketFlow-Act-As with the signed-in user's id.
 *
 * That header is the one piece of trust in this flow, so it is gated twice:
 *
 *   1. There must be a run in progress for this exact person, recorded by the agent's tool
 *      wrapper. An external client holding a valid key has none, so its header is ignored.
 *   2. The impersonated user must be SAY-SO-ABLE: the copilot may act for a customer or an
 *      agent, never for an admin or a manager, so a copilot session cannot reach an admin tool
 *      even though the key behind it could.
 *
 * Why an explicit store rather than AsyncLocalStorage: Mastra runs each tool on its own async
 * chain, so a scope set around the HTTP request (or around the agent call) is already gone when
 * the MCP fetch happens (measured). The identity is therefore opened around each tool execution
 * in server/mastra/agents/ticket-agent.ts and read at fetch time in server/mastra/mcp.ts.
 */
import type { User } from "@shared/schema";

export const ACT_AS_HEADER = "x-ticketflow-act-as";

/** Roles a copilot session may act for. Admin and manager are deliberately excluded. */
const ACTABLE_ROLES = new Set(["customer", "agent"]);

/** Who the agent is currently working for, if anyone. */
interface RunScope {
  userId: string;
}

let current: RunScope | null = null;

/** The identity of the run in progress, or null. Read by the MCP client at fetch time. */
export function activeActorId(): string | null {
  return current?.userId ?? null;
}

/**
 * Opens a run for `actor` and returns its closer.
 *
 * The agent's `stream()` returns before the run has happened: the model's tool calls execute
 * while the caller consumes the stream. So the identity is set here and cleared only when the
 * stream ends, which is what makes every fetch during that run act for this person.
 *
 * `close` clears the identity only if it still belongs to this run, so a run that is closed late
 * can never wipe the identity of a newer one.
 */
export function openRun(actor: { id: string }): { close: () => void } {
  current = { userId: actor.id };
  return {
    close: () => {
      if (current?.userId === actor.id) current = null;
    },
  };
}

/** Closes whatever run is open (shutdown, tests). */
export function endRun(): void {
  current = null;
}

/**
 * The identity the MCP router should use for this request, or null to stay the key owner.
 *
 * `claimedId` is the id the copilot recorded for the run in progress. It is taken as the user id
 * directly, not compared with the key owner: the key owner is an admin (the service account the
 * copilot borrows), and comparing with it made every request fall back to that admin.
 *
 * The user is loaded here so the actor is a real customer/agent row, with the role the tools and
 * every permission rule read. A missing, inactive or privileged account is refused.
 */
export async function resolveActAsUser(headerValue: string | undefined): Promise<User | null> {
  const claimedId = headerValue?.trim();
  if (!claimedId) return null;

  // Only inside a run the copilot recorded for this exact person.
  if (!current || current.userId !== claimedId) return null;

  const { storage } = await import("../storage");
  const user = await storage.getUser(claimedId);
  if (!user) return null;

  // Only a role the copilot is allowed to speak for, and never privilege escalation.
  if (!ACTABLE_ROLES.has(user.role)) return null;

  return user;
}
