import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "@shared/schema";
import { storage } from "../storage";
import { normalizeRole } from "../permissions/roles";
import { LIST_MAX_LIMIT, getTicketHistory } from "../services/tickets/ticketService";
import { guard } from "../services/tickets/ticketError";
import {
  getReadableKnowledgeArticle,
  getTeamFor,
  listDepartmentsFor,
  listMyTeamsFor,
  listTeamMembersFor,
  listTeamsFor,
  listUsersFor,
  searchKnowledgeArticles,
} from "../services/workspaceReads";
import { displayNameOf } from "../utils/displayName";
import { selfView } from "../utils/publicUser";
import { runTool } from "./errors";
import { MAX_INT, anyValue, assertToolId, given, idArg, pagingValue, toId } from "./args";

/**
 * The rest of the app on MCP (task MCP2). Rulings:
 * - R85: these tools ride on the key's existing `mcp:tickets` permission; there is no new scope.
 *   A key therefore reads what its owner sees in the UI: teams, users, KB, stats, notifications.
 * - R86: each tool mirrors one REST route and calls the SAME rule (workspaceReads, ticketService,
 *   storage) with the key owner as the caller. No rule is restated here.
 * - R87: no admin writes (users, settings, SSO, email, API keys, Teams settings, invitations).
 * - R88: notifications are pulled: list_notifications and mark_notifications_read.
 * Arguments are parsed here; a bad value is a coded VALIDATION (fieldErrors.<argument>).
 */

const SCOPE = "Uses the key's mcp:tickets permission and shows only what the key's owner sees in the app.";

const limitArg = (def: number) =>
  anyValue()
    .describe(`Page size, 1-${LIST_MAX_LIMIT} (default ${def}); a number or a numeric string`)
    .optional();
const limitField = (def: number) => z.number().int().min(1).max(LIST_MAX_LIMIT).default(def);
const offsetField = z.number().int().min(0).default(0);

/** Drops absent values (undefined, null, ""), turns numeric limit/offset strings into numbers, then parses (ZodError -> VALIDATION). */
function parseArgs<S extends z.ZodTypeAny>(schema: S, args: Record<string, unknown>): z.output<S> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    const value = given(v);
    if (value === undefined) continue;
    cleaned[k] = k === "limit" || k === "offset" ? pagingValue(value) : value;
  }
  return schema.parse(cleaned);
}

const usersQuery = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  limit: limitField(25),
  offset: offsetField,
});

const knowledgeQuery = z.object({
  query: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  limit: limitField(10),
});

const activityQuery = z.object({ limit: limitField(10) });

const notificationsQuery = z.object({
  unreadOnly: z.boolean().default(true),
  since: z.string().datetime({ offset: true, message: "Must be an ISO 8601 date-time, e.g. 2026-10-03T09:00:00Z" }).optional(),
  limit: limitField(25),
});

const markReadInput = z
  .object({
    ids: z
      .array(z.preprocess(toId, z.number().int().min(1).max(MAX_INT)))
      .min(1)
      .max(LIST_MAX_LIMIT)
      .optional(),
    all: z.literal(true, { errorMap: () => ({ message: "all must be the boolean true" }) }).optional(),
  })
  .refine((v) => (v.ids !== undefined) !== (v.all !== undefined), {
    message: "Pass ids (a non-empty array of notification ids) or all: true, not both",
  });

