import { readFileSync } from "fs";
import path from "path";
import { pool } from "../../storage/db";

/**
 * 0031 adds auto_routing_enabled to ai_settings and bedrock_settings. It runs against every
 * database a deploy touches and must never abort one: a missing table is skipped with a NOTICE.
 * Everything runs in a transaction that is rolled back, so the shared test database is untouched.
 */
const SQL = readFileSync(path.resolve(__dirname, "../../../migrations/0031_ai_routing.sql"), "utf8");

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

const columnCount = async (q: (sql: string) => Promise<unknown>) =>
  (
    (await q(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'auto_routing_enabled'
          AND table_name IN ('ai_settings', 'bedrock_settings')`
    )) as { rows: Array<{ n: number }> }
  ).rows[0].n;

describe("migration 0031 (auto_routing_enabled)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("adds the column to both settings tables, defaults false, and a second run changes nothing", async () => {
    await inRolledBackTransaction(async (q) => {
      await q(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS auto_routing_enabled`);
      await q(`ALTER TABLE bedrock_settings DROP COLUMN IF EXISTS auto_routing_enabled`);
      await q(SQL);
      await q(SQL);
      expect(await columnCount(q)).toBe(2);
      const rows = (await q(
        `SELECT auto_routing_enabled FROM ai_settings`
      )) as { rows: Array<{ auto_routing_enabled: boolean | null }> };
      for (const row of rows.rows) expect(row.auto_routing_enabled === null || row.auto_routing_enabled === false).toBe(true);
    });
  });

  it("skips with a NOTICE, and does not abort, when a table is absent", async () => {
    const notices = await inRolledBackTransaction(async (q) => {
      await q("ALTER TABLE ai_settings RENAME TO ai_settings_gone");
      await q("ALTER TABLE bedrock_settings RENAME TO bedrock_settings_gone");
      await expect(q(SQL)).resolves.toBeDefined();
    });
    expect(notices.join("\n")).toMatch(/0031: ai_settings .*absent/);
    expect(notices.join("\n")).toMatch(/0031: bedrock_settings is absent/);
  });
});