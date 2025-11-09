import { db } from "../db";
import { tasks, users, departments } from "@shared/schema";
import { eq, inArray, desc } from "drizzle-orm";

function nextTicketNumber(last?: string): string {
  // Format TKT-YYYY-NNNN
  const year = new Date().getFullYear();
  if (!last) return `TKT-${year}-0001`;
  const parts = last.split("-");
  const seq = parseInt(parts[2] || "0", 10) + 1;
  return `TKT-${year}-${seq.toString().padStart(4, "0")}`;
}

async function nextUniqueTicketNumber(currentLast?: string): Promise<string> {
  // Ensure uniqueness by checking existence and incrementing until free
  let candidate = nextTicketNumber(currentLast);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db
      .select({ ticketNumber: tasks.ticketNumber })
      .from(tasks)
      .where(eq(tasks.ticketNumber, candidate))
      .limit(1);
    if (!existing?.length) return candidate;
    candidate = nextTicketNumber(candidate);
  }
}

export async function seedTickets() {
  try {
    console.log("Seeding tickets...");

    // Look up creator pools by role
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "admin@ticketflow.local"))
      .limit(1);

    const agents = await db
      .select({ id: users.id })
      .from(users)
      .where(
        inArray(users.email, [
          "agent1@ticketflow.local",
          "agent2@ticketflow.local",
          "agent3@ticketflow.local",
        ])
      );

    const customers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        inArray(users.email, [
          "customer1@ticketflow.local",
          "customer2@ticketflow.local",
          "customer3@ticketflow.local",
        ])
      );

    // Get all active departments for random assignment
    const allDepartments = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.isActive, true));

    if (allDepartments.length === 0) {
      console.warn(
        "⚠ No active departments found. Cannot create department-assigned tickets."
      );
      return;
    }

    // Determine last ticket number
    const [last] = await db
      .select({ ticketNumber: tasks.ticketNumber })
      .from(tasks)
      .orderBy(desc(tasks.id))
      .limit(1);
    let lastTicketNo = last?.ticketNumber;

    // Helper function to get random department
    const getRandomDepartment = () => {
      return allDepartments[Math.floor(Math.random() * allDepartments.length)];
    };

    // Create tickets randomly assigned to departments only
    const categories = ["support", "incident", "request", "enhancement", "bug"];
    const priorities = ["low", "medium", "high", "urgent"];
    const statuses = ["open", "in_progress"];

    // Create 15-20 tickets randomly assigned to departments
    const ticketCount = 15 + Math.floor(Math.random() * 6); // 15-20 tickets
    for (let i = 0; i < ticketCount; i++) {
      const randomDept = getRandomDepartment();
      const randomCategory =
        categories[Math.floor(Math.random() * categories.length)];
      const randomPriority =
        priorities[Math.floor(Math.random() * priorities.length)];
      const randomStatus =
        statuses[Math.floor(Math.random() * statuses.length)];
      const randomCreator =
        customers[Math.floor(Math.random() * customers.length)]?.id ||
        admin?.id;

      lastTicketNo = await nextUniqueTicketNumber(lastTicketNo);
      await db.insert(tasks).values({
        ticketNumber: lastTicketNo,
        title: `Department ticket #${i + 1}`,
        description: `Ticket randomly assigned to department: ${randomDept.name}`,
        category: randomCategory,
        priority: randomPriority,
        status: randomStatus,
        assigneeType: null, // Department-only assignment
        assigneeId: null,
        assigneeTeamId: null,
        createdBy: randomCreator,
      });
      console.log(
        `✓ Created department-assigned ticket ${lastTicketNo} -> department ${randomDept.name} (ID: ${randomDept.id})`
      );
    }
  } catch (error) {
    console.error("Error seeding tickets:", error);
    throw error;
  }
}
