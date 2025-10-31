import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is not set!");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const db = drizzle(pool);

async function runMigrations() {
  try {
    console.log("Starting database migrations...");
    console.log(`DATABASE_URL: ${connectionString.replace(/:[^:@]+@/, ":****@")}`);
    
    await migrate(db, { migrationsFolder: "./migrations" });
    
    console.log("✓ Migrations completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("✗ Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();

