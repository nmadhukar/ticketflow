import { db } from "../db";
import {
  teams,
  departments,
  users,
  teamMembers,
  teamAdmins,
} from "@shared/schema";
import { eq, inArray, and, isNotNull } from "drizzle-orm";

export async function seedTeams() {
  try {
    console.log("Seeding default teams...");

    // Find default admin user ID to attribute team creation
    let createdById: string | undefined = undefined;
    try {
      const [adminByEmail] = await db
        .select()
        .from(users)
        .where(eq(users.email, "admin@ticketflow.local"))
        .limit(1);
      if (adminByEmail?.id) {
        createdById = adminByEmail.id;
      } else {
        const [anyAdmin] = await db
          .select()
          .from(users)
          .where(eq(users.role, "admin"))
          .limit(1);
        if (anyAdmin?.id) createdById = anyAdmin.id;
      }
    } catch (e) {
      // continue without createdBy if lookup fails
    }

    // Get departments from DB (required - departments must be seeded first)
    const deptRows = await db.select().from(departments);
    if (deptRows.length === 0) {
      console.warn(
        "⚠ No departments found in database. Please seed departments first before seeding teams."
      );
      console.log("Skipping team seeding - departments are required.");
      return;
    }
    const sourceDepts = deptRows;

    // Build department-specific teams
    const deptToTeams: Record<string, string[]> = {
      "Finance & Accounting": ["Accounting", "Audit", "Payroll"],
      Engineering: ["Backend", "Frontend", "DevOps"],
      Operations: ["Logistics", "Facilities"],
      "Customer Success & Support": ["Tier 1 Support", "Tier 2 Support"],
      "Quality Assurance (QA)": ["Manual QA", "Automation QA"],
      "Marketing & Communications": ["Content", "Performance Marketing"],
      "Product Management": ["Core Product", "Platform"],
      "Design & UX": ["Product Design", "Research"],
      "Human Resources (HR)": ["Recruiting", "People Ops"],
      "Data Science & Analytics": ["Analytics", "ML Engineering"],
      "Legal & Compliance": ["Contracts", "Compliance"],
      Procurement: ["Vendor Management", "Purchasing"],
      "IT Support Services": ["Helpdesk", "Infrastructure"],
      Sales: ["SMB Sales", "Enterprise Sales"],
    };

    // Candidate members: agents only (exclude managers/admin/customers)
    const candidateUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.role, "agent"));

    // Track agent team assignments (max 3 teams per agent)
    const agentTeamCount = new Map<string, number>();
    const MAX_TEAMS_PER_AGENT = 3;

    // Fetch all managers and their departments
    const managerDepts = await db
      .select({
        managerId: departments.managerId,
        departmentId: departments.id,
        departmentName: departments.name,
      })
      .from(departments)
      .where(isNotNull(departments.managerId));

    // Group departments by manager
    const managerToDepts = new Map<
      string,
      Array<{ id: number; name: string }>
    >();
    for (const md of managerDepts) {
      if (!md.managerId) continue;
      if (!managerToDepts.has(md.managerId)) {
        managerToDepts.set(md.managerId, []);
      }
      managerToDepts.get(md.managerId)!.push({
        id: md.departmentId,
        name: md.departmentName || "",
      });
    }

    // Track manager team assignments (max 4 teams per manager)
    const managerTeamAssignments = new Map<string, Set<number>>();
    const MAX_TEAMS_PER_MANAGER = 4;

    // Helper function to shuffle array
    const shuffle = <T>(array: T[]): T[] => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    // Helper function to get random subset
    const getRandomSubset = <T>(array: T[], min: number, max: number): T[] => {
      if (array.length === 0) return [];
      const count = Math.floor(Math.random() * (max - min + 1)) + min;
      const shuffled = shuffle(array);
      return shuffled.slice(0, Math.min(count, array.length));
    };

    for (const dept of sourceDepts) {
      // Ensure department has a valid ID (required field)
      if (!dept.id) {
        console.warn(`⚠ Skipping department "${dept.name}": No department ID`);
        continue;
      }

      const deptName = dept.name || String(dept);
      const teamNames = deptToTeams[deptName] || [
        `${deptName} Team A`,
        `${deptName} Team B`,
      ];

      for (const name of teamNames) {
        const existing = await db
          .select()
          .from(teams)
          .where(eq(teams.name, name))
          .limit(1);

        let teamId: number | undefined = existing[0]?.id;
        if (!teamId) {
          // departmentId is required - dept.id should always exist at this point
          const deptId = dept.id;
          if (!deptId) {
            console.warn(`⚠ Skipping team ${name}: No department ID available`);
            continue;
          }

          // Double-check that department exists and is valid
          const deptCheck = await db
            .select({ id: departments.id })
            .from(departments)
            .where(eq(departments.id, deptId))
            .limit(1);

          if (!deptCheck || deptCheck.length === 0) {
            console.warn(
              `⚠ Skipping team ${name}: Department ID ${deptId} does not exist`
            );
            continue;
          }

          const insertRes = await db
            .insert(teams)
            .values({
              name,
              description: `${name} Team`,
              createdBy: createdById,
              departmentId: deptId, // Required field - must be set
            })
            .returning({ id: teams.id });
          teamId = insertRes[0]?.id;
          console.log(`✓ Created team: ${name} (deptId: ${deptId})`);
        } else {
          // Verify existing team has a department
          const existingTeam = await db
            .select({ departmentId: teams.departmentId })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

          if (!existingTeam[0]?.departmentId) {
            console.warn(
              `⚠ Team ${name} (ID: ${teamId}) exists but has no department. This should not happen.`
            );
          }
          console.log(`Team already exists: ${name}`);
        }

        // Add 1-2 members from candidate users (agents), respecting max teams limit
        if (teamId && candidateUsers.length > 0) {
          // Filter agents that haven't reached their team limit
          const availableAgents = candidateUsers.filter(
            (agent) => (agentTeamCount.get(agent.id) || 0) < MAX_TEAMS_PER_AGENT
          );

          if (availableAgents.length > 0) {
            const numMembers = Math.min(
              availableAgents.length === 1 ? 1 : 2,
              availableAgents.length
            );
            const shuffled = shuffle(availableAgents);
            const selected: string[] = [];
            for (let i = 0; i < numMembers; i++) {
              if (shuffled[i]) {
                selected.push(shuffled[i].id);
                agentTeamCount.set(
                  shuffled[i].id,
                  (agentTeamCount.get(shuffled[i].id) || 0) + 1
                );
              }
            }

            // Add members to team
            for (const userId of selected) {
              const existingMember = await db
                .select({ id: teamMembers.id })
                .from(teamMembers)
                .where(
                  and(
                    eq(teamMembers.teamId, teamId),
                    eq(teamMembers.userId, userId)
                  )
                )
                .limit(1);
              if (existingMember.length === 0) {
                await db.insert(teamMembers).values({
                  teamId,
                  userId,
                });
              }
            }
          }
        }
      }
    }

    // Phase 2: Assign managers to teams
    console.log("\nAssigning managers to teams...");
    for (const [managerId, deptList] of Array.from(managerToDepts.entries())) {
      // Only assign managers who have at least 2 departments (as per requirement: "for 2 or 3 departments")
      if (deptList.length < 2) {
        console.log(
          `  ⚠ Skipping manager ${managerId} - has only ${deptList.length} department(s)`
        );
        continue;
      }

      // Randomly select 2-3 departments for this manager
      const selectedDepts = getRandomSubset(deptList, 2, 3);
      const managerTeams: number[] = [];

      // Collect teams from selected departments
      for (const dept of selectedDepts) {
        const deptTeams = await db
          .select({ id: teams.id })
          .from(teams)
          .where(eq(teams.departmentId, dept.id));
        managerTeams.push(...deptTeams.map((t) => t.id));
      }

      // Randomly select up to 4 teams total
      const selectedTeams = getRandomSubset(
        managerTeams,
        1,
        MAX_TEAMS_PER_MANAGER
      );

      // Add manager to selected teams
      for (const teamId of selectedTeams) {
        const currentCount = managerTeamAssignments.get(managerId)?.size || 0;
        if (currentCount >= MAX_TEAMS_PER_MANAGER) break;

        // Check if manager is already a member
        const existingMember = await db
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.userId, managerId)
            )
          )
          .limit(1);

        if (existingMember.length === 0) {
          await db.insert(teamMembers).values({
            teamId,
            userId: managerId,
          });

          if (!managerTeamAssignments.has(managerId)) {
            managerTeamAssignments.set(managerId, new Set());
          }
          managerTeamAssignments.get(managerId)!.add(teamId);

          const team = await db
            .select({ name: teams.name })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);
          console.log(
            `  ✓ Added manager ${managerId} to team ${team[0]?.name || teamId}`
          );
        }
      }
    }

    // Phase 3: Assign admins randomly
    console.log("\nAssigning team admins...");
    const allTeams = await db.select().from(teams);

    for (const team of allTeams) {
      if (!team.id || !createdById) continue;

      // Get team members (agents and managers)
      const members = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id));

      if (members.length === 0) continue;

      // Separate agents, managers, and system admins
      const memberUserIds = members.map((m) => m.userId);
      const memberUsers = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(inArray(users.id, memberUserIds));

      // Only managers and system admins can be team admins (exclude agents)
      const eligibleAdminIds = memberUsers
        .filter((u) => u.role === "manager" || u.role === "admin")
        .map((u) => u.id);

      // Check existing admins
      const existingAdmins = await db
        .select({ userId: teamAdmins.userId })
        .from(teamAdmins)
        .where(eq(teamAdmins.teamId, team.id));

      const existingAdminIds = new Set(existingAdmins.map((a) => a.userId));

      // Randomly decide admin count (0-2, but prefer at least 1 if eligible users available)
      let adminCount = 0;
      if (eligibleAdminIds.length > 0) {
        // 70% chance of having admins if eligible users (managers/admins) are available
        adminCount =
          Math.random() < 0.7 ? Math.floor(Math.random() * 2) + 1 : 0;
      }

      const adminsToAdd: string[] = [];

      // Select admins: only from managers and system admins (no agents allowed)
      if (adminCount > 0 && eligibleAdminIds.length > 0) {
        const shuffledEligible = shuffle(eligibleAdminIds);

        // Add eligible users (managers or system admins) as team admins
        for (
          let i = 0;
          i < Math.min(adminCount, shuffledEligible.length);
          i++
        ) {
          if (!existingAdminIds.has(shuffledEligible[i])) {
            adminsToAdd.push(shuffledEligible[i]);
          }
        }

        // If we still have room and eligible users available, add another one
        if (
          adminsToAdd.length < 2 &&
          shuffledEligible.length > adminsToAdd.length
        ) {
          const additionalAdmin = shuffledEligible.find(
            (id) => !existingAdminIds.has(id) && !adminsToAdd.includes(id)
          );
          if (additionalAdmin) {
            adminsToAdd.push(additionalAdmin);
          }
        }
      }

      // Insert admins
      for (const userId of adminsToAdd) {
        if (!existingAdminIds.has(userId)) {
          await db.insert(teamAdmins).values({
            teamId: team.id,
            userId,
            grantedBy: createdById,
            grantedAt: new Date(),
          });
          const user = memberUsers.find((u) => u.id === userId);
          const roleLabel = user?.role || "user";
          console.log(
            `  ✓ Granted admin status to ${roleLabel} ${userId} in team ${team.name}`
          );
        }
      }
    }

    console.log("\nDefault teams seeding completed.");
  } catch (error) {
    console.error("Error seeding default teams:", error);
    throw error;
  }
}
