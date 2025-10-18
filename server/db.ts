import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is not set!");
  console.error("Available environment variables:", Object.keys(process.env).filter(key => key.includes('DATABASE') || key.includes('DB')));
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}

const connectionString = process.env.DATABASE_URL;
let hostname = "";
try {
  hostname = new URL(connectionString).hostname || "";
} catch {}

let pool: NeonPool | PgPool;
export let db: ReturnType<typeof drizzleNeon> | ReturnType<typeof drizzlePg>;

if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) {
  // Local PostgreSQL via native driver (no websockets)
  pool = new PgPool({ connectionString });
  db = drizzlePg(pool as PgPool, { schema });
} else {
  // Neon serverless for remote URLs
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString });
  db = drizzleNeon({ client: pool as NeonPool, schema });
}

export { pool };
