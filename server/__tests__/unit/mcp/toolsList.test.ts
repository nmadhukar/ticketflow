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
