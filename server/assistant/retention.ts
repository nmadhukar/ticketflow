import { inArray, lt } from "drizzle-orm";
import { assistantAuditEvents, assistantUsageEvents } from "@shared/schema";
import { readRetentionDays } from "./config";

/**
 * Retention of the assistant's own records, apart from each other: usage analytics
 * (assistant_usage_events, 90 days by default) and the audit trail (assistant_audit_events, 365).
 * Their ai_usage cost rows follow ai_usage's own handling. Proposals have theirs (proposals.ts).
 * In batches, so a large backlog never holds one long delete.
 */
const BATCH = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function deleteOlderThan(table: typeof assistantUsageEvents | typeof assistantAuditEvents, cutoff: Date): Promise<number> {
  const { db } = await import("../storage/db");
  const column = table === assistantUsageEvents ? assistantUsageEvents.startedAt : assistantAuditEvents.occurredAt;
  const idColumn = table === assistantUsageEvents ? assistantUsageEvents.id : assistantAuditEvents.id;
  let total = 0;
  for (;;) {
    const ids = (await db.select({ id: idColumn }).from(table).where(lt(column, cutoff)).limit(BATCH)).map((r) => r.id);
    if (ids.length === 0) return total;
    await db.delete(table).where(inArray(idColumn, ids));
    total += ids.length;
    if (ids.length < BATCH) return total;
  }
}

export async function cleanUpAssistantRecords(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ usage: number; audit: number }> {
  const usage = await deleteOlderThan(assistantUsageEvents, new Date(now.getTime() - readRetentionDays("ASSISTANT_USAGE_RETENTION_DAYS", env) * DAY_MS));
  const audit = await deleteOlderThan(assistantAuditEvents, new Date(now.getTime() - readRetentionDays("ASSISTANT_AUDIT_RETENTION_DAYS", env) * DAY_MS));
  return { usage, audit };
}

/** Daily, unref'd (as tickets/autoClose.ts), with the assistant enabled. */
export function startAssistantRecordCleanup(log: (line: string) => void = console.log): NodeJS.Timeout {
  const run = () =>
    cleanUpAssistantRecords()
      .then((r) => (r.usage || r.audit) && log(`assistant records: ${r.usage} usage and ${r.audit} audit rows past retention deleted`))
      .catch((error) => console.error(`assistant record cleanup failed [${error instanceof Error ? error.name : "error"}]`));
  void run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return timer;
}
