import { readFileSync } from "fs";
import { resolve } from "path";
import { pool } from "../../../storage/db";

/**
 * The assistant's migrations beyond what schemaSafety.test.ts checks (every 0007+ file applies
 * twice after push): 0033 also renames step_count, the column's name in its first build, on a
 * database where that build already ran. Inside a transaction that is rolled back.
 */
const sql0033 = readFileSync(resolve(__dirname, "../../../../migrations/0033_assistant_usage_events.sql"), "utf8");

async function columns(client: import("pg").PoolClient): Promise<string[]> {
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'assistant_usage_events' AND column_name LIKE '%count'",
  );
  return rows.map((r: { column_name: string }) => r.column_name).sort();
}

describe("assistant migrations", () => {
  it("0033 renames step_count to tool_call_count where its first build ran, and is then a no-op", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE assistant_usage_events RENAME COLUMN tool_call_count TO step_count");
      expect(await columns(client)).toEqual(["proposal_count", "step_count"]);
      await client.query(sql0033);
      expect(await columns(client)).toEqual(["proposal_count", "tool_call_count"]);
      await client.query(sql0033);
      expect(await columns(client)).toEqual(["proposal_count", "tool_call_count"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
