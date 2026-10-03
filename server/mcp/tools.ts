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
import { publicBaseUrl } from "../utils/appBaseUrl";
import { runTool } from "./errors";

/**
 * Audit a refused status change like REST does, without an HTTP request. `ip` is the caller's
 * address from the HTTP request that carried the tool call (R60); `channel: "mcp"` stays.
 */
function mcpWriteContext(user: User, ip?: string): WriteContext {
  return {
    // The Teams card's link: APP_BASE_URL (there is no request to take an origin from);
    // null when it is unset or unusable, and the card then has no link. Read per call.
    actionBaseUrl: publicBaseUrl(),
    onStatusRefusal: ({ from, to, taskId }) =>
      logSecurityEvent(
        { user: { id: user.id, role: user.role }, ip, get: () => undefined } as never,
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

/**
 * A number OR a string in the schema, on purpose: with `z.number()` the SDK rejects a
 * non-numeric id itself, with a plain-text protocol error and no code. Accepting both lets
 * the value reach the service, whose assertId answers a coded VALIDATION
 * (`fieldErrors.id`) for anything that is not a positive integer.
 *
 * R47: a model often sends the id as a string, so a string of plain digits (no sign, space,
 * leading zero or decimal point) up to 2147483647 is that number. Everything else, "abc", "1.5",
 * "", " 12", stays a VALIDATION. `ticketId` narrows the type for the service, which re-checks
 * it at run time.
 */
const id = z
  .union([z.number(), z.string()])
  .describe('Ticket id: a positive integer, as a number or a string of digits such as "12"');

const MAX_INT = 2147483647;
const ID_PATTERN = /^[1-9][0-9]{0,9}$/;
const ticketId = (v: string | number): number => {
  if (typeof v === "string" && ID_PATTERN.test(v) && Number(v) <= MAX_INT) return Number(v);
  return v as number;
};

/** limit/offset: a number, or a string of plain digits that is that number; anything else is left for the service to refuse. */
const pagingValue = (v: string | number | undefined): string | number | undefined =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,9})$/.test(v) && Number(v) <= MAX_INT ? Number(v) : v;

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
    limit: z
      .union([z.number(), z.string()])
      .describe('Page size, 1-100 (default 25); a number or a numeric string such as "10"')
      .optional(),
    offset: z
      .union([z.number(), z.string()])
      .describe('Rows to skip, 0 or more (default 0); a number or a numeric string')
      .optional(),
  })
  .passthrough();

export function registerTicketTools(server: McpServer, user: User, ip?: string): void {
  server.registerTool(
    "create_ticket",
    {
      description:
        "Create a ticket. Requires title and category. The ticket is created as the key's owner; status starts as open and cannot be set.",
      inputSchema: create,
    },
    (args) => runTool(() => createTicket(user, args, { actionBaseUrl: publicBaseUrl() }))
  );

  server.registerTool(
    "get_ticket",
    {
      description: "Get one ticket by id, optionally with its comments. Only tickets the key's owner can see.",
      inputSchema: z.object({ id, includeComments: z.boolean().describe("Also return the comments").optional() }),
    },
    (args) => runTool(() => getTicket(user, ticketId(args.id), { includeComments: args.includeComments === true }))
  );

  server.registerTool(
    "list_tickets",
    {
      description:
        "List the tickets the key's owner can see, newest first. Returns total (all matching), returned, limit, offset and hasMore: when hasMore is true, call again with offset + returned. Invalid filter values are errors, never an empty list.",
      inputSchema: listArgs,
    },
    (args) =>
      runTool(() =>
        listTickets(user, {
          ...args,
          limit: pagingValue(args.limit) as number | undefined,
          offset: pagingValue(args.offset) as number | undefined,
        })
      )
  );

  server.registerTool(
    "update_ticket",
    {
      description:
        "Update fields of a ticket by id. What may change depends on the role; the result lists appliedFields and ignoredFields. Status moves follow the workflow.",
      inputSchema: update,
    },
    (args) => {
      const { id: rawId, ...patch } = args;
      return runTool(() => updateTicket(user, ticketId(rawId), patch, mcpWriteContext(user, ip)));
    }
  );

  server.registerTool(
    "close_ticket",
    { description: "Close a ticket (staff only). Closing an already closed ticket is an INVALID_STATE error.", inputSchema: byId },
    (args) => runTool(() => closeTicket(user, ticketId(args.id), mcpWriteContext(user, ip)))
  );

  server.registerTool(
    "reopen_ticket",
    {
      description: "Reopen a resolved or closed ticket (back to open). Staff, or the customer who created it.",
      inputSchema: byId,
    },
    (args) => runTool(() => reopenTicket(user, ticketId(args.id), mcpWriteContext(user, ip)))
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
    (args) => runTool(() => deleteTicket(user, ticketId(args.id),args.confirm === true))
  );

  server.registerTool(
    "add_comment",
    {
      description: "Add a comment to a ticket (1-10000 characters).",
      inputSchema: z.object({ id, content: z.string().describe("Comment text") }),
    },
    (args) => runTool(() => addComment(user, ticketId(args.id),args.content))
  );
}
