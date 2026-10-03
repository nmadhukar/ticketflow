import { readFileSync } from "fs";
import path from "path";
import { pool } from "../../storage/db";

/**
 * 0021 runs against every database the deploy touches, in turn, and must never abort it: on a
 * database that has `users` but not `ticket_auto_responses` (older than the table's migration) it
 * skips with a NOTICE instead of failing with "relation does not exist". Everything runs in a
 * transaction that is rolled back, so the shared test database is untouched.
 */
const SQL = readFileSync(path.resolve(__dirname, "../../../migrations/0021_ticket_auto_responses_applied_at.sql"), "utf8");

async function inRolledBackTransaction(run: (q: (sql: string) => Promise<unknown>) => Promise<void>) {
  const client = await pool.connect();
  const notices: string[] = [];
  (client as unknown as { on(e: "notice", f: (n: { message: string }) => void): void }).on("notice", (n) => notices.push(n.message));
  try {
    await client.query("BEGIN");
    await run((sql) => client.query(sql));
    return notices;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("migration 0021 (ticket_auto_responses.applied_at)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("skips with a NOTICE, and does not abort, when ticket_auto_responses is absent", async () => {
    const notices = await inRolledBackTransaction(async (q) => {
      await q("ALTER TABLE ticket_auto_responses RENAME TO ticket_auto_responses_gone");
      await expect(q(SQL)).resolves.toBeDefined();
    });
    expect(notices.join("\n")).toMatch(/0021.*ticket_auto_responses.*skipp/i);
  });

  it("adds the column when the table exists, and a second run changes nothing", async () => {
    await inRolledBackTransaction(async (q) => {
      await q("ALTER TABLE ticket_auto_responses DROP COLUMN IF EXISTS applied_at");
      await q(SQL);
      await q(SQL);
      const res = (await q(
        "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'ticket_auto_responses' AND column_name = 'applied_at'"
      )) as { rows: Array<{ n: number }> };
      expect(res.rows[0].n).toBe(1);
    });
  });
});
