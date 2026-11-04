import type { Memory } from '@mastra/memory';
import { readRetentionDays } from './config.ts';

/**
 * Saved staff conversations are deleted this many days after their last activity (30 by default,
 * ASSISTANT_HISTORY_RETENTION_DAYS). Taken from Workforce Nexus' retention sweep.
 */
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 100;

type ThreadMemory = Pick<Memory, 'listThreads' | 'deleteThread'>;

/**
 * Deletes every thread whose last activity is older than the window, oldest first, and returns how
 * many went. Deleting a thread removes its messages too.
 */
export async function deleteExpiredThreads(memory: ThreadMemory, days: number, now = Date.now()): Promise<number> {
  const cutoff = now - days * DAY_MS;
  let deleted = 0;
  for (;;) {
    // Always page 0: each pass deletes what it read, so the next oldest moves up.
    const { threads } = await memory.listThreads({ page: 0, perPage: PAGE, orderBy: { field: 'updatedAt', direction: 'ASC' } });
    const expired = threads.filter((thread) => new Date(thread.updatedAt).getTime() < cutoff);
    for (const thread of expired) {
      await memory.deleteThread(thread.id);
      deleted += 1;
    }
    if (expired.length < threads.length || threads.length < PAGE) return deleted;
  }
}

/**
 * At start-up and every six hours; never keeps the process alive. One replica: two would only
 * delete the same expired threads twice, which is harmless.
 */
export function startRetentionSweep(memory: ThreadMemory, days = readRetentionDays()) {
  const sweep = () =>
    deleteExpiredThreads(memory, days)
      .then((n) => n > 0 && console.info(`[ticketflow-agents] deleted ${n} saved conversation(s) older than ${days} days`))
      .catch((error) => console.warn(`[ticketflow-agents] conversation retention sweep failed [${error instanceof Error ? error.name : 'error'}]`));
  void sweep();
  setInterval(sweep, SWEEP_EVERY_MS).unref();
}
