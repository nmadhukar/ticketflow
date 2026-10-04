import { z } from "zod";
import { and, desc, eq, ilike, inArray, not, or } from "drizzle-orm";
import { departments, knowledgeArticles, teamAdmins, teamMembers, teams, type TeamMember, type User } from "@shared/schema";
import { db } from "../storage/db";
import { storage } from "../storage";
import { HttpError } from "../http/errors";
import { normalizeRole } from "../permissions/roles";
import { isStaffRole } from "../permissions/staff";
import { containsPattern } from "../utils/like";
import { projectUserForViewer, type PublicUser } from "../utils/publicUser";

/**
 * Read rules for users, teams, departments and the knowledge base, shared by the REST routes
 * and the MCP tools (R86): each was inline in a route handler, and lives here so both adapters
 * apply ONE rule. Refusals are HttpError (REST renders them; MCP's guard turns them into
 * TicketError codes). `viewer` is the caller's stored row: REST loads it by session id, MCP has
 * the API key's owner.
 */

/** The caller: its id and stored role (absent when the session's user row is gone). */
type Viewer = { id: string; role?: User["role"] | null };

const forbidden = (message: string) => new HttpError(403, "forbidden", message);

// ---------------------------------------------------------------- users (GET /api/users)

/** Staff only. normalizeRole reads the legacy role "user" as agent. */
export function assertMayListUsers(role: unknown): void {
  if (!isStaffRole(role)) throw forbidden("Forbidden");
}

/** Every user (system accounts excluded), each projected for the viewer (R41). */
export async function listUsersFor(viewer: Viewer) {
  assertMayListUsers(viewer.role);
  const v = { id: viewer.id, role: normalizeRole(viewer.role) };
  const all = await storage.getAllUsers();
  return all.map((u) => projectUserForViewer(v, u));
}

// ---------------------------------------------------------------- teams

/**
 * GET /api/teams. Customers: 403. Admin: every team (with memberCount). Manager: the teams it
 * administers or belongs to, not created by it, in a department it manages. Anyone else
 * (agents): 403, they use GET /api/teams/my.
 */
export async function listTeamsFor(viewer: Viewer) {
  const role = viewer.role;
  if (role === "customer") throw forbidden("Customers cannot access teams");
  if (role === "admin") return storage.getTeams();
  if (role === "manager") {
    const userId = viewer.id;
    const adminTeamIds = await db
      .select({ teamId: teamAdmins.teamId })
      .from(teamAdmins)
      .where(eq(teamAdmins.userId, userId));
    const memberTeamIds = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    const allTeamIds = Array.from(
      new Set([...adminTeamIds.map((t) => t.teamId), ...memberTeamIds.map((t) => t.teamId)])
    );
    if (allTeamIds.length === 0) return [];

    // Teams created by the manager are excluded (GET /api/teams/my lists those).
    const managedTeams = await db
      .select({
        id: teams.id,
        name: teams.name,
        description: teams.description,
        departmentId: teams.departmentId,
        createdAt: teams.createdAt,
        createdBy: teams.createdBy,
      })
      .from(teams)
      .where(and(inArray(teams.id, allTeamIds), not(eq(teams.createdBy, userId))))
      .orderBy(desc(teams.createdAt));

    // Only teams in departments this manager manages.
    const filteredTeams = [];
    for (const team of managedTeams) {
      const [department] = await db
        .select()
        .from(departments)
        .where(and(eq(departments.id, team.departmentId), eq(departments.managerId as any, userId)))
        .limit(1);
      if (department) filteredTeams.push(team);
    }
    return filteredTeams;
  }
  throw forbidden("Forbidden");
}

/** GET /api/teams/my. Customers: 403. Manager: the teams it created. Anyone else: the teams it is a member of. */
export async function listMyTeamsFor(viewer: Viewer) {
  if (viewer.role === "customer") throw forbidden("Customers cannot access teams");
  if (viewer.role === "manager") {
    return db.select().from(teams).where(eq(teams.createdBy, viewer.id)).orderBy(desc(teams.createdAt));
  }
  return storage.getUserTeams(viewer.id);
}

/** GET /api/teams/:id. Customers have no use for team records: 403. Unknown: 404. */
export async function getTeamFor(viewer: Viewer, teamId: number) {
  if (viewer.role === "customer") throw forbidden("Customers cannot access teams");
  const team = await storage.getTeam(teamId);
  if (!team) throw new HttpError(404, "not_found", "Team not found");
  return team;
}

