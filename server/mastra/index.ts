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
import { readMastraAgentConfig, type MastraAgentConfig } from "./config";
import { createTicketFlowMcpClient } from "./mcp";
import { createTicketAgent } from "./agents/ticket-agent";

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
): Promise<TicketFlowAgentService | null> {
  const config = readMastraAgentConfig(env);
  if (!config) return null;

  const mcpClient = createTicketFlowMcpClient(config);
  const discovered = await mcpClient.listTools();
  const tools = selectTools(discovered, config.toolAllowlist);
  const ticketAgent = createTicketAgent(tools, config.modelId) as Agent;

  const mastra = new Mastra({
    agents: { ticketAgent },
    logger: new PinoLogger({ name: "ticketflow-mastra", level: "info" }),
  });

  return {
    mastra,
    config,
    toolNames: Object.keys(tools).sort(),
    disconnect: () => mcpClient.disconnect(),
  };
}
