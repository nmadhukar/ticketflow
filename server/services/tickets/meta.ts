import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { departments, teams, users } from "@shared/schema";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "@shared/constants";
import { normalizeRole } from "../../permissions/roles";
import { deriveAllowedFields } from "../../permissions/tickets";
import { excludeSystemAccounts } from "../../utils/aiSystemUser";
import { displayNameOf } from "../../utils/displayName";

/**
 * The create/edit modal meta: enumerations, role-scoped department/team/user
 * lists and the role's base permissions. Called directly by both
 * /api/tickets/meta and /api/tickets/:id/meta (no HTTP self-fetch).
 * Returns null for an unknown role or user.
 */
export async function buildTicketMeta(user: { id: string; role: unknown } | undefined) {
  const role = normalizeRole(user?.role);
  if (!user || !role) return null;
  const userId = user.id;
  // Static enumerations
  const categories = [...TICKET_CATEGORIES];
  const priorities = [...TICKET_PRIORITIES];
  const statuses = [...TICKET_STATUSES];

  let departmentsRows: any[] = [];
  let teamsRows: any[] = [];
  let assignableUsers: any[] = [];
  let myTeams: any[] = [];
  const basePermissions: any = {
    canAssign: false,
    canChangeStatus: false,
    allowedAssigneeTypes: [] as string[],
    allowedFields: [] as string[],
  };

  if (role === "admin") {
    departmentsRows = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.isActive, true));
    teamsRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        departmentId: teams.departmentId,
      })
      .from(teams);
    assignableUsers = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(
        and(
          excludeSystemAccounts(),
          or(
            eq(users.role, "admin"),
            or(eq(users.role, "manager"), eq(users.role, "agent"))
          )
        )
      );
    basePermissions.canAssign = true;
    basePermissions.canChangeStatus = true;
    basePermissions.allowedAssigneeTypes = ["user", "team"];
  } else if (role === "manager") {
    // Departments managed by this manager
    departmentsRows = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(
        and(
          eq(departments.isActive, true),
          eq(departments.managerId as any, userId) as any
        )
      );
    teamsRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        departmentId: teams.departmentId,
      })
      .from(teams)
      .innerJoin(departments, eq(teams.departmentId, departments.id))
      .where(eq(departments.managerId as any, userId) as any);
    assignableUsers = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(and(excludeSystemAccounts(), or(eq(users.role, "manager"), eq(users.role, "agent"))));
    basePermissions.canAssign = true;
    basePermissions.canChangeStatus = true;
    basePermissions.allowedAssigneeTypes = ["user", "team"];
  } else if (role === "agent") {
    // Agents/users: no assignment lists; but provide my teams for convenience
    const mine = await storage.getUserTeams(userId);
    myTeams = mine.map((t) => ({
      id: t.id,
      name: (t as any).name,
      departmentId: (t as any).departmentId,
    }));
    basePermissions.canAssign = false;
    basePermissions.canChangeStatus = true;
    basePermissions.allowedAssigneeTypes = [];
  } else if (role === "customer") {
    // Customers: can select department/team or assign to a user
    departmentsRows = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.isActive, true));
    teamsRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        departmentId: teams.departmentId,
      })
      .from(teams);
    // Staff a customer may address a ticket to: active, approved managers and
    // agents (legacy "user" reads as agent), as `{ id, displayName }` only. A
    // customer never receives staff emails or roles, nor inactive accounts
    // (ruling R19's narrower projection; final review I2).
    const staffRows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
      })
      .from(users)
      .where(
        and(
          excludeSystemAccounts(),
          eq(users.isActive, true),
          eq(users.isApproved, true),
          inArray(users.role, ["manager", "agent", "user"])
        )
      );
    assignableUsers = staffRows
      .map((u) => ({ u, role: normalizeRole(u.role) }))
      .filter(({ role }) => role === "manager" || role === "agent")
      .map(({ u, role }) => ({ id: u.id, displayName: displayNameOf({ ...u, role }) }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    basePermissions.canAssign = true;
    basePermissions.canChangeStatus = false;
    basePermissions.allowedAssigneeTypes = ["user", "team"];
  }

  // Same field table PATCH enforces (the per-ticket route narrows status further).
  basePermissions.allowedFields = deriveAllowedFields(role).filter((f) => f !== "status" || role !== "customer");

  return {
    categories,
    priorities,
    statuses,
    departments: departmentsRows,
    teams: teamsRows,
    assignableUsers,
    myTeams,
    permissions: basePermissions,
  };
}
