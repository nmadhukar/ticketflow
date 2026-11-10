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
import { activeActorId } from "../mcp/actAs";
import type { MastraAgentConfig } from "./config";

/**
 * A fresh MCP client for one agent service. Namespaced keys arrive as ticketflow_<tool>.
 *
 * When the agent was built for a person (the copilot), every request carries that person's id in
 * X-TicketFlow-Act-As. The id is read when the request is SENT, from the run in progress, because
 * Mastra dispatches the fetch on its own async chain and an ambient scope would already be gone.
 * The MCP router honours the header only during such a run, so an external key owner cannot
 * impersonate anyone by adding it.
 */
export function createTicketFlowMcpClient(config: MastraAgentConfig): MCPClient {
  const actAs = config.actAsUserId
    ? () => {
        const actor = activeActorId();
        return actor ? { "X-TicketFlow-Act-As": actor } : {};
      }
    : () => ({});

  return new MCPClient({
    id: "ticketflow-mcp-client",
    servers: {
      ticketflow: {
        url: new URL(config.mcpUrl),
        // A custom fetch rather than a static requestInit: the headers are per request.
        // The SDK sends a `Headers` instance, so it must be copied with `new Headers`, not with
        // object spread (which yields an empty object and drops Accept + Authorization, so the
        // server answers 406 and tool discovery fails with "Version negotiation failed").
        fetch: (url, init) => {
          const headers = new Headers(init?.headers as HeadersInit | undefined);
          for (const [name, value] of Object.entries(actAs()) as Array<[string, string]>) {
            headers.set(name, value);
          }
          return globalThis.fetch(url, { ...init, headers });
        },
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
