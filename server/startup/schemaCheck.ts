/**
 * Ruling R32 (a): the server refuses to boot when the database lacks a schema
 * object the code depends on.
 *
 * Production applies the schema with `drizzle-kit push`. On a database that
 * holds any table or column shared/schema.ts does not declare, push asks
 * "created or renamed?", has no terminal to ask on, exits 0 and applies
 * nothing. Without this check the app would then start, and every login and
 * every ticket create would answer 500. With it, the container stops with one
 * line that names what is missing.
 *
 * The list is every object the fix program added that a request path needs
 * (migrations 0010-0019 and the matching shared/schema.ts additions), plus the
 * session table logins need. Add an entry when a new migration adds an object
 * the code reads.
 */

export interface RequiredTable {
  table: string;
  /** Columns that must exist; the table itself is always required. */
  columns: string[];
}

export const REQUIRED_TABLES: RequiredTable[] = [
  {
    table: "users",
    // 0010 login lockout, 0011 forced password change, session revocation.
    columns: ["failed_login_attempts", "locked_until", "must_change_password", "password_changed_at"],
  },
  // connect-pg-simple runs with createTableIfMissing: false.
  { table: "sessions", columns: ["sid", "sess", "expire"] },
  // 0012 safe ticket numbers: every ticket create takes a row lock here.
  { table: "ticket_number_counters", columns: ["prefix", "year", "last_number"] },
  // 0018 / 0019 inbound email dedupe (claim state).
  { table: "sns_message_dedupe", columns: ["message_id", "status", "received_at"] },
  // 0014 hashed API keys (the hash column predates the program; the index below does not).
  { table: "api_keys", columns: ["key_hash", "is_active"] },
  // 0021 AI analytics: the time a draft was applied.
  { table: "ticket_auto_responses", columns: ["applied_at"] },
];

/** 0014: unique partial index over hashed keys. */
export const REQUIRED_INDEXES: { table: string; index: string }[] = [
  { table: "api_keys", index: "api_keys_key_hash_sha256_uniq" },
];

/** Anything with a node-postgres style `query` (pg Pool, pg Client, Neon Pool). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * The required objects absent from the connected database's current schema, as
 * `table`, `table.column` or `index name` strings. Empty when all exist.
 */
export async function findMissingSchemaObjects(db: Queryable): Promise<string[]> {
  const tables = REQUIRED_TABLES.map((t) => t.table);
  const { rows: columnRows } = await db.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [tables]
  );
  const present = new Map<string, Set<string>>();
  for (const r of columnRows) {
    const name = String(r.table_name);
    if (!present.has(name)) present.set(name, new Set());
    present.get(name)!.add(String(r.column_name));
  }

  const missing: string[] = [];
  for (const { table, columns } of REQUIRED_TABLES) {
    const cols = present.get(table);
    if (!cols) {
      missing.push(table);
      continue;
    }
    for (const c of columns) if (!cols.has(c)) missing.push(`${table}.${c}`);
  }

  const { rows: indexRows } = await db.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`,
    [REQUIRED_INDEXES.map((i) => i.index)]
  );
  const indexes = new Set(indexRows.map((r) => String(r.indexname)));
  for (const { index } of REQUIRED_INDEXES) if (!indexes.has(index)) missing.push(`index ${index}`);
  return missing;
}

export function schemaRefusalMessage(missing: string[]): string {
  return (
    `Startup refused: the database schema is missing ${missing.join(", ")}. ` +
    `Run "npm run db:migrate-sql" and then "npm run db:push" against this database, then start again.`
  );
}

/**
 * Exits the process (code 1) with one log line when anything required is
 * missing, or when the check itself cannot read the catalog. `exit` and `log`
 * are injectable for tests.
 */
export async function assertSchemaReady(opts: {
  db: Queryable;
  log?: (line: string) => void;
  exit?: (code: number) => never | void;
}): Promise<boolean> {
  const log = opts.log ?? ((line: string) => console.error(line));
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let missing: string[];
  try {
    missing = await findMissingSchemaObjects(opts.db);
  } catch (error) {
    const e = error as { name?: unknown; code?: unknown } | null;
    const kind = typeof e?.name === "string" ? e.name : "error";
    const code = typeof e?.code === "string" ? ` ${e.code}` : "";
    log(`Startup refused: the database schema could not be checked [${kind}${code}].`);
    exit(1);
    return false;
  }
  if (missing.length === 0) return true;
  log(schemaRefusalMessage(missing));
  exit(1);
  return false;
}
