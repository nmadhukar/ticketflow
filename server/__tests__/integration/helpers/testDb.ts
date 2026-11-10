import { sql, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db, pool } from "../../../storage/db";
import * as schema from "@shared/schema";

const appTables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => `"${getTableName(table as PgTable)}"`);

/**
 * A test's request can finish while work it started is still running: a ticket create awaits its
 * AI hooks on a chain that continues after the response, and the realtime knowledge-learning path
 * runs its own inserts. A TRUNCATE in that window pulls the users/teams rows out from under those
 * writes, so the NEXT test fails with a foreign key ("api_keys_user_id_users_id_fk",
 * "tasks_assignee_id_users_id_fk") or a deadlock on `createTeam`. resetDb therefore drains the
 * barrier first, so the truncate waits for them instead of racing them.
 */
let pending = 0;
let drained: (() => void) | null = null;

/**
 * Wraps background work so it holds the barrier open until it settles. Never changes what the work
 * does or when it runs: the promise is returned unchanged. A failure is the caller's to handle.
 */
export function trackBackgroundWork<T>(work: Promise<T>): Promise<T> {
  pending += 1;
  const done = () => {
    pending -= 1;
    if (pending === 0 && drained) drained();
  };
  work.then(done, done);
  return work;
}

/** Resolves once every tracked unit of background work has settled (or after timeoutMs). */
export async function waitForBackgroundWork(timeoutMs = 15_000): Promise<void> {
  if (pending === 0) return;
  const settledNow = new Promise<void>((resolve) => {
    drained = resolve;
  });
  await Promise.race([settledNow, new Promise((r) => setTimeout(r, timeoutMs))]);
  drained = null;
}

/** Empties every application table (including sessions) and restarts identity counters. */
export async function resetDb(): Promise<void> {
  // A previous test's background writes must finish before the tables are pulled away.
  await waitForBackgroundWork();
  // TRUNCATE ... CASCADE is unrecoverable; never let it near a real database.
  const dbName = new URL(process.env.DATABASE_URL ?? "").pathname;
  if (!/test/i.test(dbName)) {
    throw new Error(`resetDb refuses to truncate "${dbName}": database name must contain "test"`);
  }
  const truncate = () =>
    db.execute(sql.raw(`TRUNCATE TABLE ${appTables.join(", ")} RESTART IDENTITY CASCADE`));
  try {
    await truncate();
  } catch (error) {
    // 40P01 deadlock_detected: a previous test's background work still holds a lock. Once more.
    const cause = (error as { cause?: { code?: string }; code?: string }) ?? {};
    if ((cause.cause?.code ?? cause.code) !== "40P01") throw error;
    await new Promise((r) => setTimeout(r, 200));
    await truncate();
  }
}

/** Closes the shared connection pool. Call once, after the last test of a file. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