/**
 * GET /api/teams/:id/members. Customers: 403. An agent only for a team it belongs to; a manager
 * only for a team in a department it manages. The role is normalized: a legacy "user" is an
 * agent (checked for membership), and an unknown role is refused.
 */
export async function assertMayViewTeamMembers(viewer: Viewer, teamId: number): Promise<void> {
  const role = normalizeRole(viewer.role);
  if (role === "customer") throw forbidden("Customers cannot access team members");
  if (!role) throw forbidden("Forbidden");
  if (role === "agent") {
    const userTeams = await storage.getUserTeams(viewer.id);
    if (!userTeams.some((team) => team.id === teamId)) {
      throw forbidden("You can only view members of teams you belong to");
    }
  }
  if (role === "manager") {
    const team = await storage.getTeam(teamId);
    if (team?.departmentId) {
      const rows = await db
        .select()
        .from(departments)
        .where(and(eq(departments.id, team.departmentId), eq(departments.managerId as any, viewer.id)));
      if (rows.length === 0) throw forbidden("You can only view members of teams in your departments");
    }
  }
}

/** Member rows as the members route returns them: no member role, the user projected for the viewer, an isAdmin flag. */
export async function presentTeamMembers(
  viewer: Viewer,
  teamId: number,
  members: Array<TeamMember & { user: PublicUser }>
) {
  return Promise.all(
    members.map(async (member) => {
      const { role: _role, ...memberWithoutRole } = member;
      const isAdmin = await storage.isTeamAdmin(member.userId, teamId);
      return { ...memberWithoutRole, user: projectUserForViewer(viewer, memberWithoutRole.user), isAdmin };
    })
  );
}

/** A team's members for the viewer, after assertMayViewTeamMembers. */
export async function listTeamMembersFor(viewer: Viewer, teamId: number) {
  await assertMayViewTeamMembers(viewer, teamId);
  return presentTeamMembers(viewer, teamId, await storage.getTeamMembers(teamId));
}

// ---------------------------------------------------------------- departments (GET /api/departments)

/**
 * Admin: every department, inactive included. Manager: the active ones it manages. Everyone
 * else (R40): id and name of the active ones.
 */
export async function listDepartmentsFor(viewer: Viewer) {
  if (viewer.role === "admin") return storage.getAllDepartmentsIncludingInactive();
  if (viewer.role === "manager") {
    return db
      .select()
      .from(departments)
      .where(and(eq(departments.isActive, true), eq(departments.managerId as any, viewer.id) as any))
      .orderBy(departments.name);
  }
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.isActive, true))
    .orderBy(departments.name);
}

// ---------------------------------------------------------------- knowledge base

export const knowledgeSearchQuery = z.object({
  query: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/** GET /api/knowledge/search: published articles (is_published), by effectiveness then usage. Any signed-in user. */
export async function searchKnowledgeArticles(input: unknown) {
  const { query, category, limit } = knowledgeSearchQuery.parse(input);
  return db
    .select()
    .from(knowledgeArticles)
    .where(
      and(
        eq(knowledgeArticles.isPublished, true),
        query
          ? or(ilike(knowledgeArticles.title, containsPattern(query)), ilike(knowledgeArticles.content, containsPattern(query)))
          : undefined,
        category ? eq(knowledgeArticles.category, category) : undefined
      )
    )
    .orderBy(desc(knowledgeArticles.effectivenessScore), desc(knowledgeArticles.usageCount))
    .limit(limit);
}

/**
 * One article, if a non-admin REST route already shows it to any signed-in user: the search
 * route lists is_published articles and GET /api/knowledge/articles lists status "published"
 * ones, so either flag makes it readable. Anything else is 404 (drafts, archived, unknown).
 */
export async function getReadableKnowledgeArticle(id: number) {
  const [article] = await db
    .select()
    .from(knowledgeArticles)
    .where(
      and(
        eq(knowledgeArticles.id, id),
        or(eq(knowledgeArticles.isPublished, true), eq(knowledgeArticles.status as any, "published"))
      )
    )
    .limit(1);
  if (!article) throw new HttpError(404, "not_found", "Article not found");
  return article;
}
