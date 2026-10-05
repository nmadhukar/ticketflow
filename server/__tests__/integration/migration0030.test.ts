import { readFileSync } from "fs";
import path from "path";
import { pool } from "../../storage/db";

/**
 * 0030 (R90) adds extracted_text to help_documents and company_policies. It runs against every
 * database a deploy touches and must never abort one: a missing table is skipped with a NOTICE.
 * Everything runs in a transaction that is rolled back, so the shared test database is untouched.
 */
const SQL = readFileSync(path.resolve(__dirname, "../../../migrations/0030_document_extracted_text.sql"), "utf8");

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
        WHERE table_schema = current_schema() AND column_name = 'extracted_text'
          AND table_name IN ('help_documents', 'company_policies')`
    )) as { rows: Array<{ n: number }> }
  ).rows[0].n;

describe("migration 0030 (extracted_text)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("adds both columns to tables that lack them, keeps existing rows, and a second run changes nothing", async () => {
    await inRolledBackTransaction(async (q) => {
      await q(`ALTER TABLE help_documents DROP COLUMN IF EXISTS extracted_text`);
      await q(`ALTER TABLE company_policies DROP COLUMN IF EXISTS extracted_text`);
      await q(`INSERT INTO help_documents (title, filename, content, file_data) VALUES ('Old', 'old.docx', 'summary', 'UEsDBA==')`);
      await q(SQL);
      await q(SQL);
      expect(await columnCount(q)).toBe(2);
      const rows = (await q(`SELECT title, extracted_text FROM help_documents WHERE title = 'Old'`)) as {
        rows: Array<{ title: string; extracted_text: string | null }>;
      };
      expect(rows.rows).toEqual([{ title: "Old", extracted_text: null }]);
    });
  });

  it("skips with a NOTICE, and does not abort, when a table is absent", async () => {
    const notices = await inRolledBackTransaction(async (q) => {
      await q("ALTER TABLE help_documents RENAME TO help_documents_gone");
      await q("ALTER TABLE company_policies RENAME TO company_policies_gone");
      await expect(q(SQL)).resolves.toBeDefined();
    });
    expect(notices.join("\n")).toMatch(/0030: table help_documents is absent/);
    expect(notices.join("\n")).toMatch(/0030: table company_policies is absent/);
  });
});
