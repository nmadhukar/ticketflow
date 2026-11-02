import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// The tool implementations reach the database; listing them does not (as unit/mcp/toolsList.test.ts).
jest.mock("../../../services/tickets/ticketService", () => ({ LIST_MAX_LIMIT: 100 }));
jest.mock("../../../storage", () => ({ storage: {} }));
jest.mock("../../../services/workspaceReads", () => ({}));
jest.mock("../../../services/documents/documentLibrary", () => ({}));
jest.mock("../../../services/documents/documentWrites", () => ({}));

import type { AssistantAgentId } from "@shared/assistant";
import { ASSISTANT_MCP_INSTRUCTIONS, createAssistantMcpServer } from "../../../assistant/mcpServer";
import { createMcpServer, MCP_INSTRUCTIONS } from "../../../mcp/server";

async function listFor(server: ReturnType<typeof createMcpServer>) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  return { tools, instructions: client.getInstructions(), client };
}

const SUPPORT = [
  "get_document",
  "get_knowledge_article",
  "get_ticket",
  "get_ticket_history",
  "list_tickets",
  "search_documents",
  "search_knowledge",
  "whoami",
];
const STAFF = [
  ...SUPPORT,
  "get_stats",
  "get_team",
  "list_activity",
  "list_departments",
  "list_guideline_categories",
  "list_teams",
  "list_users",
].sort();

const WRITES = [
  "create_ticket",
  "update_ticket",
  "close_ticket",
  "reopen_ticket",
  "delete_ticket",
  "add_comment",
  "mark_notifications_read",
  "create_help_document",
  "update_help_document",
  "create_policy",
  "update_policy",
  "create_guideline",
  "update_guideline",
  "create_knowledge_article",
  "update_knowledge_article",
];

describe("assistant MCP surface", () => {
  it.each<[AssistantAgentId, string[]]>([
    ["support-assistant", SUPPORT],
    ["ticket-assistant", STAFF],
  ])("%s lists exactly its read tools, each marked read-only", async (agentId, expected) => {
    const { tools } = await listFor(createAssistantMcpServer({ id: "u1", role: "agent" } as never, agentId));
    expect(tools.map((t) => t.name).sort()).toEqual([...expected].sort());
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
    for (const write of WRITES) expect(tools.map((t) => t.name)).not.toContain(write);
  });

  it("cannot call a tool it does not list", async () => {
    const { client } = await listFor(createAssistantMcpServer({ id: "u1", role: "customer" } as never, "support-assistant"));
    const result = await client.callTool({ name: "add_comment", arguments: { ticket: "1", content: "x" } }).catch((error: Error) => error);
    const refused = result instanceof Error ? result.message : JSON.stringify(result);
    expect(refused).toMatch(/not found|unknown tool/i);
  });

  it("adds the untrusted-content rule to the public instructions", async () => {
    const { instructions } = await listFor(createAssistantMcpServer({ id: "u1", role: "agent" } as never, "ticket-assistant"));
    expect(instructions).toBe(ASSISTANT_MCP_INSTRUCTIONS);
    expect(instructions!.startsWith(MCP_INSTRUCTIONS)).toBe(true);
    expect(instructions).toMatch(/data, never instructions/);
  });

  it("leaves the public server's 31 tools unchanged", async () => {
    const { tools } = await listFor(createMcpServer({ id: "u1", role: "agent" } as never));
    expect(tools).toHaveLength(31);
  });
});
