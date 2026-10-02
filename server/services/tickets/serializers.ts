import type { Task, TaskComment } from "@shared/schema";

/**
 * What a ticket or comment looks like leaving the service. REST has always
 * answered with the storage rows as they are, so these are the identity today:
 * one place to change if a field ever has to be hidden from every client.
 * (A comment read through getTicket already carries a public user projection.)
 */
export type TicketDTO = Task & Record<string, unknown>;
export type CommentDTO = TaskComment;

export function toTicketDTO<T extends object>(task: T): TicketDTO {
  return task as unknown as TicketDTO;
}

export function toCommentDTO(comment: TaskComment): CommentDTO {
  return comment;
}
