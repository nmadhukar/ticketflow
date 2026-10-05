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

describe("migration 0023 (provider-neutral AI settings)", () => {
  afterAll(async () => {
    await pool.end();
  });

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
