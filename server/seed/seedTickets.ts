import { db } from "../db";
import { tasks, users, teams } from "@shared/schema";
import { eq, inArray, desc } from "drizzle-orm";

function nextTicketNumber(last?: string): string {
  // Format TKT-YYYY-NNNN
  const year = new Date().getFullYear();
  if (!last) return `TKT-${year}-0001`;
  const parts = last.split("-");
  const seq = parseInt(parts[2] || "0", 10) + 1;
  return `TKT-${year}-${seq.toString().padStart(4, "0")}`;
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
        inArray(users.email as any, [
          "agent1@ticketflow.local",
          "agent2@ticketflow.local",
          "agent3@ticketflow.local",
        ]) as any
      );

    const customers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        inArray(users.email as any, [
          "customer1@ticketflow.local",
          "customer2@ticketflow.local",
          "customer3@ticketflow.local",
        ]) as any
      );

    const myTeams = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams);

    // Determine last ticket number
    const [last] = await db
      .select({ ticketNumber: tasks.ticketNumber })
      .from(tasks)
      .orderBy(desc(tasks.id))
      .limit(1);
    let lastTicketNo = last?.ticketNumber;

    const seedRows: Array<
      Parameters<typeof db.insert>[0] extends any
        ? typeof tasks.$inferInsert
        : never
    > = [] as any;

    function pushTicket(partial: Partial<typeof tasks.$inferInsert>) {
      lastTicketNo = nextTicketNumber(lastTicketNo);
      seedRows.push({
        ticketNumber: lastTicketNo,
        title: partial.title || "Seeded Ticket",
      } as any);
    }

    // Customers create tickets assigned to a team
    for (let i = 0; i < Math.min(3, customers.length, myTeams.length); i++) {
      const creator = customers[i].id;
      const team = myTeams[i];
      lastTicketNo = nextTicketNumber(lastTicketNo);
      await db.insert(tasks).values({
        ticketNumber: lastTicketNo,
        title: `Customer issue #${i + 1}`,
        description: "Issue reported by customer",
        category: "support",
        priority: i % 2 === 0 ? "high" : "medium",
        status: "open",
        assigneeType: "team",
        assigneeTeamId: team.id,
        createdBy: creator,
      });
      console.log(
        `✓ Created team-assigned ticket ${lastTicketNo} -> team ${team.name}`
      );
    }

    // Agent/user assigned directly
    for (let i = 0; i < agents.length; i++) {
      const assignee = agents[i].id;
      lastTicketNo = nextTicketNumber(lastTicketNo);
      await db.insert(tasks).values({
        ticketNumber: lastTicketNo,
        title: `Agent task #${i + 1}`,
        description: "Direct assignment to an agent",
        category: "incident",
        priority: i % 2 === 0 ? "urgent" : "low",
        status: "open",
        assigneeType: "user",
        assigneeId: assignee,
        createdBy: admin?.id || assignee,
      });
      console.log(
        `✓ Created user-assigned ticket ${lastTicketNo} -> user ${assignee}`
      );
    }

    // Mixed: team with later user assignment left null
    for (let i = 0; i < Math.min(2, myTeams.length); i++) {
      const team = myTeams[i];
      lastTicketNo = nextTicketNumber(lastTicketNo);
      await db.insert(tasks).values({
        ticketNumber: lastTicketNo,
        title: `Team queue item #${i + 1}`,
        description: "Team queue item awaiting pickup",
        category: "request",
        priority: "medium",
        status: "open",
        assigneeType: "team",
        assigneeTeamId: team.id,
        assigneeId: null,
        createdBy: admin?.id || myTeams[0]?.id, // fallback
      });
      console.log(
        `✓ Created team-queue ticket ${lastTicketNo} -> team ${team.name}`
      );
    }
  } catch (error) {
    console.error("Error seeding tickets:", error);
    throw error;
  }
}
