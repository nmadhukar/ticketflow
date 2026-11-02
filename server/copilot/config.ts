/**
 * Configuration for the in-app CopilotKit copilot.
 *
 * CopilotKit is a second, user-facing front end beside the help chatbot and the
 * DSH / Mastra agent drivers: a chat popup in the browser whose agent is the same
 * TicketFlow triage agent, driving the same MCP tools. Like the Mastra service it
 * is OFF unless COPILOTKIT_ENABLED is exactly "true", so a deployment that does
 * not want it carries none of its weight.
 *
 * The copilot has no model of its own: it borrows the Mastra agent's model and
 * the Mastra service's MCP coordinates. If those are missing the copilot stays
 * off with one log line rather than half-starting.
 */
import type { MastraAgentConfig } from "../mastra/config";

export interface CopilotKitRuntimeConfig {
  /** The path the runtime is served on, on the TicketFlow origin. */
  basePath: string;
  /**
   * The Mastra agent is scoped to one Mastra "resource". TicketFlow authorises
   * every tool call through the MCP key, so this is a stable label for the
   * deployment rather than a per-user identity.
   */
  resourceId: string;
}

export const DEFAULT_COPILOTKIT_BASE_PATH = "/api/copilotkit";
export const DEFAULT_COPILOTKIT_RESOURCE_ID = "ticketflow-copilot";

/**
 * The copilot coordinates, or null while the feature is off.
 *
 * It reuses the Mastra agent-service coordinates (see readMastraAgentConfig):
 * the popup is a different way to reach the SAME agent, so it needs the same
 * model id and the same scoped MCP key. Requiring MASTRA_AGENT_ENABLED too keeps
 * one switch for "the agent layer" instead of two that can disagree.
 */
export function readCopilotKitConfig(
  env: NodeJS.ProcessEnv = process.env,
  mastraConfig: MastraAgentConfig | null,
): CopilotKitRuntimeConfig | null {
  if (env.COPILOTKIT_ENABLED !== "true") return null;
  if (!mastraConfig) return null;

  const basePath = env.COPILOTKIT_BASE_PATH?.trim() || DEFAULT_COPILOTKIT_BASE_PATH;
  const resourceId = env.COPILOTKIT_RESOURCE_ID?.trim() || DEFAULT_COPILOTKIT_RESOURCE_ID;

  return {
    basePath: basePath.startsWith("/") ? basePath : `/${basePath}`,
    resourceId,
  };
}
