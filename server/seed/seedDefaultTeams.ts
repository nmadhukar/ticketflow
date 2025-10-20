import { db } from "../db";
import { teams, departments, users } from "@shared/schema";
import { eq } from "drizzle-orm";

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

export async function seedDefaultTeams() {
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
    const sourceNames = (
      deptRows.length > 0 ? deptRows.map((d) => d.name) : FALLBACK_DEPARTMENTS
    ).filter(Boolean);

    for (const name of sourceNames) {
      const existing = await db
        .select()
        .from(teams)
        .where(eq(teams.name, name))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(teams).values({
          name,
          description: `${name} Team`,
          createdBy: createdById,
        });
        console.log(`✓ Created team: ${name}`);
      } else {
        console.log(`Team already exists: ${name}`);
      }
    }

    console.log("Default teams seeding completed.");
  } catch (error) {
    console.error("Error seeding default teams:", error);
    throw error;
  }
}
