/**
 * The Mastra instance behind the optional agent service.
 *
 * Nothing in the TicketFlow server imports this folder, so the app runs exactly as before
 * whether or not Mastra is installed. The service is started only by server/mastra/run.ts,
 * and only while MASTRA_AGENT_ENABLED=true.
 */
import { Mastra } from "@mastra/core/mastra";
import type { Agent } from "@mastra/core/agent";
import { PinoLogger } from "@mastra/loggers";
import { readMastraAgentConfig, CUSTOMER_TOOL_ALLOWLIST, type MastraAgentConfig } from "./config";
import { createTicketFlowMcpClient } from "./mcp";
import { createTicketAgent, type CopilotActor } from "./agents/ticket-agent";
import { OpenRouterGateway, OPENROUTER_GATEWAY_ID, openRouterModel } from "./gateway";

export interface TicketFlowAgentService {
  mastra: Mastra;
  config: MastraAgentConfig;
  /** Tool names the agent can call, for a readiness check. */
  toolNames: string[];
  /** Releases the MCP connection. */
  disconnect: () => Promise<void>;
}

/**
 * Builds the service. Tools are discovered from TicketFlow over MCP, so this is async and is
 * only called by the standalone entry point. Returns null when the feature is off.
 */
/**
 * Keeps only the allowed tools. The MCP client namespaces every tool as
 * "<server>_<tool>", so an allowlist entry of "get_ticket" matches "ticketflow_get_ticket".
 * A null allowlist keeps everything. An entry that matches nothing is dropped silently, so a
 * typo narrows the agent rather than stopping the service.
 */
function selectTools(
  discovered: Record<string, unknown>,
  allowlist: string[] | null,
): Record<string, unknown> {
  if (!allowlist) return discovered;
  const wanted = new Set(allowlist);
  const selected: Record<string, unknown> = {};
  for (const [namespacedName, tool] of Object.entries(discovered)) {
    const bare = namespacedName.includes("_")
      ? namespacedName.slice(namespacedName.indexOf("_") + 1)
      : namespacedName;
    if (wanted.has(bare) || wanted.has(namespacedName)) selected[namespacedName] = tool;
  }
  return selected;
}

export async function createTicketFlowAgentService(
  env: NodeJS.ProcessEnv = process.env,
  /**
   * Build the agent for ONE signed-in person (the copilot). Omitted by the standalone service,
   * which acts as the API key's owner.
   */
  actor?: CopilotActor,
): Promise<TicketFlowAgentService | null> {
  const config = readMastraAgentConfig(env);
  if (!config) return null;

  // Acting for a person also narrows the tools to what that person's role may do, and swaps in
  // the instructions for their job. The MCP key itself carries more than a customer may use.
  const scoped: MastraAgentConfig = actor
    ? {
        ...config,
        actAsUserId: actor.id,
        toolAllowlist: actor.role === "customer" ? CUSTOMER_TOOL_ALLOWLIST : config.toolAllowlist,
      }
    : config;

  const mcpClient = createTicketFlowMcpClient(scoped);
  const discovered = await mcpClient.listTools();
  const tools = selectTools(discovered, scoped.toolAllowlist);
  // An agent with no tools can only talk: it would invent ticket numbers instead of creating
  // one. Fail here, visibly, rather than serve that to a customer.
  if (Object.keys(tools).length === 0) {
    await mcpClient.disconnect().catch(() => undefined);
    throw new Error("the agent discovered no TicketFlow tools (is the MCP endpoint reachable?)");
  }
  // A copilot agent records each run's identity, so its MCP calls act for that person.
  const ticketAgent = createTicketAgent(tools, openRouterModel(env, scoped.modelId), actor?.role, actor) as Agent;

  const mastra = new Mastra({
    agents: { ticketAgent },
    // Without this the hosted Llama reaches OpenRouter with no Authorization header (401).
    // See server/mastra/gateway.ts for why the built-in registry entry is not enough.
    gateways: { [OPENROUTER_GATEWAY_ID]: new OpenRouterGateway(env) },
    logger: new PinoLogger({ name: "ticketflow-mastra", level: "info" }),
  });

  return {
    mastra,
    config: scoped,
    toolNames: Object.keys(tools).sort(),
    disconnect: () => mcpClient.disconnect(),
  };
}
