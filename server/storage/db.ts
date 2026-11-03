import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is not set!");
  console.error(
    "Available environment variables:",
    Object.keys(process.env).filter(
      (key) => key.includes("DATABASE") || key.includes("DB")
    )
  );
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}

const connectionString = process.env.DATABASE_URL;
let hostname = "";
try {
  hostname = new URL(connectionString).hostname || "";
} catch { /* unparseable URL: hostname stays empty */ }

/**
 * A pool wait must fail, not hang: node-postgres waits forever by default, so one code path that
 * asks for a second connection while holding one can freeze every request. PG_POOL_MAX (optional,
 * a positive integer, default 10) sets the size.
 */
function poolLimits(): { max?: number; connectionTimeoutMillis: number } {
  const raw = process.env.PG_POOL_MAX?.trim();
  const n = Number(raw);
  const valid = Number.isInteger(n) && n > 0 && n <= 500;
  if (raw && !valid) console.warn("PG_POOL_MAX must be an integer from 1 to 500; using the default pool size");
  return {
    ...(valid ? { max: n } : {}),
    connectionTimeoutMillis: 10_000,
  };
}

let pool: NeonPool | PgPool;
export let db: ReturnType<typeof drizzleNeon> | ReturnType<typeof drizzlePg>;

// Decide which driver to use:
// - Always use native Postgres for localhost
// - Use Neon only if explicitly requested or hostname ends with .neon.tech
const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(hostname);
const isExplicitNeon = (process.env.DB_DRIVER || "").toLowerCase() === "neon";
const isNeonHost = /\.neon\.tech$/i.test(hostname);

if (isLocal || (!isExplicitNeon && !isNeonHost)) {
  // Native PostgreSQL driver (recommended for Render and most deployments)
  pool = new PgPool({ connectionString, ...poolLimits() });
  db = drizzlePg(pool as PgPool, { schema });
  console.log("Database driver: pg (node-postgres)");
} else {
  // Neon serverless driver (only when using a Neon database)
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString, ...poolLimits() });
  db = drizzleNeon({ client: pool as NeonPool, schema });
  console.log("Database driver: neon-serverless (WebSocket)");
}

/**
 * An idle pooled connection can be closed by the server (a PostgreSQL restart, a failover, an
 * idle timeout): the pool then emits "error", and with no listener Node treats it as uncaught and
 * the whole app exits. The pool has already dropped that connection and opens a new one on the
 * next query, so this only records it (the code alone: never the error text or its connection).
 */
export function onIdleConnectionError(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const label = typeof code === "string" ? code : error instanceof Error ? error.name : "error";
  console.error(`Database: an idle pooled connection was lost [${label}]; the next query opens a new one`);
}
(pool as PgPool).on("error", onIdleConnectionError);

export { pool };

/**
 * A drizzle transaction handle (db.transaction's callback argument) or a SAVEPOINT handle
 * (tx.transaction's). The two drivers' types do not unify, so it is deliberately loose; every
 * use is `conn.insert / conn.execute / conn.transaction` with the same shapes as `db`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbTx = any;
