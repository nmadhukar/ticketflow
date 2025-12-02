// server/seed/seed-knowledge-learning.ts
import { db } from "../storage/db";
import { tasks, taskComments, taskHistory, users } from "@shared/schema";
import { eq, desc, inArray } from "drizzle-orm";

function nextTicketNumber(last?: string): string {
  // Format TKT-YYYY-NNNN
  const year = new Date().getFullYear();
  if (!last) return `TKT-${year}-0001`;
  const parts = last.split("-");
  const seq = parseInt(parts[2] || "0", 10) + 1;
  return `TKT-${year}-${seq.toString().padStart(4, "0")}`;
}

async function nextUniqueTicketNumber(currentLast?: string): Promise<string> {
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

export async function seedKnowledgeLearning() {
  try {
    console.log("Seeding knowledge learning test data...");

    // Get or create a seed user for createdBy
    let seedUserId: string;
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "admin@ticketflow.local"))
      .limit(1);

    if (existingUser) {
      seedUserId = existingUser.id;
    } else {
      // Fallback: get any user or use a default
      const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
      if (!anyUser) {
        console.warn(
          "⚠ No users found. Skipping knowledge learning seed - users must be seeded first."
        );
        return;
      }
      seedUserId = anyUser.id;
    }

    // Get agent users for comments (prefer agents, fallback to any users)
    const agentUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        inArray(users.email, [
          "agent1@ticketflow.local",
          "agent2@ticketflow.local",
          "agent3@ticketflow.local",
          "agent@ticketflow.local",
        ])
      );

    // If no specific agents found, get any users with agent role
    let commentUserIds: string[] = agentUsers.map((u) => u.id);
    if (commentUserIds.length === 0) {
      const agentsByRole = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "agent"))
        .limit(3);
      commentUserIds = agentsByRole.map((u) => u.id);
    }

    // If still no agents, use seedUserId for all comments
    if (commentUserIds.length === 0) {
      commentUserIds = [seedUserId];
    }

    const now = new Date();
    const daysAgo = (n: number) =>
      new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

    // Determine last ticket number
    const [last] = await db
      .select({ ticketNumber: tasks.ticketNumber })
      .from(tasks)
      .orderBy(desc(tasks.id))
      .limit(1);
    let lastTicketNo = last?.ticketNumber;

    // 3+ resolved tickets in category "support"
    const supportTickets = [
      {
        title: "Users cannot login due to password reset loop",
        description:
          "Several users report being redirected to password reset page repeatedly when trying to login.",
        category: "support",
        priority: "high",
        status: "resolved",
        createdAt: daysAgo(10),
        updatedAt: daysAgo(9),
        severity: "medium" as const,
      },
      {
        title: "Login fails with invalid token error after session timeout",
        description:
          "After long inactivity, users see 'invalid token' when attempting to login again.",
        category: "support",
        priority: "medium",
        status: "resolved",
        createdAt: daysAgo(8),
        updatedAt: daysAgo(7),
        severity: "low" as const,
      },
      {
        title: "SSO login broken for corporate users",
        description:
          "Corporate SSO redirects back with error. Only affects SSO, local accounts unaffected.",
        category: "support",
        priority: "urgent",
        status: "resolved",
        createdAt: daysAgo(6),
        updatedAt: daysAgo(5),
        severity: "critical" as const,
      },
    ];

    // 2+ resolved tickets in category "incident"
    const incidentTickets = [
      {
        title: "Database performance degradation during peak hours",
        description: "Reports of slow queries and timeouts between 9-11am UTC.",
        category: "incident",
        priority: "high",
        status: "resolved",
        createdAt: daysAgo(4),
        updatedAt: daysAgo(3),
        severity: "high" as const,
      },
      {
        title: "Intermittent API 500 errors on /auth routes",
        description:
          "Monitoring shows spikes of 500 errors on authentication endpoints.",
        category: "incident",
        priority: "high",
        status: "resolved",
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
        severity: "high" as const,
      },
    ];

    const allTickets = [...supportTickets, ...incidentTickets];

    // Insert tasks with proper ticket numbers and createdBy
    const insertedTasks = [];
    for (const ticket of allTickets) {
      lastTicketNo = await nextUniqueTicketNumber(lastTicketNo);
      const [inserted] = await db
        .insert(tasks)
        .values({
          ...ticket,
          ticketNumber: lastTicketNo,
          createdBy: seedUserId,
          resolvedAt: ticket.updatedAt, // Set resolvedAt since status is "resolved"
        })
        .returning();
      insertedTasks.push(inserted);
    }

    // For each ticket, add comments & history that look like good "resolution" data
    for (const task of insertedTasks) {
      // Use available agent IDs, cycling through them if needed
      const commentUserId1 = commentUserIds[0] || seedUserId;
      const commentUserId2 =
        commentUserIds.length > 1 ? commentUserIds[1] : commentUserId1;
      const commentUserId3 =
        commentUserIds.length > 2 ? commentUserIds[2] : commentUserId1;

      // Resolution comments (last ones are considered resolution)
      await db.insert(taskComments).values([
        {
          taskId: task.id,
          userId: commentUserId1,
          content:
            "Investigating root cause. Initial suspicion is misconfigured authentication middleware.",
          createdAt: daysAgo(2),
        },
        {
          taskId: task.id,
          userId: commentUserId1,
          content:
            "Root cause identified and fixed. Issue has been resolved and verified in staging and production.",
          createdAt: daysAgo(1),
        },
        {
          taskId: task.id,
          userId: commentUserId2,
          content:
            "Final resolution: updated configuration, cleared affected sessions, and added monitoring alert for future occurrences.",
          createdAt: daysAgo(1),
        },
      ]);

      // History entries (used as “steps”) - userId is required
      await db.insert(taskHistory).values([
        {
          taskId: task.id,
          userId: seedUserId,
          action: "status_changed",
          oldValue: "open",
          newValue: "in_progress",
          field: "status",
          createdAt: daysAgo(2),
        },
        {
          taskId: task.id,
          userId: seedUserId,
          action: "comment_added",
          oldValue: null,
          newValue: "Investigation notes added by support engineer",
          field: "comment",
          createdAt: daysAgo(2),
        },
        {
          taskId: task.id,
          userId: seedUserId,
          action: "status_changed",
          oldValue: "in_progress",
          newValue: "resolved",
          field: "status",
          createdAt: daysAgo(1),
        },
      ]);
    }

    console.log(
      `✓ Seeded ${insertedTasks.length} resolved tickets for knowledge learning test.`
    );
  } catch (error) {
    console.error("Error seeding knowledge learning data:", error);
    throw error;
  }
}
