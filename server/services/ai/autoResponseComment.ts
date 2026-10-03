import { and, eq } from "drizzle-orm";
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
  const rows = await db
    .select({ content: taskComments.content })
    .from(taskComments)
    .where(and(eq(taskComments.taskId, taskId), eq(taskComments.userId, aiUserId)));
  const tail = `%): ${response}`;
  return rows.some((r) => r.content.startsWith(PREFIX) && r.content.endsWith(tail));
}
