import { and, asc, eq, sql } from "drizzle-orm";
import { taskComments } from "@shared/schema";
import { db } from "../../storage/db";

/** The comment an AI auto-response is posted as. Create-time and the staff "apply" route both use it. */
export function autoResponseCommentBody(confidence: number, response: string): string {
  return `AI Auto-Response (confidence ${(confidence * 100).toFixed(0)}%): ${response}`;
}

const PREFIX = "AI Auto-Response (confidence ";

/**
 * True when the AI user already posted this response on the ticket. Matches the
 * response text, not the percentage: the draft stores confidence to two decimals while
 * the create path formatted the unrounded value, so the two can differ by a point.
 *
 * This is what makes a later apply safe after "comment written, setApplied failed":
 * the apply route finds the comment, marks the draft applied and posts nothing.
 */
export async function autoResponseCommentExists(taskId: number, aiUserId: string, response: string): Promise<boolean> {
  return (await findAutoResponseComment(taskId, aiUserId, response)) !== null;
}

/**
 * The earliest matching comment's created_at (null when there is none). R64: the match is a SQL
 * filter, not a scan of every comment the AI user wrote on the ticket. left()/right() compare
 * literal text, so a `%`, `_` or quote in the response is never a LIKE wildcard, and both
 * halves are bound parameters.
 */
export async function findAutoResponseComment(
  taskId: number,
  aiUserId: string,
  response: string
): Promise<Date | null> {
  const tail = `%): ${response}`;
  const [row] = await db
    .select({ createdAt: taskComments.createdAt })
    .from(taskComments)
    .where(
      and(
        eq(taskComments.taskId, taskId),
        eq(taskComments.userId, aiUserId),
        sql`left(${taskComments.content}, ${PREFIX.length}) = ${PREFIX}`,
        // Postgres counts characters (code points); String.length counts UTF-16 units.
        sql`right(${taskComments.content}, ${Array.from(tail).length}) = ${tail}`
      )
    )
    .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
    .limit(1);
  return row ? (row.createdAt ?? new Date()) : null;
}
