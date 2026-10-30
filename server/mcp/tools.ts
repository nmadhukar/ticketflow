import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "@shared/schema";
import { TICKET_CATEGORIES, TICKET_SEVERITIES } from "@shared/constants";
import {
  addComment,
  closeTicket,
  createTicket,
  deleteTicket,
  getTicket,
  listTickets,
  resolveTicketId,
  reopenTicket,
  updateTicket,
  type WriteContext,
} from "../services/tickets/ticketService";
import { logSecurityEvent } from "../security/rbac";
import { publicBaseUrl } from "../utils/appBaseUrl";
import { runTool } from "./errors";
import { anyValue, pagingValue, ticketRefArg } from "./args";

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

// id, limit and offset parsing (and why they accept any JSON value) live in ./args, shared with the app tools.
// A ticket may be named by its database id or by the number the UI shows (TKT-2026-0610);
// resolveTicketId turns either into the numeric id every service rule already expects.
const id = ticketRefArg();

/**
 * An optional create argument that a model may send as a number, a string or null. Same reason as
 * anyValue (see ./args): the SDK validates the arguments against this schema BEFORE the handler
 * runs, so a narrower type turns a model's harmless "2" into a protocol error that never reaches
 * the normaliser below. The handler shapes and validates the value for real.
 */
const optionalValue = () => z.union([z.number(), z.string(), z.null()]);

const ticketFields = {
  title: z.string().describe("Short summary (1-255 characters)").optional(),
  description: z.string().nullable().describe("Full description").optional(),
  category: z.string().describe("Ticket category, e.g. support").optional(),
  priority: z.string().describe("low, medium, high or urgent").optional(),
  severity: z.string().describe(`Severity of the problem, one of: ${TICKET_SEVERITIES.join(", ")}`).optional(),
  notes: optionalValue()
    .describe("Progress notes on the ticket. NOT internal: everyone who can see the ticket, the customer included, can read them")
    .optional(),
  assigneeId: optionalValue().describe("User id to assign the ticket to").optional(),
  assigneeType: z.string().describe("user or team").optional(),
  assigneeTeamId: optionalValue().describe("Team id to queue the ticket to").optional(),
  dueDate: optionalValue().describe("ISO date").optional(),
  tags: optionalValue().describe("Up to 20 tags: an array of strings, or a comma-separated string").optional(),
  estimatedHours: optionalValue().describe("Staff only: estimated hours").optional(),
  actualHours: optionalValue().describe("Staff only: actual hours").optional(),
};

// title and category are required to create (createTicketSchema), so tools/list must say so: a model
// that sees them as optional sends a title alone. Plain strings, so a bad value still reaches the
// handler and comes back as a coded VALIDATION error.
const create = z
  .object({
    ...ticketFields,
    title: z.string().describe("Short summary (1-255 characters)"),
    category: z.string().describe(`Ticket category, one of: ${TICKET_CATEGORIES.join(", ")}`),
    severity: z.string().describe(`Severity of the problem, one of: ${TICKET_SEVERITIES.join(", ")}`).optional(),
    routeId: anyValue()
      .describe(
        "Optional: the id of the team you suggest should own this ticket, from list_routing_options. A suggestion only; the ticket is still routed on create."
      )
      .optional(),
  })
  .passthrough();

/**
 * Turns the copilot's `routeId` suggestion into a SUGGESTION the create rules can tell apart
 * from an explicit assignment (see suggestedTeamOf in ticketService).
 *
 * It goes through `assigneeType: "team"` + `teamId`, because that is the shape the create rules
 * already validate (team exists, belongs to its department). The suggestedTeamId field is what
 * marks it as a suggestion: the ticket then starts in triage and the AI routing step confirms or
 * corrects the owner. A non-numeric routeId is dropped: the ticket is created and routed
 * normally rather than failing on a bad suggestion.
 */
function withRouteHint(args: Record<string, unknown>): Record<string, unknown> {
  const { routeId, ...rest } = args;
  if (routeId === undefined || routeId === null || routeId === "") return rest;
  const teamId = Number(routeId);
  if (!Number.isInteger(teamId) || teamId <= 0) return rest;
  return { ...rest, assigneeType: "team", teamId, suggestedTeamId: teamId };
}

/**
 * The fields a model has no reason to send on create, and what "not given" looks like when it
 * does. A model told that an argument is optional often still fills it in, and writes the FILLER
 * ("null", "none", "[]", "0") rather than omitting it. Those values then fail the arg schema
 * above ("must be number,null", "must be array") and the model burns its turns on the same
 * retries until the run dies, while the customer gets no ticket. Normalising the shape - not the
 * value - makes the first attempt succeed; a real value still reaches the service and is checked
 * there, like every other argument.
 */
