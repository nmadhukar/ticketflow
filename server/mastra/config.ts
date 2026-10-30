/**
 * Configuration for the standalone Mastra agent service.
 *
 * Like Hindsight (see server/env.ts), the switch and the coordinates live in the environment
 * rather than the database: a database toggle would silently do nothing when no endpoint is
 * set. OFF unless MASTRA_AGENT_ENABLED is exactly "true", the same shape as
 * TEAMS_WEBHOOKS_ENABLED (R84).
 *
 * The service is a second, optional driver of the SAME MCP endpoint the DeepSeek Harness
 * uses. It changes nothing in the TicketFlow app: with the switch off, this process is never
 * started and no Mastra code is loaded.
 */
import { DEFAULT_MASTRA_MODEL_ID, isLocalModel } from "./model";
import { readOpenRouterApiKey } from "../env";

export interface MastraAgentConfig {
  /** Port for the standalone agent service. Not the TicketFlow port. */
  port: number;
  /** TicketFlow's MCP endpoint, e.g. http://localhost:5000/api/mcp. */
  mcpUrl: string;
  /** An API key carrying mcp:tickets. The plaintext, never logged. */
  mcpKey: string;
  /** Model router id, in Mastra's "provider/model" form, e.g. openrouter/meta-llama/llama-3.3-70b-instruct. */
  modelId: string;
  /**
   * The MCP tools the agent may call, or null for all of them.
   *
   * Every tool's JSON schema is part of the prompt, and the 31 ticket tools are roughly 11k
   * tokens. A hosted model absorbs that, but a local 8B model on a CPU does not: the prompt
   * alone can outrun the request timeout. Narrowing the list keeps the prompt small enough to
   * answer, and also sharpens the model's choice.
   */
  toolAllowlist: string[] | null;
  /**
   * Act as this signed-in person instead of as the API key's owner.
   *
   * The copilot popup is used by a customer to raise and follow up their own tickets. It reaches
   * TicketFlow through the agent, which holds the server's MCP key, so without this every ticket
   * it created would belong to the key's owner (an admin) and never appear in the customer's own
   * list. When set, the MCP client presents this person's identity; see server/mcp/router.ts.
   *
   * Never set for the standalone service: it has no request behind it, so it stays the key owner.
   */
  actAsUserId?: string;
}

/**
 * The tools the create-time triage job actually needs: read a ticket, look for a known fix,
 * identify the owning team, and (only when asked) reply. Deliberately excludes the
 * create/update/delete tools, which shrink the prompt and remove the risk of the agent
 * changing data during a demo.
 */
export const DEFAULT_TRIAGE_TOOL_ALLOWLIST = [
  "get_ticket",
  "list_tickets",
  "search_knowledge",
  "get_knowledge_article",
  "search_documents",
  "get_document",
  "list_teams",
  "list_departments",
  "add_comment",
  "whoami",
];

/**
 * What a CUSTOMER's copilot may use: raise a ticket, follow it up, and find out who owns it.
 *
 * Deliberately excluded: every admin/manager-only tool (list_teams, list_users, get_stats), and
 * every staff write (update_ticket, close_ticket, delete_ticket). Those are refused by each
 * tool's own rule too; leaving them out of the prompt keeps the model from even trying.
 * list_routing_options is the customer-safe, names-and-ids-only view the copilot suggests a
 * department/team from.
 */
export const CUSTOMER_TOOL_ALLOWLIST = [
  "create_ticket",
  "get_ticket",
  "list_tickets",
  "add_comment",
  "get_ticket_history",
  "search_knowledge",
  "get_knowledge_article",
  "search_documents",
  "get_document",
  "list_routing_options",
  "whoami",
];

/** Parse a comma-separated allowlist; "*" or blank means every tool. */
export function parseToolAllowlist(raw: string | undefined): string[] | null {
  const value = raw?.trim();
  if (!value || value === "*") return null;
  const names = value.split(",").map((n) => n.trim()).filter(Boolean);
  return names.length ? names : null;
}

