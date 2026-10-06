import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "@shared/schema";
import { registerTicketTools } from "./tools";
import { registerAppTools } from "./appTools";
import { registerDocumentTools } from "./documentTools";

/**
 * R92: sent to the client on initialize. The model answers how-to, setup and policy questions
 * from the organisation's own documents, says which one it used, and says so when none fits.
 */
export const MCP_INSTRUCTIONS = [
  "TicketFlow holds this organisation's help documents, company policies, guidelines and knowledge articles.",
  "Before answering a how-to, setup or policy question, call search_documents, then get_document on the best result, and answer from that text.",
  "Search with the key words of the question, for example 'DoseSpot clinic key', and try other words or synonyms before concluding that nothing exists.",
  "Quote the title of every document you used.",
  "If nothing relevant is found, say so plainly instead of guessing.",
].join(" ");

/**
 * A fresh MCP server for ONE request, acting as `user` (the owner of the API
 * key that authenticated it), reached from `ip`. Nothing is shared between requests.
 */
export function createMcpServer(user: User, ip?: string): McpServer {
  const server = new McpServer({ name: "ticketflow", version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });
  registerTicketTools(server, user, ip);
  registerAppTools(server, user);
  registerDocumentTools(server, user);
  return server;
}
