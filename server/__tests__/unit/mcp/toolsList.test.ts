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
}));

import { createMcpServer } from "../../../mcp/server";
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
  it("lists exactly the eight ticket tools, each with a description and an object input schema", async () => {
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
      ].sort()
    );
    for (const t of tools) {
      expect(typeof t.description).toBe("string");
      expect((t.description ?? "").length).toBeGreaterThan(10);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("I2: every by-id tool advertises `id` as required, with a type, so a client or model cannot leave it out", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const name of ["get_ticket", "update_ticket", "close_ticket", "reopen_ticket", "delete_ticket", "add_comment"]) {
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
