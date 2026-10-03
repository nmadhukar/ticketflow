import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "@shared/schema";
import { registerTicketTools } from "./tools";

/**
 * A fresh MCP server for ONE request, acting as `user` (the owner of the API
 * key that authenticated it), reached from `ip`. Nothing is shared between requests.
 */
export function createMcpServer(user: User, ip?: string): McpServer {
  const server = new McpServer({ name: "ticketflow", version: "1.0.0" });
  registerTicketTools(server, user, ip);
  return server;
}
