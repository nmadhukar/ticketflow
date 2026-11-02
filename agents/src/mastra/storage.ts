import { PostgresStore } from '@mastra/pg';
import { Memory } from '@mastra/memory';
import { readStorageUrl, staffHistoryEnabled, STORAGE_SCHEMA } from './config.ts';

/**
 * Saved staff conversations, in TicketFlow's PostgreSQL under the assistant's own role and the
 * `mastra` schema (provisioned by scripts/db/provision-assistant-db.mjs): the role owns that schema
 * and can read no TicketFlow table.
 *
 * Only the ticket assistant (staff) has memory, and only while ASSISTANT_STAFF_HISTORY=true. Only
 * then is the store given to Mastra itself, so nothing else (customer runs included) can write to
 * the schema while the feature is off. Threads are scoped to the user twice: the resource is
 * user:<id> (auth.ts, mapUserToResourceId) and the app prefixes every thread id with the user's id.
 *
 * Mastra stores tool results with the messages, so a saved conversation holds what the tools
 * returned to that staff member. It is kept ASSISTANT_HISTORY_RETENTION_DAYS (30) days
 * (retention.ts), and the app hides a saved conversation from a user who has since lost access to
 * a ticket it mentions.
 *
 * Retention keeps running after history is switched off, as long as MASTRA_DATABASE_URL is set: it
 * then uses a store of its own (`retentionStore`), never handed to Mastra.
 */

/** Below the role's CONNECTION LIMIT 10, leaving room for a second container during a redeploy. */
export const STORAGE_POOL_MAX = 4;

/** A usable postgres:// URL with credentials, or null. Never logged: it carries the password. */
export function usableStorageUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = readStorageUrl(env);
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && url.username && url.password ? value : null;
  } catch {
    return null;
  }
}

function createStore(url: string, max: number): PostgresStore {
  return new PostgresStore({ id: 'ticketflow-assistant', connectionString: url, schemaName: STORAGE_SCHEMA, max });
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

const url = usableStorageUrl();
const historyOn = staffHistoryEnabled();
if (!historyOn && readStorageUrl() && !url) {
  // History is off, so this is not fatal (the customer assistant must keep working); but saved
  // conversations, if any, are not being deleted until it is fixed.
  console.warn('[ticketflow-agents] MASTRA_DATABASE_URL is not a usable postgres:// URL: saved conversations are not being deleted.');
}

/** Mastra's own store: only while staff history is on. */
export const storage = historyOn && url ? createStore(url, STORAGE_POOL_MAX) : undefined;
/** The agent's memory: only while staff history is on. */
export const staffMemory = createStaffMemory(storage);
/**
 * Every saved conversation, for retention: the agent's memory while history is on, otherwise a
 * small store of retention's own (one connection) whenever the URL is usable.
 */
export const retentionStore: { memory: Memory; store: PostgresStore } | undefined = storage
  ? { memory: staffMemory!, store: storage }
  : url
    ? (() => {
        const store = createStore(url, 1);
        return { memory: createStaffMemory(store)!, store };
      })()
    : undefined;
