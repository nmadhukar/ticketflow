import { db } from "../storage/db";
import { departments, users } from "@shared/schema";
import { eq } from "drizzle-orm";

type SeedDepartment = {
  name: string;
  description: string;
  managerEmail?: string; // optional manager assignment
};

const DEFAULT_DEPARTMENTS: SeedDepartment[] = [
  {
    name: "Engineering",
    description:
      "Designs, develops, and maintains core products and services through software and hardware innovation.",
    managerEmail: "manager1@ticketflow.local",
  },
  {
    name: "Product Management",
    description:
      "Defines product vision, strategy, and roadmap while collaborating with engineering and design to deliver solutions.",
    managerEmail: "manager2@ticketflow.local",
  },
  {
    name: "Design & UX",
    description:
      "Focuses on user experience and interface design to ensure intuitive, visually appealing, and accessible products.",
  },
  {
    name: "Quality Assurance (QA)",
    description:
      "Ensures that all software releases meet standards for reliability, performance, and usability.",
  },
  {
    name: "Sales & Business Development",
    description:
      "Builds relationships with clients, closes deals, and expands the company's market presence.",
  },
  {
    name: "Marketing & Communications",
    description:
      "Handles brand positioning, public relations, campaigns, and digital content to grow awareness and engagement.",
  },
  {
    name: "Customer Success & Support",
    description:
      "Provides technical assistance and onboarding to customers, ensuring high satisfaction and retention.",
  },
  {
    name: "Human Resources (HR)",
    description:
      "Manages recruitment, employee relations, compensation, benefits, and company culture.",
  },
  {
    name: "Finance & Accounting",
    description:
      "Oversees budgeting, financial reporting, payroll, and ensures fiscal health and compliance.",
    managerEmail: "manager1@ticketflow.local",
  },
  {
    name: "Operations",
    description:
      "Manages day-to-day logistics, workflows, and process optimization to keep the organization running efficiently.",
    managerEmail: "manager2@ticketflow.local",
  },
  {
    name: "Data Science & Analytics",
    description:
      "Analyzes data to provide insights, improve decision-making, and enhance product performance.",
  },
  {
    name: "Legal & Compliance",
    description:
      "Ensures the company operates within legal frameworks, manages contracts, and protects intellectual property.",
  },
  // Added two more departments so 4 managed, 10 unmanaged
  {
    name: "Procurement",
    description:
      "Sources goods and services, manages vendor relationships, and optimizes purchasing costs.",
  },
  {
    name: "IT Support Services",
    description:
      "Maintains internal IT systems, infrastructure, and end-user support across the organization.",
  },
];

export async function seedDepartments() {
  try {
    console.log("Seeding departments...");

    for (const dept of DEFAULT_DEPARTMENTS) {
      const existing = await db
        .select()
        .from(departments)
        .where(eq(departments.name, dept.name))
        .limit(1);

      if (existing.length === 0) {
        // resolve manager id if provided
        let managerId: string | null = null;
        if (dept.managerEmail) {
          const [mgr] = await db
            .select()
            .from(users)
            .where(eq(users.email, dept.managerEmail))
            .limit(1);
          if (mgr?.id) managerId = mgr.id;
        }

        await db.insert(departments).values({
          name: dept.name,
          description: dept.description,
          isActive: true,
          managerId: managerId as any,
        });
        console.log(`✓ Created department: ${dept.name}`);
      } else {
        console.log(`Department already exists: ${dept.name}`);
      }
    }

    console.log("Departments seeding completed.");
  } catch (error) {
    console.error("Error seeding departments:", error);
    throw error;
  }
}
