import { db } from "../db";
import { teams, departments, users, teamMembers } from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";

const FALLBACK_DEPARTMENTS = [
  "Engineering",
  "Product Management",
  "Design & UX",
  "Quality Assurance (QA)",
  "Sales & Business Development",
  "Marketing & Communications",
  "Customer Success & Support",
  "Human Resources (HR)",
  "Finance & Accounting",
  "Operations",
  "Data Science & Analytics",
  "Legal & Compliance",
];

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

    // Prefer departments from DB, fallback to predefined list
    const deptRows = await db.select().from(departments);
    const sourceDepts =
      deptRows.length > 0
        ? deptRows
        : FALLBACK_DEPARTMENTS.map(
            (n, i) => ({ id: undefined as unknown as number, name: n } as any)
          );

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

    // Candidate members: agents and users only (exclude managers/admin/customers)
    const candidateUsers = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(inArray(users.role as any, ["agent", "user"]) as any);

    // Rotate through candidates so each team gets different members
    let memberIndex = 0;

    for (const dept of sourceDepts) {
      const deptName = (dept as any).name as string;
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

        let teamId: number | undefined = existing[0]?.id as any;
        if (!teamId) {
          const insertRes = await db
            .insert(teams)
            .values({
              name,
              description: `${name} Team`,
              createdBy: createdById,
              departmentId: (dept as any).id || null,
            })
            .returning({ id: teams.id });
          teamId = insertRes[0]?.id as any;
          console.log(
            `✓ Created team: ${name} (deptId: ${(dept as any).id || "null"})`
          );
        } else {
          console.log(`Team already exists: ${name}`);
        }

        // Add 1-2 members from candidate users (agents/users), avoid duplicates and vary selection
        if (teamId && candidateUsers.length > 0) {
          const numMembers = candidateUsers.length === 1 ? 1 : 2;
          const selected: string[] = [];
          for (let i = 0; i < numMembers; i++) {
            const user =
              candidateUsers[(memberIndex + i) % candidateUsers.length];
            if (user) selected.push(user.id);
          }
          memberIndex = (memberIndex + 1) % candidateUsers.length;

          for (const userId of selected) {
            const existingMember = await db
              .select({ id: teamMembers.id })
              .from(teamMembers)
              .where(
                and(
                  eq(teamMembers.teamId as any, teamId as any) as any,
                  eq(teamMembers.userId as any, userId as any) as any
                ) as any
              )
              .limit(1);
            if (existingMember.length === 0) {
              await db.insert(teamMembers).values({
                teamId: teamId as any,
                userId,
                role: "member",
              });
            }
          }
        }
      }
    }

    console.log("Default teams seeding completed.");
  } catch (error) {
    console.error("Error seeding default teams:", error);
    throw error;
  }
}
