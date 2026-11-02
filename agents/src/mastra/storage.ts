import { PostgresStore } from '@mastra/pg';
import { Memory } from '@mastra/memory';
import { readStorageUrl, staffHistoryEnabled, STORAGE_SCHEMA } from './config.ts';

/**
 * Saved staff conversations, in TicketFlow's PostgreSQL under the assistant's own role and the
 * `mastra` schema (provisioned by scripts/db/provision-assistant-db.mjs): the role owns that schema
 * and can read no TicketFlow table.
 *
 * Only the ticket assistant (staff) has memory. Its threads are scoped to the user twice: the
 * resource is user:<id> (auth.ts, mapUserToResourceId) and the app prefixes every thread id with
 * the user's id, so no request can name another user's thread.
 *
 * Mastra stores tool results with the messages, so a saved conversation holds what the tools
 * returned to that staff member. It is kept ASSISTANT_HISTORY_RETENTION_DAYS (30) days
 * (retention.ts), and the app hides a saved conversation from a user who has since lost access to
 * a ticket it mentions.
 *
 * Off (no storage, no memory) unless ASSISTANT_STAFF_HISTORY=true.
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): PostgresStore | undefined {
  if (!staffHistoryEnabled(env)) return undefined;
  return new PostgresStore({ id: 'ticketflow-assistant', connectionString: readStorageUrl(env), schemaName: STORAGE_SCHEMA });
}

export function createStaffMemory(store: PostgresStore | undefined): Memory | undefined {
  if (!store) return undefined;
  return new Memory({
    storage: store,
    // The last 20 messages of the thread go back to the model. No titles: generating one is an
    // extra model call that copies ticket content into a field shown in lists.
    options: { lastMessages: 20, generateTitle: false },
  });
}

export const storage = createStorage();
export const staffMemory = createStaffMemory(storage);
