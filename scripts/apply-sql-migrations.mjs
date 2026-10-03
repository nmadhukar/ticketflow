// Applies the hand-written SQL migrations (migrations/0007_*.sql onwards) to DATABASE_URL,
// in file-name order, each file once per run inside its own transaction. Ruling R32 (b).
//
// Why: production applies the schema with `drizzle-kit push`. On a database that holds any
// table or column shared/schema.ts does not declare, push asks "created or renamed?", finds
// no terminal, exits 0 and applies NOTHING. Running these files first creates every object
// the fix program added, so push has nothing left to ask about them; the startup schema check
// (server/startup/schemaCheck.ts) refuses to boot if anything is still missing.
//
// Every file run here must be idempotent: it runs again on every deploy. Verified by applying
// all of them twice to a push-built database and to one with seeded legacy data (see
// docs/ticketflow-fix-program-release-notes.md). A file that is not idempotent is listed in
// NOT_RUN with the reason, and is never edited (an applied migration is never changed).
//
// A brand-new database (no "users" table yet) is left alone: push creates the whole schema.
//
// Usage: DATABASE_URL=postgres://... node scripts/apply-sql-migrations.mjs
// Exit code 0 when every file applied (or there was nothing to do), 1 on the first failure;
// a failed file is rolled back and nothing after it runs.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

export const FIRST_VERSION = 7;

/**
 * Files at or above FIRST_VERSION that are deliberately not run, with the reason.
 * 0008 adds three foreign keys with plain ADD CONSTRAINT (no IF NOT EXISTS form exists in
 * Postgres). Every database built by push already has them under the same names, so the file
 * fails with 42710 duplicate_object on its first run, and on any second run. Everything else
 * it creates (ai_usage, the bedrock_settings columns, the indexes) is declared in
 * shared/schema.ts and created by push; the bedrock_usage table it drops is not in the schema.
 */
export const NOT_RUN = new Map([
  [
    "0008_migrate_ai_settings_to_db.sql",
    "not idempotent (ADD CONSTRAINT without IF NOT EXISTS); its objects are created by drizzle-kit push",
  ],
]);

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "..", "migrations");

/** The migration files this script considers, in the order it applies them. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[A-Za-z0-9_]+\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 4)) >= FIRST_VERSION)
    .sort();
}

/**
 * Applies the files to the database at `connectionString`. Returns what happened; throws on
 * the first failing file (after rolling it back). `log` receives one line per file.
 */
export async function applySqlMigrations({ connectionString, dir = MIGRATIONS_DIR, log = console.log }) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied = [];
  const notRun = [];
  try {
    const { rows } = await client.query(`SELECT to_regclass('public.users') IS NOT NULL AS ready`);
    if (!rows[0].ready) {
      log("sql-migrations: fresh database (no users table): nothing to apply, drizzle-kit push creates the schema");
      return { fresh: true, applied, notRun };
    }
    for (const file of listMigrations(dir)) {
      const reason = NOT_RUN.get(file);
      if (reason) {
        notRun.push(file);
        log(`sql-migrations: not run ${file}: ${reason}`);
        continue;
      }
      const text = readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(text);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = error && typeof error === "object" && "code" in error ? ` ${error.code}` : "";
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`sql-migrations: ${file} failed and was rolled back [${code.trim() || "error"}]: ${message}`, {
          cause: error,
        });
      }
      applied.push(file);
      log(`sql-migrations: applied ${file}`);
    }
    return { fresh: false, applied, notRun };
  } finally {
    await client.end();
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("sql-migrations: DATABASE_URL is not set");
    process.exit(1);
  }
  try {
    const result = await applySqlMigrations({ connectionString });
    if (!result.fresh) {
      console.log(`sql-migrations: done, ${result.applied.length} applied, ${result.notRun.length} not run`);
    }
  } catch (error) {
    // The message names the file and the Postgres error; it never contains the connection string.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