export function registerAppTools(server: McpServer, user: User): void {
  const viewer = { id: user.id, role: user.role };

  server.registerTool(
    "whoami",
    {
      description: `The key's owner: id, name, email, role, phone and the teams they belong to (id and name). ${SCOPE}`,
      inputSchema: z.object({}),
    },
    () =>
      runTool(() =>
        guard(async () => {
          // Customers get no team records anywhere in REST, so none here either.
          const teams = normalizeRole(user.role) === "customer" ? [] : await storage.getUserTeams(user.id);
          return {
            ...selfView(user),
            name: displayNameOf(user),
            teams: teams.map((t) => ({ id: t.id, name: t.name })),
          };
        })
      )
  );

  server.registerTool(
    "list_users",
    {
      description: `List users, as GET /api/users: staff only (customers are FORBIDDEN); an agent sees no other user's phone. Optional search (name or email), limit and offset. Returns {users, total, returned, limit, offset, hasMore}. ${SCOPE}`,
      inputSchema: z.object({
        search: z.string().describe("Text to find in the first name, last name or email").optional(),
        limit: limitArg(25),
        offset: anyValue().describe("Rows to skip, 0 or more (default 0); a number or a numeric string").optional(),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const { search, limit, offset } = parseArgs(usersQuery, args);
          let users = await listUsersFor(viewer);
          if (search) {
            const needle = search.toLowerCase();
            // Only fields this viewer is shown are searched, so a search cannot probe hidden ones.
            users = users.filter((u) =>
              [u.firstName, u.lastName, (u as { email?: string | null }).email].some(
                (f) => typeof f === "string" && f.toLowerCase().includes(needle)
              )
            );
          }
          users.sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)) || String(a.id).localeCompare(String(b.id)));
          const page = users.slice(offset, offset + limit);
          return { users: page, total: users.length, returned: page.length, limit, offset, hasMore: offset + page.length < users.length };
        })
      )
  );

  server.registerTool(
    "list_teams",
    {
      description: `List teams. Admin: every team; manager: the teams GET /api/teams shows it; anyone else: the teams they belong to (GET /api/teams/my). mine: true gives GET /api/teams/my for any role (a manager's own teams). Customers are FORBIDDEN. Returns {teams}. ${SCOPE}`,
      inputSchema: z.object({
        mine: z.boolean().describe("Only my teams (GET /api/teams/my)").optional(),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const role = normalizeRole(user.role);
          // REST refuses agents the full list and points them at /api/teams/my.
          const useMine = args.mine === true || (role !== "admin" && role !== "manager" && role !== "customer");
          return { teams: useMine ? await listMyTeamsFor(viewer) : await listTeamsFor(viewer) };
        })
      )
  );

  server.registerTool(
    "get_team",
    {
      description:
        "Get one team by id, as GET /api/teams/:id (customers are FORBIDDEN). includeMembers: true adds its members as GET /api/teams/:id/members shows them, under that route's rule: an agent only for a team they belong to, a manager only for a team in their department (otherwise FORBIDDEN).",
      inputSchema: z.object({
        id: idArg("Team"),
        includeMembers: z.boolean().describe("Also return the members").optional(),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const teamId = assertToolId(args.id);
          const team = await getTeamFor(viewer, teamId);
          if (args.includeMembers !== true) return team;
          return { ...team, members: await listTeamMembersFor(viewer, teamId) };
        })
      )
  );

  server.registerTool(
    "list_departments",
    {
      description:
        "List departments, as GET /api/departments. Admin: all (inactive too); manager: the active ones it manages; everyone else: id and name of the active ones. Returns {departments}.",
      inputSchema: z.object({}),
    },
    () => runTool(() => guard(async () => ({ departments: await listDepartmentsFor(viewer) })))
  );

  server.registerTool(
    "search_knowledge",
    {
      description:
        "Search the published knowledge base, as GET /api/knowledge/search: query matches the title or content; optional category; limit 1-100 (default 10). Best articles first. Returns {articles}.",
      inputSchema: z.object({
        query: z.string().describe("Text to find (up to 200 characters)").optional(),
        category: z.string().describe("Only this category").optional(),
        limit: limitArg(10),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => ({ articles: await searchKnowledgeArticles(parseArgs(knowledgeQuery, args)) }))
      )
  );

  server.registerTool(
    "get_knowledge_article",
    {
      description: "Get one knowledge article by id, when the same article is readable through the knowledge REST routes (published). An unpublished or unknown article is NOT_FOUND.",
      inputSchema: z.object({ id: idArg("Article") }),
    },
    (args) => runTool(() => guard(async () => getReadableKnowledgeArticle(assertToolId(args.id))))
  );

  server.registerTool(
    "get_stats",
    {
      description:
        "Ticket counts (total, open, inProgress, onHold, resolved, closed, highPriority, urgent) over the tickets the key's owner can see, as GET /api/stats.",
      inputSchema: z.object({}),
    },
    () => runTool(() => guard(() => storage.getTaskStats({ id: user.id, role: user.role })))
  );

  server.registerTool(
    "list_activity",
    {
      description:
        "Recent ticket events (history entries) on tickets the key's owner can see, newest first, as GET /api/activity. limit 1-100 (default 10). Returns {activity}.",
      inputSchema: z.object({ limit: limitArg(10) }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const { limit } = parseArgs(activityQuery, args);
          return { activity: await storage.getRecentActivity({ id: user.id, role: user.role }, limit) };
        })
      )
  );

  server.registerTool(
    "get_ticket_history",
    {
      description:
        "A ticket's change history, oldest first, as GET /api/tasks/:id/history. Same access as get_ticket: an unknown id is NOT_FOUND, a ticket the key's owner cannot see is FORBIDDEN. Returns {ticketId, history}.",
      inputSchema: z.object({ id: idArg("Ticket") }),
    },
    (args) =>
      runTool(async () => {
        const ticketId = toId(args.id);
        return { ticketId, history: await getTicketHistory(user, ticketId) };
      })
  );

  server.registerTool(
    "list_notifications",
    {
      description: `The key owner's own in-app notifications, newest first (GET /api/notifications). MCP has no push: poll this instead of Teams alerts. unreadOnly (default true), since (ISO date-time: only newer ones), limit 1-${LIST_MAX_LIMIT} (default 25). Returns {notifications, returned, limit, hasMore}. ${SCOPE}`,
      inputSchema: z.object({
        unreadOnly: z.boolean().describe("Only unread notifications (default true)").optional(),
        since: z.string().describe("ISO 8601 date-time; only notifications created after it").optional(),
        limit: limitArg(25),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const { unreadOnly, since, limit } = parseArgs(notificationsQuery, args);
          const rows = await storage.listNotifications(user.id, {
            unreadOnly,
            since: since ? new Date(since) : undefined,
            limit: limit + 1,
          });
          const page = rows.slice(0, limit);
          return { notifications: page, returned: page.length, limit, hasMore: rows.length > limit };
        })
      )
  );

  server.registerTool(
    "mark_notifications_read",
    {
      description:
        "Mark the key owner's OWN notifications read: ids (an array of notification ids) or all: true, not both. An id that is someone else's, unknown or already read is not counted. Returns {marked}.",
      inputSchema: z.object({
        ids: anyValue().describe("Notification ids to mark read, e.g. [12, 13]").optional(),
        all: anyValue().describe("true marks every unread notification of yours").optional(),
      }),
    },
    (args) =>
      runTool(() =>
        guard(async () => {
          const { ids, all } = markReadInput.parse({ ids: args.ids, all: args.all });
          return { marked: await storage.markNotificationsRead(user.id, all ? undefined : ids) };
        })
      )
  );
}
