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
  const n = Number(process.env.PG_POOL_MAX);
  return {
    ...(Number.isInteger(n) && n > 0 && n <= 500 ? { max: n } : {}),
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

export { pool };

/**
 * A drizzle transaction handle (db.transaction's callback argument) or a SAVEPOINT handle
 * (tx.transaction's). The two drivers' types do not unify, so it is deliberately loose; every
 * use is `conn.insert / conn.execute / conn.transaction` with the same shapes as `db`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbTx = any;
