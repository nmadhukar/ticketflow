import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import pg from "pg";
import { pool } from "../../storage/db";
import { storage } from "../../storage";

const migrationPath = path.resolve(__dirname, "../../../migrations/0023_ai_settings.sql");
const root = path.resolve(__dirname, "../../..");
const migrationSql = () => readFileSync(migrationPath, "utf8");

async function withStorageFixture(run: (legacyId: number, userId: string) => Promise<void>) {
  await pool.query(migrationSql());
  const originalAi = (await pool.query("SELECT * FROM ai_settings")).rows;
  const originalLegacy = (await pool.query("SELECT id, is_active FROM bedrock_settings")).rows;
  const userId = "migration-0023-storage-user";
  const existingUser = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
  if (!existingUser.rowCount) {
    await pool.query("INSERT INTO users (id, email, role, is_active, is_approved) VALUES ($1, 'migration-0023-storage@example.test', 'agent', true, true)", [userId]);
  }
  await pool.query("DELETE FROM ai_settings");
  await pool.query("UPDATE bedrock_settings SET is_active = false");
  const inserted = await pool.query(`
    INSERT INTO bedrock_settings (bedrock_access_key_id, bedrock_secret_access_key, bedrock_model_id,
      max_tokens, daily_limit_usd, is_active)
    VALUES ('keep-access', 'keep-secret', 'amazon.titan-text-express-v1', 2000, 50.00, true)
    RETURNING id
  `);
  const legacyId = inserted.rows[0].id as number;
  try {
    await run(legacyId, userId);
  } finally {
    await pool.query("DELETE FROM ai_settings");
    if (originalAi.length) {
      const row = originalAi[0] as Record<string, unknown>;
      const columns = Object.keys(row);
      await pool.query(
        `INSERT INTO ai_settings (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(row)
      );
    }
    await pool.query("DELETE FROM bedrock_settings WHERE id = $1", [legacyId]);
    for (const row of originalLegacy) {
      await pool.query("UPDATE bedrock_settings SET is_active = $1 WHERE id = $2", [row.is_active, row.id]);
    }
    if (!existingUser.rowCount) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
}

/**
 * 0023 runs against every database the deploy touches, in turn, before drizzle-kit push, and must
 * never abort it. A database that has `users` but predates the AI tables used to fail with 42P01
 * ("relation bedrock_settings does not exist") and the container then did not start. Each case
 * runs in a transaction that is rolled back, so the shared test database is untouched.
 */
async function inRolledBackTransaction(run: (q: (sql: string) => Promise<{ rows: any[] }>) => Promise<void>) {
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

// One pool, ended once, after every describe block in this file has run.
afterAll(async () => {
  await pool.end();
});

describe("migration 0023 never aborts on a database that predates the AI tables", () => {
  it("applies twice on a database that has users and teams but no bedrock_settings and no ai_usage", async () => {
    const testUrl = new URL(process.env.DATABASE_URL!);
    const scratchName = `${testUrl.pathname.slice(1)}_ai0023old`;
    expect(scratchName).toMatch(/test/);
    const adminUrl = new URL(testUrl.toString());
    adminUrl.pathname = "/postgres";
    const scratchUrl = new URL(testUrl.toString());
    scratchUrl.pathname = `/${scratchName}`;
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    let scratch: pg.Client | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${scratchName}"`);
      scratch = new pg.Client({ connectionString: scratchUrl.toString() });
      await scratch.connect();
      const notices: string[] = [];
      scratch.on("notice", (n) => notices.push(String(n.message)));
      await scratch.query("CREATE TABLE users (id varchar PRIMARY KEY)");
      await scratch.query("CREATE TABLE teams (id serial PRIMARY KEY)");

      await expect(scratch.query(migrationSql())).resolves.toBeDefined();
      await expect(scratch.query(migrationSql())).resolves.toBeDefined();

      // push has nothing to ask about: ai_settings exists (empty, so AI reads as inactive) and the
      // tables that were never there are still not there.
      const table = await scratch.query(
        "SELECT to_regclass('ai_settings') IS NOT NULL AS ai, to_regclass('bedrock_settings') IS NOT NULL AS legacy, to_regclass('ai_usage') IS NOT NULL AS usage"
      );
      expect(table.rows[0]).toEqual({ ai: true, legacy: false, usage: false });
      expect((await scratch.query("SELECT count(*)::int AS n FROM ai_settings")).rows[0].n).toBe(0);
      expect(notices.join("\n")).toMatch(/0023.*bedrock_settings.*(absent|skipp)/i);
      expect(notices.join("\n")).toMatch(/0023.*ai_usage.*(absent|skipp)/i);
    } finally {
      await scratch?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60000);

  it("skips the copy with a NOTICE when bedrock_settings is absent, and a second run changes nothing", async () => {
    const notices = await inRolledBackTransaction(async (q) => {
      await q("DROP TABLE ai_settings");
      await q("ALTER TABLE bedrock_settings RENAME TO bedrock_settings_gone");
      await expect(q(migrationSql())).resolves.toBeDefined();
      await expect(q(migrationSql())).resolves.toBeDefined();
      expect((await q("SELECT count(*)::int AS n FROM ai_settings")).rows[0].n).toBe(0);
    });
    expect(notices.join("\n")).toMatch(/0023.*bedrock_settings.*(absent|skipp)/i);
  });

  it("skips the copy with a NOTICE when bedrock_settings predates the AI columns", async () => {
    const notices = await inRolledBackTransaction(async (q) => {
      await q("DROP TABLE ai_settings");
      await q("UPDATE bedrock_settings SET is_active = false");
      await q("INSERT INTO bedrock_settings (is_active) VALUES (true)");
      await q("ALTER TABLE bedrock_settings DROP COLUMN max_requests_per_minute");
      await expect(q(migrationSql())).resolves.toBeDefined();
      await expect(q(migrationSql())).resolves.toBeDefined();
      expect((await q("SELECT count(*)::int AS n FROM ai_settings")).rows[0].n).toBe(0);
    });
    expect(notices.join("\n")).toMatch(/0023.*bedrock_settings.*(column|skipp)/i);
  });

  it("skips ai_usage with a NOTICE when it is absent, and still copies the settings", async () => {
    const notices = await inRolledBackTransaction(async (q) => {
      await q("DROP TABLE ai_settings");
      await q("UPDATE bedrock_settings SET is_active = false");
      await q("INSERT INTO bedrock_settings (is_active, max_tokens) VALUES (true, 1234)");
      await q("ALTER TABLE ai_usage RENAME TO ai_usage_gone");
      await expect(q(migrationSql())).resolves.toBeDefined();
      await expect(q(migrationSql())).resolves.toBeDefined();
      expect((await q("SELECT max_tokens FROM ai_settings WHERE id = 1")).rows[0].max_tokens).toBe(1234);
    });
    expect(notices.join("\n")).toMatch(/0023.*ai_usage.*(absent|skipp)/i);
  });

  it("skips creating ai_settings with a NOTICE when teams is absent", async () => {
    const notices = await inRolledBackTransaction(async (q) => {
      await q("DROP TABLE ai_settings");
      await q("ALTER TABLE teams RENAME TO teams_gone");
      await expect(q(migrationSql())).resolves.toBeDefined();
      const exists = await q("SELECT to_regclass('ai_settings') IS NOT NULL AS present");
      expect(exists.rows[0].present).toBe(false);
    });
    expect(notices.join("\n")).toMatch(/0023.*ai_settings.*(teams|skipp)/i);
  });
});

