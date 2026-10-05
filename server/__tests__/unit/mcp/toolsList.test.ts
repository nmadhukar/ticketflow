import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// The service reaches the database; the tool list does not need it.
jest.mock("../../../services/tickets/ticketService", () => ({
  createTicket: jest.fn(),
  getTicket: jest.fn(),
  listTickets: jest.fn(),
  updateTicket: jest.fn(),
  closeTicket: jest.fn(),
  reopenTicket: jest.fn(),
  deleteTicket: jest.fn(),
  addComment: jest.fn(),
  getTicketHistory: jest.fn(),
  LIST_MAX_LIMIT: 100,
}));
// The app tools (MCP2) read through storage and workspaceReads, which reach the database too.
jest.mock("../../../storage", () => ({ storage: {} }));
jest.mock("../../../services/workspaceReads", () => ({}));
// The document tools (MCP4) read and write through these, which reach the database too.
jest.mock("../../../services/documents/documentLibrary", () => ({}));
jest.mock("../../../services/documents/documentWrites", () => ({}));

import { TICKET_CATEGORIES } from "@shared/constants";
import { MCP_INSTRUCTIONS, createMcpServer } from "../../../mcp/server";
import { TicketError } from "../../../services/tickets/ticketError";
import * as service from "../../../services/tickets/ticketService";

const USER = { id: "u1", role: "agent" } as never;

