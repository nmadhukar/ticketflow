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
 * The store exists whenever MASTRA_DATABASE_URL is set, so retention keeps deleting old
 * conversations even after ASSISTANT_STAFF_HISTORY is switched off; that switch decides only
 * whether the agent uses memory.
 */

/** Below the role's CONNECTION LIMIT 10, leaving room for a second container during a redeploy. */
export const STORAGE_POOL_MAX = 4;

export function createStorage(env: NodeJS.ProcessEnv = process.env): PostgresStore | undefined {
  const url = readStorageUrl(env);
  if (!url) return undefined;
  return new PostgresStore({ id: 'ticketflow-assistant', connectionString: url, schemaName: STORAGE_SCHEMA, max: STORAGE_POOL_MAX });
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
/** Every saved conversation, for retention: present whenever the store is. */
export const conversationStore = createStaffMemory(storage);
/** The agent's memory: only while staff history is switched on. */
export const staffMemory = staffHistoryEnabled() ? conversationStore : undefined;
