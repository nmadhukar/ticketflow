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
import { DEFAULT_MASTRA_MODEL_ID } from "./model";

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
