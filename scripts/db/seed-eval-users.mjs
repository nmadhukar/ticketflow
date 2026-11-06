// Creates (or brings up to date) the two accounts the dataset evaluations run as, and the tickets
// they own. Safe to run again: every step is idempotent, and a second run changes nothing.
//
//   eval-customer@ticketflow.test  role customer  -> support-assistant
//   eval-staff@ticketflow.test     role agent     -> ticket-assistant
//
// Both are active and approved, which runAuth.ts requires (keyOwnerBlockReason -> loginBlockReason
// refuses an inactive or unapproved account, and the AI/system accounts). The customer owns the
// tickets the evaluations ask about; the staff user is linked to them, so the staff agent sees them
// the way a real agent would.
//
// Usage (as the database owner, e.g. inside the app container, which has DATABASE_URL):
//   node scripts/db/seed-eval-users.mjs
//
// Refuses to run against a database whose name does not contain "eval" or "test": these accounts
// exist to be evaluated against, and must never appear in a real one.
import { fileURLToPath } from "node:url";
import pg from "pg";

export const CUSTOMER = { id: "eval-customer", email: "eval-customer@ticketflow.test", role: "customer" };
export const STAFF = { id: "eval-staff", email: "eval-staff@ticketflow.test", role: "agent" };

/**
 * The tickets the evaluations ask about. Fixed numbers, so a dataset item can name one.
 * They must match the assistant's ticket-number pattern (server/assistant/ticketRef.ts):
 * TKT-<4 digits>-<digits>. Year 2099 keeps them clear of real tickets.
 */
export const TICKETS = [
  {
    ticketNumber: "TKT-2099-0001",
    title: "Printer will not connect after the office move",
    description: "The office printer stopped appearing on the network after we moved desks on Monday.",
    category: "support",
    status: "open",
    priority: "medium",
  },
  {
    ticketNumber: "TKT-2099-0002",
    title: "Invoice export fails with a timeout",
    description: "Exporting the monthly invoice report times out after about 30 seconds.",
    category: "bug",
    status: "in_progress",
    priority: "high",
  },
  {
    ticketNumber: "TKT-2099-0003",
    title: "Request access to the reporting dashboard",
    description: "I need read access to the reporting dashboard for the finance team.",
    category: "request",
    status: "resolved",
    priority: "low",
  },
];

const ALLOWED_DB = /(eval|test)/i;
/** A database on this machine is a development one; a remote host is not. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|::1)$/i;

export function readOptions(env = process.env) {
  const problems = [];
  const adminUrl = env.DATABASE_URL?.trim();
  if (!adminUrl) problems.push("DATABASE_URL (the database owner's connection) is required.");
  let database = "";
  let host = "";
  try {
    const url = new URL(adminUrl ?? "");
    database = url.pathname.replace(/^\//, "");
    host = url.hostname;
  } catch {
    // Reported below.
  }
  // Allowed when the name says eval/test, or when the database is on this machine (a local dev
  // database). A remote database must say so in its name: these accounts must never appear in one.
  if (adminUrl && !ALLOWED_DB.test(database) && !LOCAL_HOST.test(host)) {
    problems.push(`refusing to seed "${database}" on ${host}: the database name must contain "eval" or "test", or the host must be local.`);
  }
  return { problems, adminUrl, database, host };
}

/** The statements, in order. Idempotent: a second run changes nothing. */
export function statements() {
  return [
    // Users. is_active and is_approved are what runAuth.ts checks before a run may call a tool.
    `INSERT INTO users (id, email, first_name, last_name, role, is_active, is_approved)
     VALUES ('${CUSTOMER.id}', '${CUSTOMER.email}', 'Eval', 'Customer', '${CUSTOMER.role}', true, true)
     ON CONFLICT (id) DO UPDATE SET role = '${CUSTOMER.role}', is_active = true, is_approved = true, updated_at = now()`,
    `INSERT INTO users (id, email, first_name, last_name, role, is_active, is_approved)
     VALUES ('${STAFF.id}', '${STAFF.email}', 'Eval', 'Staff', '${STAFF.role}', true, true)
     ON CONFLICT (id) DO UPDATE SET role = '${STAFF.role}', is_active = true, is_approved = true, updated_at = now()`,
    // Tickets, owned by the customer and assigned to the staff user.
    ...TICKETS.map(
      (t) => `INSERT INTO tasks (ticket_number, title, description, category, status, priority, assignee_id, assignee_type, created_by)
     VALUES ('${t.ticketNumber}', '${t.title}', '${t.description}', '${t.category}', '${t.status}', '${t.priority}', '${STAFF.id}', 'user', '${CUSTOMER.id}')
     ON CONFLICT (ticket_number) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
       status = EXCLUDED.status, priority = EXCLUDED.priority, assignee_id = EXCLUDED.assignee_id, updated_at = now()`,
    ),
  ];
}

export async function seed(env = process.env, log = console.log) {
  const { problems, adminUrl, database } = readOptions(env);
  if (problems.length) throw new Error(problems.join(" "));
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const sql of statements()) await client.query(sql);
    log(`eval-users: ${CUSTOMER.id} (customer) and ${STAFF.id} (agent) are in place in ${database}`);
    log(`eval-users: ${TICKETS.length} tickets: ${TICKETS.map((t) => t.ticketNumber).join(", ")}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed().catch((error) => {
    console.error(`eval-users: ${error.message}`);
    process.exit(1);
  });
}