/**
 * N2 (regression coverage for the dangling-reference branch added in 8f627db). This is a coverage
 * test written AFTER the fix, against code that already behaves this way: it passed on its first
 * run and was not red first. It guards the branch against being removed or loosened.
 *
 * A legacy bedrock_settings table without its own foreign keys can name an escalation team or an
 * updated_by user that no longer exists. ai_settings has those foreign keys, so copying the ids
 * as they stand would abort 0023, and with it the deploy for every database. A dangling id is
 * copied as NULL; an id that still resolves is kept.
 */
describe("migration 0023 copies a legacy row whose references no longer exist", () => {
  const MISSING_TEAM_ID = -4242;
  const MISSING_USER_ID = "migration-0023-ghost-user";
  const REAL_USER_ID = "migration-0023-real-user";

  async function copiedReferences(refs: { team: "missing" | "valid"; user: "missing" | "valid" }) {
    let copied: { escalation_team_id: number | null; updated_by: string | null; max_tokens: number; copies: number } | undefined;
    let teamId = MISSING_TEAM_ID;
    await inRolledBackTransaction(async (q) => {
      await q("DROP TABLE ai_settings");
      // The legacy table has no foreign keys: that is how a dangling reference got into it.
      await q(`
        DO $$
        DECLARE fk text;
        BEGIN
          FOR fk IN SELECT conname FROM pg_constraint WHERE conrelid = 'bedrock_settings'::regclass AND contype = 'f' LOOP
            EXECUTE format('ALTER TABLE bedrock_settings DROP CONSTRAINT %I', fk);
          END LOOP;
        END
        $$
      `);
      await q("UPDATE bedrock_settings SET is_active = false");
      await q(`INSERT INTO users (id, email, role, is_active, is_approved) VALUES ('${REAL_USER_ID}', 'migration-0023-real@example.test', 'agent', true, true)`);
      await q("INSERT INTO departments (name) VALUES ('migration-0023-department')");
      teamId = (await q("INSERT INTO teams (name, department_id) SELECT 'migration-0023-team', id FROM departments WHERE name = 'migration-0023-department' RETURNING id")).rows[0].id;
      const team = refs.team === "valid" ? String(teamId) : String(MISSING_TEAM_ID);
      const user = refs.user === "valid" ? REAL_USER_ID : MISSING_USER_ID;
      expect((await q(`SELECT count(*)::int AS n FROM teams WHERE id = ${MISSING_TEAM_ID}`)).rows[0].n).toBe(0);
      expect((await q(`SELECT count(*)::int AS n FROM users WHERE id = '${MISSING_USER_ID}'`)).rows[0].n).toBe(0);
      await q(`INSERT INTO bedrock_settings (is_active, max_tokens, escalation_team_id, updated_by) VALUES (true, 1111, ${team}, '${user}')`);

      // Applied twice: exit OK both times (no foreign-key violation), and the second changes nothing.
      await expect(q(migrationSql())).resolves.toBeDefined();
      await expect(q(migrationSql())).resolves.toBeDefined();
      copied = (await q("SELECT escalation_team_id, updated_by, max_tokens, (SELECT count(*)::int FROM ai_settings) AS copies FROM ai_settings WHERE id = 1")).rows[0];
    });
    return { copied: copied!, teamId };
  }

  it("copies a team and a user that are both missing as NULL, and still copies the rest of the row", async () => {
    const { copied } = await copiedReferences({ team: "missing", user: "missing" });
    expect(copied).toEqual({ escalation_team_id: null, updated_by: null, max_tokens: 1111, copies: 1 });
  });

  it("keeps a team and a user that still exist", async () => {
    const { copied, teamId } = await copiedReferences({ team: "valid", user: "valid" });
    expect(copied).toEqual({ escalation_team_id: teamId, updated_by: REAL_USER_ID, max_tokens: 1111, copies: 1 });
  });

  it("nulls only the dangling one: a valid team with a missing user", async () => {
    const { copied, teamId } = await copiedReferences({ team: "valid", user: "missing" });
    expect(copied).toEqual({ escalation_team_id: teamId, updated_by: null, max_tokens: 1111, copies: 1 });
  });

  it("nulls only the dangling one: a missing team with a valid user", async () => {
    const { copied } = await copiedReferences({ team: "missing", user: "valid" });
    expect(copied).toEqual({ escalation_team_id: null, updated_by: REAL_USER_ID, max_tokens: 1111, copies: 1 });
  });
});

