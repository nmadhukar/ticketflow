import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "@shared/schema";
import {
  addComment,
  closeTicket,
  createTicket,
  deleteTicket,
  getTicket,
  listTickets,
  reopenTicket,
  updateTicket,
  type WriteContext,
} from "../services/tickets/ticketService";
import { logSecurityEvent } from "../security/rbac";
import { runTool } from "./errors";

/** Audit a refused status change like REST does, without an HTTP request. */
function mcpWriteContext(user: User): WriteContext {
  return {
    onStatusRefusal: ({ from, to, taskId }) =>
      logSecurityEvent(
        { user: { id: user.id, role: user.role }, ip: "mcp", get: () => undefined } as never,
        "change_status",
        "ticket",
        false,
        { userId: user.id, from, to, taskId, channel: "mcp" }
      ),
  };
}

/**
 * The ticket tools. Each is a thin adapter over ticketService, which owns every
 * rule. Input schemas describe the arguments for the model; they are
 * deliberately loose (strings, not enums) so that a wrong value reaches the
 * service and comes back as a VALIDATION result with details, instead of a
 * protocol error with nothing the model can act on.
 */

const id = z.number().describe("Ticket id (positive integer)");

const ticketFields = {
  title: z.string().describe("Short summary (1-255 characters)").optional(),
  description: z.string().nullable().describe("Full description").optional(),
  category: z.string().describe("Ticket category, e.g. support").optional(),
  priority: z.string().describe("low, medium, high or urgent").optional(),
  severity: z.string().describe("Severity of the problem").optional(),
  notes: z
    .string()
    .nullable()
    .describe("Progress notes on the ticket. NOT internal: everyone who can see the ticket, the customer included, can read them")
    .optional(),
  assigneeId: z.string().nullable().describe("User id to assign the ticket to").optional(),
  assigneeType: z.string().describe("user or team").optional(),
  assigneeTeamId: z.number().nullable().describe("Team id to queue the ticket to").optional(),
  dueDate: z.string().nullable().describe("ISO date").optional(),
  tags: z.array(z.string()).describe("Up to 20 tags").optional(),
  estimatedHours: z.number().nullable().describe("Staff only: estimated hours").optional(),
  actualHours: z.number().nullable().describe("Staff only: actual hours").optional(),
};

const create = z.object(ticketFields).passthrough();
const update = z.object({ id, ...ticketFields, status: z.string().describe("open, in_progress, on_hold, resolved or closed").optional() }).passthrough();
const byId = z.object({ id });
const listArgs = z
  .object({
    status: z.string().describe("open, in_progress, on_hold, resolved or closed").optional(),
    priority: z.string().describe("low, medium, high or urgent").optional(),
    category: z.string().optional(),
    assigneeId: z.string().describe("Only tickets assigned to this user id").optional(),
    search: z.string().describe("Text to find in the title or description").optional(),
    limit: z.number().describe("Page size, 1-100 (default 25)").optional(),
    offset: z.number().describe("Rows to skip (default 0)").optional(),
  })
  .passthrough();

export function registerTicketTools(server: McpServer, user: User): void {
  server.registerTool(
    "create_ticket",
    {
      description:
        "Create a ticket. Requires title and category. The ticket is created as the key's owner; status starts as open and cannot be set.",
      inputSchema: create,
    },
    (args) => runTool(() => createTicket(user, args))
  );

  server.registerTool(
    "get_ticket",
    {
      description: "Get one ticket by id, optionally with its comments. Only tickets the key's owner can see.",
      inputSchema: z.object({ id, includeComments: z.boolean().describe("Also return the comments").optional() }),
    },
    (args) => runTool(() => getTicket(user, args.id, { includeComments: args.includeComments === true }))
  );

  server.registerTool(
    "list_tickets",
    {
      description:
        "List the tickets the key's owner can see, newest first. Returns total (all matching), returned, limit, offset and hasMore: when hasMore is true, call again with offset + returned. Invalid filter values are errors, never an empty list.",
      inputSchema: listArgs,
    },
    (args) => runTool(() => listTickets(user, args))
  );

  server.registerTool(
    "update_ticket",
    {
      description:
        "Update fields of a ticket by id. What may change depends on the role; the result lists appliedFields and ignoredFields. Status moves follow the workflow.",
      inputSchema: update,
    },
    (args) => {
      const { id: ticketId, ...patch } = args;
      return runTool(() => updateTicket(user, ticketId, patch, mcpWriteContext(user)));
    }
  );

  server.registerTool(
    "close_ticket",
    { description: "Close a ticket (staff only). Closing an already closed ticket is an INVALID_STATE error.", inputSchema: byId },
    (args) => runTool(() => closeTicket(user, args.id, mcpWriteContext(user)))
  );

  server.registerTool(
    "reopen_ticket",
    {
      description: "Reopen a resolved or closed ticket (back to open). Staff, or the customer who created it.",
      inputSchema: byId,
    },
    (args) => runTool(() => reopenTicket(user, args.id, mcpWriteContext(user)))
  );

  server.registerTool(
    "delete_ticket",
    {
      description:
        "Permanently delete a ticket and its comments, history and attachments. Administrators only. Pass confirm: true.",
      inputSchema: z.object({ id, confirm: z
          .union([z.boolean(), z.string()])
          .describe("Must be the boolean true to delete; anything else is a VALIDATION error")
          .optional() }),
    },
    (args) => runTool(() => deleteTicket(user, args.id, args.confirm === true))
  );

  server.registerTool(
    "add_comment",
    {
      description: "Add a comment to a ticket (1-10000 characters).",
      inputSchema: z.object({ id, content: z.string().describe("Comment text") }),
    },
    (args) => runTool(() => addComment(user, args.id, args.content))
  );
}
