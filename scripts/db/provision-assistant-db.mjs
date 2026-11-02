// Creates (or brings up to date) the assistant's own database role and schema, for its saved
// staff conversations (@mastra/pg in the agents service). Safe to run again: every step is
// idempotent, and a second run changes nothing but the password, which it sets again.
//
// The role can log in, owns the `mastra` schema, and nothing else: it cannot create databases or
// roles, holds no grant on any TicketFlow table, and its search_path is the mastra schema. The app
// keeps its own user; the agents service connects as this role (MASTRA_DATABASE_URL).
//
// Usage (as the database owner, e.g. inside the app container, which has DATABASE_URL):
//   MASTRA_DB_PASSWORD=<at least 24 random characters> node scripts/db/provision-assistant-db.mjs
// Optional: MASTRA_DB_USER (default ticketflow_mastra). The password is read from the
// environment, never printed, and sent only as an escaped literal.
//
// Rollback (removes every saved conversation):
//   DROP SCHEMA mastra CASCADE; REVOKE CONNECT ON DATABASE <db> FROM <role>; DROP ROLE <role>;
import { fileURLToPath } from "node:url";
import pg from "pg";

export const SCHEMA = "mastra";
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const MIN_PASSWORD_LENGTH = 24;

export function readOptions(env = process.env) {
  const problems = [];
  const adminUrl = env.DATABASE_URL?.trim();
  const user = env.MASTRA_DB_USER?.trim() || "ticketflow_mastra";
  const password = env.MASTRA_DB_PASSWORD ?? "";
  if (!adminUrl) problems.push("DATABASE_URL (the database owner's connection) is required.");
  if (!IDENT.test(user)) problems.push("MASTRA_DB_USER must be a lowercase identifier (letters, digits, underscore).");
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`MASTRA_DB_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (/[\s'"\\]/.test(password)) problems.push("MASTRA_DB_PASSWORD must not contain spaces, quotes or backslashes (it goes into a connection URL).");
  return { problems, adminUrl, user, password };
}

/** The statements, in order. `literal` escapes the password; identifiers are checked above. */
export function statements(user, password, database, literal) {
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${user}') THEN
         CREATE ROLE ${user} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 10;
       END IF;
     END $$`,
    // Repeated on every run, so a run after an attribute was changed by hand restores it.
    `ALTER ROLE ${user} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 10`,
    `ALTER ROLE ${user} PASSWORD ${literal(password)}`,
    `GRANT CONNECT ON DATABASE "${database}" TO ${user}`,
    `CREATE SCHEMA IF NOT EXISTS ${SCHEMA} AUTHORIZATION ${user}`,
    `ALTER SCHEMA ${SCHEMA} OWNER TO ${user}`,
    // Nothing in TicketFlow's own schema: not even USAGE.
    `REVOKE ALL ON SCHEMA public FROM ${user}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${user}`,
    `ALTER ROLE ${user} SET search_path = ${SCHEMA}`,
  ];
}

/** Connects as the role and proves what it can and cannot do. Throws when anything is wrong. */
export async function verify(adminUrl, user, password) {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT has_schema_privilege(current_user, $1, 'CREATE') AS own_schema,
              has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
              (SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = current_user) AS powerful`,
      [SCHEMA],
    );
    const r = rows[0];
    if (!r.own_schema) throw new Error(`the role cannot create objects in schema ${SCHEMA}`);
    if (r.powerful) throw new Error("the role has superuser, createdb or createrole");
    // USAGE on public can still come from PUBLIC (older Postgres defaults); a table read must not.
    const users = await client.query("SELECT has_table_privilege(current_user, 'public.users', 'SELECT') AS can_read").catch(() => ({ rows: [{ can_read: false }] }));
    if (users.rows[0].can_read) throw new Error("the role can read public.users");
    return { publicUsage: r.public_usage };
  } finally {
    await client.end();
  }
}

export async function provision(env = process.env, log = console.log) {
  const { problems, adminUrl, user, password } = readOptions(env);
  if (problems.length) throw new Error(problems.join(" "));
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query("SELECT current_database() AS db");
    for (const sql of statements(user, password, rows[0].db, (v) => admin.escapeLiteral(v))) await admin.query(sql);
    log(`assistant-db: role ${user} and schema ${SCHEMA} are in place in database ${rows[0].db}`);
  } finally {
    await admin.end();
  }
  const checked = await verify(adminUrl, user, password);
  log(`assistant-db: verified: ${user} owns ${SCHEMA}, cannot read TicketFlow tables${checked.publicUsage ? " (PUBLIC still grants USAGE on schema public: tables stay unreadable)" : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  provision().catch((error) => {
    console.error(`assistant-db: ${error.message}`);
    process.exit(1);
  });
}
