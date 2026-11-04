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
import { assistantWritesEnabled } from "../../../assistant/toolPolicy";
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

  it("adds each agent's proposal tools within a run, never marked read-only, and none when writes are off", async () => {
    const run = "3f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01";
    const support = await listFor(createAssistantMcpServer({ id: "c", role: "customer" } as never, "support-assistant", undefined, run, {}));
    const staff = await listFor(createAssistantMcpServer({ id: "s", role: "agent" } as never, "ticket-assistant", undefined, run, {}));
    const proposals = (tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>) =>
      tools.filter((t) => t.name.startsWith("propose_"));
    expect(proposals(support.tools).map((t) => t.name).sort()).toEqual(["propose_comment", "propose_ticket"]);
    expect(proposals(staff.tools).map((t) => t.name)).toEqual(["propose_comment"]);
    for (const tool of [...proposals(support.tools), ...proposals(staff.tools)]) expect(tool.annotations?.readOnlyHint).toBe(false);
    // The real writes stay unregistered.
    for (const write of WRITES) expect(support.tools.map((t) => t.name)).not.toContain(write);

    const off = await listFor(createAssistantMcpServer({ id: "c", role: "customer" } as never, "support-assistant", undefined, run, { ASSISTANT_WRITES_ENABLED: "false" }));
    expect(proposals(off.tools)).toEqual([]);
  });

  it("treats any usual spelling of off as off for ASSISTANT_WRITES_ENABLED, and anything else as on", () => {
    for (const off of ["false", "FALSE", " False ", "0", "off", "OFF", "no", "disabled"]) {
      expect(assistantWritesEnabled({ ASSISTANT_WRITES_ENABLED: off })).toBe(false);
    }
    for (const on of [undefined, "", "true", "1", "yes"]) {
      expect(assistantWritesEnabled({ ASSISTANT_WRITES_ENABLED: on })).toBe(true);
    }
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