async function connect() {
  const server = createMcpServer(USER);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

describe("MCP tools/list", () => {
  it("lists exactly the eight ticket tools, the twelve app tools (MCP2) and the eleven document tools (MCP4), each with a description and an object input schema", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_comment",
        "close_ticket",
        "create_ticket",
        "delete_ticket",
        "get_ticket",
        "list_tickets",
        "reopen_ticket",
        "update_ticket",
        "whoami",
        "list_users",
        "list_teams",
        "get_team",
        "list_departments",
        "search_knowledge",
        "get_knowledge_article",
        "get_stats",
        "list_notifications",
        "mark_notifications_read",
        "list_activity",
        "get_ticket_history",
        "search_documents",
        "get_document",
        "list_guideline_categories",
        "create_help_document",
        "update_help_document",
        "create_policy",
        "update_policy",
        "create_guideline",
        "update_guideline",
        "create_knowledge_article",
        "update_knowledge_article",
      ].sort()
    );
    expect(tools).toHaveLength(31);
    for (const t of tools) {
      expect(typeof t.description).toBe("string");
      expect((t.description ?? "").length).toBeGreaterThan(10);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("create_ticket advertises title and category as required, and names every allowed category", async () => {
    // Found by a DeepSeek Harness agent on 2026-10-04: with both listed as optional the model sent a
    // title alone and every create failed with VALIDATION "category: Required".
    const { client } = await connect();
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "create_ticket")!.inputSchema as {
      required?: string[];
      properties: Record<string, { type?: unknown; description?: string }>;
    };
    expect(schema.required ?? []).toEqual(expect.arrayContaining(["title", "category"]));
    expect(schema.properties.title.type).toBe("string");
    expect(schema.properties.category.type).toBe("string");
    for (const c of TICKET_CATEGORIES) expect(schema.properties.category.description).toContain(c);
  });

  it("MCP4: every document tool advertises its required fields as required and typed, with the allowed values in the descriptions", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    type Prop = { type?: unknown; anyOf?: Array<{ type?: string }>; description?: string };
    const schemaOf = (name: string) =>
      tools.find((t) => t.name === name)!.inputSchema as { required?: string[]; properties: Record<string, Prop> };
    const typesOf = (p: Prop) => (p.type !== undefined ? [p.type].flat() : (p.anyOf ?? []).map((a) => a.type));
    const REQUIRED: Record<string, string[]> = {
      search_documents: ["query"],
      get_document: ["type", "id"],
      create_help_document: ["title", "category", "content"],
      update_help_document: ["id"],
      create_policy: ["title"],
      update_policy: ["id"],
      create_guideline: ["title", "category", "content"],
      update_guideline: ["id"],
      create_knowledge_article: ["title", "content"],
      update_knowledge_article: ["id"],
    };
    for (const [name, required] of Object.entries(REQUIRED)) {
      const schema = schemaOf(name);
      // Exactly these are required: an optional field advertised as required would be as wrong as the reverse.
      expect([name, [...(schema.required ?? [])].sort()]).toEqual([name, [...required].sort()]);
      for (const field of required) {
        const types = typesOf(schema.properties[field]);
        expect([name, field, types.length > 0]).toEqual([name, field, true]);
        if (field === "id") expect([name, types]).toEqual([name, expect.arrayContaining(["number", "string"])]);
        else expect([name, field, types]).toEqual([name, field, ["string"]]);
      }
    }
    for (const name of ["search_documents", "get_document"]) {
      expect(schemaOf(name).properties.type.description).toEqual(expect.stringContaining("help, policy, guideline, knowledge"));
    }
    for (const name of ["create_guideline", "update_guideline"]) {
      expect(schemaOf(name).properties.type.description).toEqual(expect.stringContaining("html, scribehow, video"));
    }
    for (const name of ["create_policy", "update_policy"]) expect(typesOf(schemaOf(name).properties.isActive)).toEqual(["boolean"]);
    for (const name of ["create_guideline", "update_guideline", "create_knowledge_article", "update_knowledge_article"]) {
      expect(typesOf(schemaOf(name).properties.isPublished)).toEqual(["boolean"]);
    }
    for (const name of ["create_help_document", "update_help_document", "create_policy", "update_policy"]) {
      expect(schemaOf(name).properties.filename.description).toMatch(/\.docx, \.pdf, \.txt or \.md/);
      expect(typesOf(schemaOf(name).properties.fileBase64)).toEqual(["string"]);
    }
  });

  it("R92: initialize carries the server instructions: search the documents first, quote the title, say when nothing is found", async () => {
    const { client } = await connect();
    const instructions = client.getInstructions();
    expect(instructions).toBe(MCP_INSTRUCTIONS);
    expect(instructions).toMatch(/help documents, company policies, guidelines and knowledge articles/);
    expect(instructions).toMatch(/search_documents.*get_document/);
    expect(instructions).toMatch(/title/);
    expect(instructions).toMatch(/nothing relevant is found/i);
  });

  it("I2: every by-id tool advertises `id` as required, with a type, so a client or model cannot leave it out", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const name of [
      "get_ticket",
      "update_ticket",
      "close_ticket",
      "reopen_ticket",
      "delete_ticket",
      "add_comment",
      "get_team",
      "get_knowledge_article",
      "get_ticket_history",
    ]) {
      const schema = tools.find((t) => t.name === name)!.inputSchema as {
        required?: string[];
        properties: Record<string, { type?: unknown; anyOf?: Array<{ type?: string }> }>;
      };
      expect([name, schema.required ?? []]).toEqual([name, expect.arrayContaining(["id"])]);
      const id = schema.properties.id;
      const types = id.type !== undefined ? [id.type].flat() : (id.anyOf ?? []).map((a) => a.type);
      // Typed: a number and a string are both advertised (the handler also takes any other value, to answer a coded VALIDATION).
      expect([name, types]).toEqual([name, expect.arrayContaining(["number", "string"])]);
    }
    // limit and offset stay optional but typed.
    const list = tools.find((t) => t.name === "list_tickets")!.inputSchema as {
      required?: string[];
      properties: Record<string, { type?: unknown; anyOf?: Array<{ type?: string }> }>;
    };
    expect(list.required ?? []).not.toContain("limit");
    for (const f of ["limit", "offset"]) {
      const p = list.properties[f];
      const types = p.type !== undefined ? [p.type].flat() : (p.anyOf ?? []).map((a) => a.type);
      expect([f, types]).toEqual([f, expect.arrayContaining(["number", "string"])]);
    }
  });

  it("M3: create_ticket and update_ticket say notes are visible to the customer, never 'internal' only", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const name of ["create_ticket", "update_ticket"]) {
      const notes = (tools.find((t) => t.name === name)?.inputSchema.properties as Record<string, { description?: string }>)
        .notes;
      expect(notes.description).toMatch(/customer/i);
      expect(notes.description).toMatch(/NOT internal/);
    }
  });

  it("turns a TicketError into an isError result with code and message, never a stack", async () => {
    (service.getTicket as jest.Mock).mockRejectedValueOnce(new TicketError("NOT_FOUND", "Ticket not found"));
    const { client } = await connect();
    const res = await client.callTool({ name: "get_ticket", arguments: { id: 1 } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ code: "NOT_FOUND", message: "Ticket not found" });
    expect(text).not.toMatch(/\n\s+at /);
  });

  it("hides an unexpected error behind a generic message", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (service.getTicket as jest.Mock).mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432 secret"));
    const { client } = await connect();
    const res = await client.callTool({ name: "get_ticket", arguments: { id: 1 } });
    spy.mockRestore();
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5/);
    expect(JSON.parse(text).code).toBe("INTERNAL");
  });
});