describe("migration 0023 (provider-neutral AI settings)", () => {
  it("copies active business settings once while preserving legacy credentials and usage", async () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP TABLE IF EXISTS ai_settings");
      await client.query("UPDATE bedrock_settings SET is_active = false");
      const legacy = await client.query(`
        INSERT INTO bedrock_settings (
          bedrock_access_key_id, bedrock_secret_access_key, bedrock_model_id,
          auto_response_enabled, confidence_threshold, max_response_length,
          response_timeout, auto_learn_enabled, min_resolution_score,
          article_approval_required, complexity_threshold, escalation_enabled,
          temperature, max_tokens, daily_limit_usd, monthly_limit_usd,
          max_tokens_per_request, max_requests_per_minute, is_active
        ) VALUES (
          'aws-access-keep', 'aws-secret-keep', 'amazon.titan-text-express-v1',
          false, 0.64, 721, 42, false, 0.91, false, 82, false,
          0.46, 1337, 12.34, 234.56, 1765, 11, true
        ) RETURNING id
      `);
      const usage = await client.query(`
        INSERT INTO ai_usage (model_id, input_tokens, output_tokens, estimated_cost, operation)
        VALUES ('amazon.titan-text-express-v1', 12, 34, 0.001234, 'test-legacy') RETURNING id
      `);

      await client.query(sql);
      const copied = await client.query("SELECT * FROM ai_settings WHERE id = 1");
      expect(copied.rows[0]).toMatchObject({
        model_id: "deepseek/deepseek-v4-pro",
        auto_response_enabled: false,
        confidence_threshold: "0.64",
        max_response_length: 721,
        response_timeout: 42,
        auto_learn_enabled: false,
        min_resolution_score: "0.91",
        article_approval_required: false,
        complexity_threshold: 82,
        escalation_enabled: false,
        temperature: "0.46",
        max_tokens: 1337,
        daily_limit_usd: "12.34",
        monthly_limit_usd: "234.56",
        max_tokens_per_request: 1765,
        max_requests_per_minute: 11,
        is_active: true,
      });
      const defaultId = await client.query("SELECT column_default FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'id'");
      expect(defaultId.rows[0].column_default).toBe("1");

      await client.query("UPDATE ai_settings SET model_id = 'openai/gpt-4o-mini' WHERE id = 1");
      await client.query(sql);
      const retained = await client.query("SELECT model_id, max_tokens FROM ai_settings WHERE id = 1");
      expect(retained.rows[0]).toEqual({ model_id: "openai/gpt-4o-mini", max_tokens: 1337 });

      const old = await client.query("SELECT bedrock_access_key_id, bedrock_secret_access_key, bedrock_model_id FROM bedrock_settings WHERE id = $1", [legacy.rows[0].id]);
      expect(old.rows[0]).toEqual({
        bedrock_access_key_id: "aws-access-keep",
        bedrock_secret_access_key: "aws-secret-keep",
        bedrock_model_id: "amazon.titan-text-express-v1",
      });
      const oldUsage = await client.query("SELECT model_id, estimated_cost, billing_status FROM ai_usage WHERE id = $1", [usage.rows[0].id]);
      expect(oldUsage.rows[0]).toEqual({ model_id: "amazon.titan-text-express-v1", estimated_cost: "0.001234", billing_status: "estimated" });

      const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_settings'");
      const names = columns.rows.map((row) => row.column_name);
      for (const secretColumn of ["bedrock_access_key_id", "bedrock_secret_access_key", "bedrock_model_id"]) {
        expect(names).not.toContain(secretColumn);
      }
      await client.query("UPDATE ai_usage SET requested_model_id = 'requested-model', generation_id = 'gen-123', verified_cost_usd = 0.000321, billing_status = 'verified' WHERE id = $1", [usage.rows[0].id]);
      const verifiedUsage = await client.query("SELECT requested_model_id, generation_id, verified_cost_usd, billing_status FROM ai_usage WHERE id = $1", [usage.rows[0].id]);
      expect(verifiedUsage.rows[0]).toEqual({ requested_model_id: "requested-model", generation_id: "gen-123", verified_cost_usd: "0.000321", billing_status: "verified" });
      await client.query("SAVEPOINT invalid_generation");
      await expect(client.query("INSERT INTO ai_usage (model_id, input_tokens, output_tokens, estimated_cost, operation, generation_id) VALUES ('x', 1, 1, 0, 'test', 'gen-123')"))
        .rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_generation");
      await client.query("SAVEPOINT invalid_billing");
      await expect(client.query("UPDATE ai_usage SET billing_status = 'unknown' WHERE id = $1", [usage.rows[0].id]))
        .rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_billing");
      await client.query("SAVEPOINT invalid_singleton");
      await expect(client.query("INSERT INTO ai_settings (id) VALUES (2)")).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_singleton");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("partially updates AI settings and mirrors only business fields to active legacy settings", async () => {
    await withStorageFixture(async (legacyId, userId) => {
      const first = await storage.updateAISettings({ modelId: "openai/gpt-4o-mini", maxTokens: 1234, dailyLimitUsd: "12.34" }, userId);
      expect(first).toMatchObject({ modelId: "openai/gpt-4o-mini", maxTokens: 1234, dailyLimitUsd: "12.34" });
      const second = await storage.updateAISettings({ modelId: "deepseek/deepseek-v4-pro" }, userId);
      expect(second).toMatchObject({ modelId: "deepseek/deepseek-v4-pro", maxTokens: 1234, dailyLimitUsd: "12.34" });
      expect(await storage.getAISettings()).toMatchObject({ modelId: "deepseek/deepseek-v4-pro", maxTokens: 1234 });
      const legacy = await pool.query("SELECT bedrock_access_key_id, bedrock_secret_access_key, bedrock_model_id, max_tokens, daily_limit_usd FROM bedrock_settings WHERE id = $1", [legacyId]);
      expect(legacy.rows[0]).toEqual({
        bedrock_access_key_id: "keep-access", bedrock_secret_access_key: "keep-secret",
        bedrock_model_id: "amazon.titan-text-express-v1", max_tokens: 1234, daily_limit_usd: "12.34",
      });
      await storage.updateAISettings({ isActive: false }, userId);
      const provider = await storage.getAISettings();
      expect(provider?.isActive).toBe(false);
      const legacyActivation = await pool.query("SELECT is_active FROM bedrock_settings WHERE id = $1", [legacyId]);
      expect(legacyActivation.rows[0].is_active).toBe(true);
    });
  });

  it("does not change inactive legacy settings or create a legacy row when none is active", async () => {
    await withStorageFixture(async (legacyId, userId) => {
      await pool.query("UPDATE bedrock_settings SET is_active = false WHERE id = $1", [legacyId]);
      const before = await pool.query("SELECT count(*)::int AS count FROM bedrock_settings");
      await storage.updateAISettings({ modelId: "openai/gpt-4o-mini", maxTokens: 999 }, userId);
      const legacy = await pool.query("SELECT max_tokens, bedrock_access_key_id, is_active FROM bedrock_settings WHERE id = $1", [legacyId]);
      expect(legacy.rows[0]).toEqual({ max_tokens: 2000, bedrock_access_key_id: "keep-access", is_active: false });
      const after = await pool.query("SELECT count(*)::int AS count FROM bedrock_settings");
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });
  });

  it("drizzle push makes no changes when SQL 0023 runs first on a pre-0023 schema", async () => {
    const testUrl = new URL(process.env.DATABASE_URL!);
    const scratchName = `${testUrl.pathname.slice(1)}_ai0023`;
    expect(scratchName).toMatch(/test/);
    const adminUrl = new URL(testUrl.toString());
    adminUrl.pathname = "/postgres";
    const scratchUrl = new URL(testUrl.toString());
    scratchUrl.pathname = `/${scratchName}`;
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    let scratch: pg.Pool | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${scratchName}"`);
      const env = { ...process.env, DATABASE_URL: scratchUrl.toString(), TEST_DATABASE_URL: scratchUrl.toString() };
      const pushed = spawnSync(process.execPath, [path.join(root, "scripts/test-db.mjs")], { cwd: root, env, encoding: "utf8", timeout: 120000 });
      expect({ status: pushed.status, output: pushed.stderr }).toEqual({ status: 0, output: "" });
      scratch = new pg.Pool({ connectionString: scratchUrl.toString() });
      await scratch.query("DROP TABLE ai_settings");
      await scratch.query("ALTER TABLE ai_usage DROP COLUMN requested_model_id, DROP COLUMN generation_id CASCADE, DROP COLUMN verified_cost_usd, DROP COLUMN billing_status CASCADE");
      await scratch.query(migrationSql());
      const result = spawnSync("npx", ["drizzle-kit", "push", "--verbose", "--force"], { cwd: root, env, shell: true, encoding: "utf8", timeout: 120000 });
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(0);
      expect(output).toContain("No changes detected");
      expect(output.split(/\r?\n/).filter((line) => /^(ALTER|CREATE|DROP)\b/.test(line.trim()))).toEqual([]);
    } finally {
      await scratch?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 240000);
});