const OPTIONAL_CREATE_FIELDS = [
  "notes",
  "assigneeId",
  "assigneeType",
  "assigneeTeamId",
  "dueDate",
  "tags",
  "estimatedHours",
  "actualHours",
  "routeId",
] as const;

const isFiller = (v: unknown): boolean => {
  if (v === undefined || v === null) return true;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "" || s === "null" || s === "none" || s === "n/a" || s === "undefined" || s === "[]";
};

function toOptionalNumber(v: unknown): unknown {
  if (isFiller(v)) return undefined;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return v;
}

function toOptionalTags(v: unknown): unknown {
  if (isFiller(v)) return undefined;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Not JSON after all: fall through and treat it as one tag.
      }
    }
    const parts = trimmed.split(",").map((t) => t.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return v;
}

/** Copies the arguments with the optional create fields shaped (see above); a filler field is dropped. */
function withOptionalShapes(args: Record<string, unknown>): Record<string, unknown> {
  const shaped: Record<string, unknown> = { ...args };
  for (const field of OPTIONAL_CREATE_FIELDS) {
    if (!(field in shaped)) continue;
    let value: unknown = shaped[field];
    if (field === "assigneeTeamId" || field === "estimatedHours" || field === "actualHours") {
      value = toOptionalNumber(value);
    } else if (field === "tags") {
      value = toOptionalTags(value);
    } else if (isFiller(value)) {
      value = undefined;
    }
    if (value === undefined) delete shaped[field];
    else shaped[field] = value;
  }
  return shaped;
}
const update = z.object({ id, ...ticketFields, status: z.string().describe("open, in_progress, on_hold, resolved or closed").optional() }).passthrough();
const byId = z.object({ id });
const listArgs = z
  .object({
    status: z.string().describe("open, in_progress, on_hold, resolved or closed").optional(),
    priority: z.string().describe("low, medium, high or urgent").optional(),
    category: z.string().optional(),
    assigneeId: z.string().describe("Only tickets assigned to this user id").optional(),
    search: z.string().describe("Text to find in the title or description").optional(),
    limit: anyValue()
      .describe('Page size, 1-100 (default 25); a number or a numeric string such as "10"')
      .optional(),
    offset: anyValue()
      .describe('Rows to skip, 0 or more (default 0); a number or a numeric string')
      .optional(),
  })
  .passthrough();

export function registerTicketTools(server: McpServer, user: User, ip?: string): void {
  server.registerTool(
    "create_ticket",
    {
      description:
        "Create a ticket. Requires title and category. The ticket is created as the key's owner (or, for the copilot, as the signed-in customer); status starts as open and cannot be set. routeId suggests the owning team - a suggestion only: TicketFlow's routing confirms the final assignment.",
      inputSchema: create,
    },
    (args) => runTool(() => createTicket(user, withRouteHint(withOptionalShapes(args)), { actionBaseUrl: publicBaseUrl() }))
  );

  server.registerTool(
    "get_ticket",
    {
      description:
        "Get one ticket by its id or its number (e.g. TKT-2026-0610), optionally with its comments. Only tickets the key's owner can see.",
      inputSchema: z.object({
        id,
        includeComments: z
          .union([z.boolean(), z.string()])
          .describe('Also return the comments (true, or the string "true")')
          .optional(),
      }),
    },
    (args) =>
      runTool(async () =>
        getTicket(user, await resolveTicketId(args.id), {
          includeComments: args.includeComments === true || args.includeComments === "true",
        })
      )
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
      return runTool(async () => updateTicket(user, await resolveTicketId(rawId), patch, mcpWriteContext(user, ip)));
    }
  );

  server.registerTool(
    "close_ticket",
    { description: "Close a ticket (staff only). Closing an already closed ticket is an INVALID_STATE error.", inputSchema: byId },
    (args) => runTool(async () => closeTicket(user, await resolveTicketId(args.id), mcpWriteContext(user, ip)))
  );

  server.registerTool(
    "reopen_ticket",
    {
      description: "Reopen a resolved or closed ticket (back to open). Staff, or the customer who created it.",
      inputSchema: byId,
    },
    (args) => runTool(async () => reopenTicket(user, await resolveTicketId(args.id), mcpWriteContext(user, ip)))
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
    (args) => runTool(async () => deleteTicket(user, await resolveTicketId(args.id), args.confirm === true))
  );

  server.registerTool(
    "add_comment",
    {
      description: "Add a comment to a ticket (1-10000 characters).",
      inputSchema: z.object({ id, content: z.string().describe("Comment text") }),
    },
    (args) => runTool(async () => addComment(user, await resolveTicketId(args.id), args.content))
  );
}
