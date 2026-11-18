import { Memory } from '@mastra/memory';
import { readStorageUrl } from './config.ts';
import { storage } from './storage.ts';

/**
 * Conversation memory for Mastra Studio, so a demo conversation survives a page reload.
 *
 * Why it is separate from the agents' production memory (storage.ts):
 *
 *  - The customer's assistant must never save a conversation (support-assistant.ts: no memory), and
 *    the staff assistant only saves while ASSISTANT_STAFF_HISTORY=true. Tying the Studio demo to
 *    that switch would either leak customer chats or do nothing on a machine where it is off.
 *  - Studio runs as the seeded eval accounts (mcp.ts, studioRunUser). Its threads are named after
 *    those accounts, so this memory never holds a real customer's conversation.
 *
 * It uses the same store and schema as datasets, so Studio's Memory/resource view lists the threads
 * beside the experiments. Null when there is no usable MASTRA_DATABASE_URL, in which case Studio
 * keeps working exactly as before (nothing saved).
 *
 * On only for a local Studio: MASTRA_STUDIO_NO_AUTH=true is refused in production by
 * config-issues.ts, and docker-compose.studio.yml sets it. A deployed sidecar therefore gets no
 * extra storage at all.
 */
export function studioMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MASTRA_STUDIO_NO_AUTH === 'true' && readStorageUrl(env) !== '';
}

export const studioMemory: Memory | undefined = (() => {
  if (!storage || !studioMemoryEnabled()) return undefined;
  return new Memory({
    storage,
    // A demo is a handful of turns; twenty messages keeps the prompt small and the history long
    // enough to follow "and the next scenario?" without resending everything.
    options: { lastMessages: 20, generateTitle: false },
  });
})();