export const DEFAULT_MASTRA_AGENT_PORT = 4111;
export const DEFAULT_MASTRA_MCP_URL = "http://localhost:5000/api/mcp";

/**
 * Every prefix Mastra resolves as its own provider. A configured value that already begins with
 * one of these is a complete router id and is passed through untouched.
 *
 * This matters because the two deployments name their providers differently: "openrouter/..."
 * reaches the hosted model, while "lmstudio/..." reaches a model running inside LM Studio on
 * this machine. Blindly prefixing "openrouter/" turned "lmstudio/llama-3.1-8b-instruct" into
 * "openrouter/lmstudio/llama-3.1-8b-instruct", which resolves nowhere.
 *
 * A vendor path such as "meta-llama/llama-3.3-70b-instruct" is deliberately NOT a prefix:
 * "meta-llama" is a model publisher, not a provider, so that value is still completed to
 * "openrouter/meta-llama/llama-3.3-70b-instruct".
 */
const PROVIDER_PREFIXES = [
  "openrouter",
  "lmstudio",
  "ollama",
  "llama",
  "openai",
  "anthropic",
  "google",
  "azure",
];

export function toModelRouterId(configuredModelId: string): string {
  const trimmed = configuredModelId.trim();
  if (!trimmed) return `openrouter/${DEFAULT_MASTRA_MODEL_ID}`;

  const prefix = trimmed.split("/", 1)[0].toLowerCase();
  if (PROVIDER_PREFIXES.includes(prefix)) return trimmed;

  return `openrouter/${trimmed}`;
}

/**
 * Why a hosted Llama cannot work yet, or null when the model has everything it needs.
 *
 * A hosted OpenRouter model needs OPENROUTER_API_KEY. Without it every call reaches OpenRouter
 * unauthenticated and comes back 401 "Missing Authentication header", which surfaces only as a
 * 502 from the agent endpoint after the operator has already started the service. This check
 * lets run.ts refuse at startup with one actionable line instead.
 *
 * Returns null for a local model (LM Studio / Ollama), which needs no OpenRouter key.
 */
export function missingModelCredential(
  env: NodeJS.ProcessEnv,
  modelId: string,
): string | null {
  const hosted = !isLocalModel(modelId);
  if (hosted && !readOpenRouterApiKey(env)) {
    return `model ${modelId} is hosted, but OPENROUTER_API_KEY is not set. Set it in .env, or point MASTRA_MODEL_ID at a local model (lmstudio/...).`;
  }
  return null;
}

/** The agent-service coordinates, or null while the feature is off or a required value is missing. */
export function readMastraAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): MastraAgentConfig | null {
  if (env.MASTRA_AGENT_ENABLED !== "true") return null;

  const mcpKey = env.TICKETFLOW_MCP_KEY?.trim() || undefined;
  if (!mcpKey) return null;

  const rawPort = Number.parseInt(env.MASTRA_AGENT_PORT ?? "", 10);
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536
    ? rawPort
    : DEFAULT_MASTRA_AGENT_PORT;

  const mcpUrl = (env.TICKETFLOW_MCP_URL?.trim() || DEFAULT_MASTRA_MCP_URL);

  // Unset falls back to the triage subset, which is the setting that makes a local model
  // usable. MASTRA_TOOL_ALLOWLIST=* exposes every tool, as a hosted model can handle.
  const toolAllowlist = env.MASTRA_TOOL_ALLOWLIST === undefined
    ? DEFAULT_TRIAGE_TOOL_ALLOWLIST
    : parseToolAllowlist(env.MASTRA_TOOL_ALLOWLIST);

  return {
    port,
    mcpUrl,
    mcpKey,
    modelId: toModelRouterId(env.MASTRA_MODEL_ID ?? DEFAULT_MASTRA_MODEL_ID),
    toolAllowlist,
  };
}
