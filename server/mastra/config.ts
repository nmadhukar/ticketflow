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
import { apiKeyFor, providerForModel } from "../services/ai/modelProvider";

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
  "get_ticket_history",
  "search_knowledge",
  "get_knowledge_article",
  "search_documents",
  "get_document",
  "check_citation",
  "list_teams",
  "list_departments",
  "whoami",
];

/**
 * What a CUSTOMER's copilot may use: look up an answer, follow their own tickets up, and find out
 * who owns them. READS ONLY.
 *
 * create_ticket and add_comment are deliberately NOT here. Handing them to the model let it write
 * straight to the database, with no card and no confirmation: a customer asked "please raise a
 * ticket" and the copilot answered "I've raised a ticket, your number is TKT-..." having already
 * created it. A write must go through the proposal tools (propose_ticket, propose_comment,
 * propose_close_ticket), which record a draft the customer confirms on a card - so the direct tools
 * are absent from the prompt and the model can only propose.
 *
 * Also excluded: every admin/manager-only tool (list_teams, list_users, get_stats) and every staff
 * write (update_ticket, close_ticket, reopen_ticket, delete_ticket, mark_notifications_read). Those
 * are refused by each tool's own rule too; leaving them out keeps the model from even trying.
 * list_routing_options is the customer-safe, names-and-ids-only view the copilot suggests a
 * department/team from.
 */
export const CUSTOMER_TOOL_ALLOWLIST = [
  "get_ticket",
  "list_tickets",
  "get_ticket_history",
  "search_knowledge",
  "get_knowledge_article",
  "search_documents",
  "get_document",
  "check_citation",
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
 *
 * A bare OpenAI id ("gpt-4o-mini") is left alone for the same reason: it names OpenAI's own model,
 * and server/mastra/gateway.ts routes it to api.openai.com with OPENAI_API_KEY.
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

/**
 * An OpenAI model id as OpenAI itself writes it: gpt-4o-mini, gpt-4.1, o3-mini, chatgpt-4o-latest.
 * A bare "gpt-4o-mini" in MASTRA_MODEL_ID means "the OpenAI model", not "an OpenRouter route" - the
 * same rule the app's own AI path uses (server/services/ai/modelProvider.ts). Prefixing it with
 * "openrouter/" sent the OpenAI key to openrouter.ai, which answered 401 and reached the user as
 * "API key expired" even though the key was fine.
 */
const OPENAI_BARE_ID = /^(gpt-|chatgpt-|o[1-9]([-.]|$)|text-embedding-|davinci|babbage)/i;

export function toModelRouterId(configuredModelId: string): string {
  const trimmed = configuredModelId.trim();
  if (!trimmed) return `openrouter/${DEFAULT_MASTRA_MODEL_ID}`;

  const prefix = trimmed.split("/", 1)[0].toLowerCase();
  if (PROVIDER_PREFIXES.includes(prefix)) return trimmed;

  // A bare OpenAI id is OpenRouter's "vendor/model" too, but that is not what it means: below,
  // agentModel sends the unprefixed id to api.openai.com with OPENAI_API_KEY.
  if (OPENAI_BARE_ID.test(trimmed)) return trimmed;

  return `openrouter/${trimmed}`;
}

/**
 * Why a hosted model cannot work yet, or null when the model has everything it needs.
 *
 * A hosted model needs the key of the provider its id names (OPENAI_API_KEY for gpt-*, 
 * OPENROUTER_API_KEY for vendor/model). Without it every call reaches the provider unauthenticated
 * and comes back 401, which surfaces only as a 502 from the agent endpoint after the operator has
 * already started the service. This check lets run.ts refuse at startup with one actionable line.
 *
 * Returns null for a local model (LM Studio / Ollama), which needs no key.
 */
export function missingModelCredential(
  env: NodeJS.ProcessEnv,
  modelId: string,
): string | null {
  if (isLocalModel(modelId)) return null;
  if (apiKeyFor(providerForModel(modelId), env)) return null;
  const provider = providerForModel(modelId) === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
  return `model ${modelId} is hosted, but ${provider} is not set. Set it in .env, or point MASTRA_MODEL_ID at a local model (lmstudio/...).`;
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
