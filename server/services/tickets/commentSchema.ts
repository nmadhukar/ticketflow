import { z } from "zod";

/** A comment body: trimmed, 1..10000 characters. Shared by POST /api/tasks/:id/comments and inbound email. */
export const COMMENT_MAX_LENGTH = 10000;

export const commentBodySchema = z.object({
  content: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
});
