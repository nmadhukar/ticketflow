/**
 * The bridge between the Mastra agent and TicketFlow.
 *
 * The agent reaches the SAME stateless MCP endpoint the DeepSeek Harness uses
 * (POST /api/mcp), authenticated by an mcp:tickets API key. Every tool - tickets,
 * teams, departments, knowledge, documents - is therefore defined once, in
 * server/mcp, and the two drivers cannot drift apart.
 *
 * The Accept header is not optional: the endpoint speaks JSON and SSE.
 */
import { MCPClient } from "@mastra/mcp";
import type { MastraAgentConfig } from "./config";

/** A fresh MCP client for one agent service. Namespaced keys arrive as ticketflow_<tool>. */
export function createTicketFlowMcpClient(config: MastraAgentConfig): MCPClient {
  return new MCPClient({
    id: "ticketflow-mcp-client",
    servers: {
      ticketflow: {
        url: new URL(config.mcpUrl),
        requestInit: {
          headers: {
            Authorization: `Bearer ${config.mcpKey}`,
            Accept: "application/json, text/event-stream",
          },
        },
      },
    },
  });
}
