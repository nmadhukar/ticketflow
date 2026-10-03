import { sql, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db, pool } from "../../../storage/db";
import * as schema from "@shared/schema";

const appTables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => `"${getTableName(table as PgTable)}"`);

/** Empties every application table (including sessions) and restarts identity counters. */
export async function resetDb(): Promise<void> {
  // TRUNCATE ... CASCADE is unrecoverable; never let it near a real database.
  const dbName = new URL(process.env.DATABASE_URL ?? "").pathname;
  if (!/test/i.test(dbName)) {
    throw new Error(`resetDb refuses to truncate "${dbName}": database name must contain "test"`);
  }
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${appTables.join(", ")} RESTART IDENTITY CASCADE`)
  );
}

/** Closes the shared connection pool. Call once, after the last test of a file. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
