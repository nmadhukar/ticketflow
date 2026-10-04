import { spawnSync } from "child_process";
import { readdirSync } from "fs";
import path from "path";
import pg from "pg";
import { pool } from "../../storage/db";
import {
  assertSchemaReady,
  findMissingSchemaObjects,
  REQUIRED_INDEXES,
  REQUIRED_TABLES,
} from "../../startup/schemaCheck";

/**
 * Ruling R32: deploys apply migrations/0007+ (scripts/apply-sql-migrations.mjs)
 * before drizzle-kit push, and the server refuses to boot when a required schema
 * object is missing. Runs against a scratch database next to the test database
 * (same name plus "_schemasafety"), built here and dropped afterwards.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");
const testUrl = new URL(process.env.DATABASE_URL!);
const scratchName = `${testUrl.pathname.slice(1)}_schemasafety`;
const scratchUrl = (() => {
  const u = new URL(testUrl.toString());
  u.pathname = `/${scratchName}`;
  return u.toString();
})();
const adminUrl = (() => {
  const u = new URL(testUrl.toString());
  u.pathname = "/postgres";
  return u.toString();
})();

async function admin(sql: string) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

// Mirrors scripts/apply-sql-migrations.mjs (FIRST_VERSION and NOT_RUN). If that script gains a
// NOT_RUN entry, add its file name here too.
const NOT_RUN = ["0008_migrate_ai_settings_to_db.sql"];
function runnableMigrations(): string[] {
  const files = readdirSync(path.join(ROOT, "migrations"))
    .filter((f) => /^\d{4}_[A-Za-z0-9_]+\.sql$/.test(f) && Number(f.slice(0, 4)) >= 7 && !NOT_RUN.includes(f))
    .sort();
  expect(files.length).toBeGreaterThanOrEqual(10);
  return files;
}

function applyMigrations(): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "apply-sql-migrations.mjs")], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: scratchUrl },
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function pushSchema() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "test-db.mjs")], {
    cwd: ROOT,
    env: { ...process.env, TEST_DATABASE_URL: scratchUrl },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`drizzle-kit push failed for the scratch database: ${r.stdout}${r.stderr}`);
}

describe("schema safety on deploy (R32)", () => {
  let scratch: pg.Pool;

  beforeAll(async () => {
    expect(scratchName).toMatch(/test/);
    await admin(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${scratchName}"`);
    scratch = new pg.Pool({ connectionString: scratchUrl });
  }, 60000);

  afterAll(async () => {
    await scratch?.end();
    await admin(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await pool.end();
  }, 60000);

  it("the test database (pushed from shared/schema.ts) has every required object", async () => {
    expect(await findMissingSchemaObjects(pool)).toEqual([]);
  });

  it("a brand-new database is left to push: the migration script applies nothing and succeeds", async () => {
    const run = applyMigrations();
    expect(run.status).toBe(0);
    expect(run.out).toContain("fresh database");
    expect(run.out).not.toContain("applied 00");
    // And the server would refuse to boot on it, naming every required table.
    expect(await findMissingSchemaObjects(scratch)).toEqual(
      expect.arrayContaining(REQUIRED_TABLES.map((t) => t.table))
    );
  });

  it(
    "after push, every 0007+ file but 0008 applies, twice, and legacy rows are fixed once",
    async () => {
      pushSchema();
      // Legacy rows the data parts of 0011/0012/0014 exist for.
      await scratch.query(
        `INSERT INTO users (id, email, role, is_active, is_approved) VALUES ('legacy-1', 'legacy@example.test', 'user', true, true)`
      );
      await scratch.query(
        `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, is_active)
         VALUES ('legacy-1', 'old', 'tfk_plaintext', 'tfk_pla', true), ('legacy-1', 'old2', 'tfk_plaintext', 'tfk_pla', true)`
      );
      await scratch.query(
        `INSERT INTO tasks (ticket_number, title, category, created_by) VALUES ('TKT-2025-0041', 't', 'support', 'legacy-1')`
      );

      for (const attempt of [1, 2]) {
        const run = applyMigrations();
        expect({ attempt, status: run.status }).toEqual({ attempt, status: 0 });
        // Derived from migrations/, so a new 0021+ file is applied twice here without editing this list.
        for (const f of runnableMigrations()) {
          expect(run.out).toContain(`applied ${f}`);
        }
        for (const f of NOT_RUN) expect(run.out).toContain(`not run ${f}`);
      }

      const role = await scratch.query(`SELECT role FROM users WHERE id = 'legacy-1'`);
      expect(role.rows[0].role).toBe("agent");
      const keys = await scratch.query(`SELECT is_active FROM api_keys ORDER BY id`);
      expect(keys.rows.map((r) => r.is_active)).toEqual([false, false]);
      const counter = await scratch.query(`SELECT last_number FROM ticket_number_counters WHERE prefix = 'TKT' AND year = 2025`);
      expect(counter.rows[0].last_number).toBe(41);
      expect(await findMissingSchemaObjects(scratch)).toEqual([]);
    },
    180000
  );

  it(
    "R50: drizzle-kit push is idempotent after the SQL migrations: every push reports no changes and issues no SQL",
    () => {
      // Independent of test order: build the state a deploy leaves (push, then the SQL files) here.
      // On the database an earlier test already built, both steps change nothing; on a scratch
      // database that is still empty (this test run alone with -t) they create it. Without this
      // the first push below would create every table and fail the "no statements" assertion.
      pushSchema();
      expect(applyMigrations().status).toBe(0);
      for (const attempt of [1, 2]) {
        const r = spawnSync("npx", ["drizzle-kit", "push", "--verbose", "--force"], {
          cwd: ROOT,
          shell: true,
          env: { ...process.env, DATABASE_URL: scratchUrl },
          encoding: "utf8",
          timeout: 120000,
        });
        const out = `${r.stdout}${r.stderr}`;
        expect({ attempt, status: r.status }).toEqual({ attempt, status: 0 });
        // A push that has work to do prints the statements it runs; one that has none says so.
        const statements = out.split(/\r?\n/).filter((l) => /^(ALTER|CREATE|DROP)\b/.test(l.trim()));
        expect({ attempt, statements }).toEqual({ attempt, statements: [] });
        expect(out).toContain("No changes detected");
      }
    },
    240000
  );

  it(
    "0020: a legacy NULL is_active becomes false (never true), the column turns NOT NULL, and a second run changes nothing",
    async () => {
      // A database from before the constraint: the column is nullable and holds a NULL.
      await scratch.query(`ALTER TABLE users ALTER COLUMN is_active DROP NOT NULL`);
      await scratch.query(
        `INSERT INTO users (id, email, role, is_active, is_approved) VALUES ('null-active', 'null-active@example.test', 'agent', NULL, true)`
      );
      for (const attempt of [1, 2]) {
        const run = applyMigrations();
        expect({ attempt, status: run.status }).toEqual({ attempt, status: 0 });
        expect(run.out).toContain("applied 0020_users_is_active_not_null.sql");
        const rows = await scratch.query(`SELECT id, is_active FROM users WHERE id IN ('null-active', 'legacy-1') ORDER BY id`);
        // The NULL row keeps today's behaviour (inactive); the active row stays active.
        expect(rows.rows).toEqual([
          { id: "legacy-1", is_active: true },
          { id: "null-active", is_active: false },
        ]);
        const col = await scratch.query(
          `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_active'`
        );
        expect(col.rows[0].is_nullable).toBe("NO");
        expect(col.rows[0].column_default).toBe("true");
      }
      await expect(
        scratch.query(`INSERT INTO users (id, email, role, is_active) VALUES ('null-again', 'again@example.test', 'agent', NULL)`)
      ).rejects.toMatchObject({ code: "23502" });
      await scratch.query(`DELETE FROM users WHERE id = 'null-active'`);
    },
    180000
  );

  it("a failing file is rolled back, named, and stops the run with a non-zero exit", async () => {
    // Without its index, two equal hashes make 0014's CREATE UNIQUE INDEX fail (23505).
    await scratch.query(`DROP INDEX ${REQUIRED_INDEXES[0].index}`);
    await scratch.query(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, is_active)
       VALUES ('legacy-1', 'dup1', 'sha256:dup', 'tfk_dup', true), ('legacy-1', 'dup2', 'sha256:dup', 'tfk_dup', true)`
    );
    try {
      const run = applyMigrations();
      expect(run.status).toBe(1);
      expect(run.out).toContain("applied 0013_ai_system_user.sql");
      expect(run.out).toContain("0014_api_keys_hashed.sql failed and was rolled back [23505]");
      expect(run.out).not.toContain("applied 0018");
      expect(run.out).not.toContain("test:test@");
      expect(await findMissingSchemaObjects(scratch)).toEqual(["index api_keys_key_hash_sha256_uniq"]);
    } finally {
      await scratch.query(`DELETE FROM api_keys WHERE key_hash = 'sha256:dup'`);
      expect(applyMigrations().status).toBe(0);
    }
  });

  describe("the startup assertion", () => {
    it("refuses to boot with one line naming every missing object, and exit code 1", async () => {
      await scratch.query(`ALTER TABLE users DROP COLUMN locked_until`);
      await scratch.query(`ALTER TABLE sns_message_dedupe DROP COLUMN status`);
      await scratch.query(`DROP INDEX ${REQUIRED_INDEXES[0].index}`);
      await scratch.query(`DROP TABLE ticket_number_counters`);

      expect(await findMissingSchemaObjects(scratch)).toEqual([
        "users.locked_until",
        "ticket_number_counters",
        "sns_message_dedupe.status",
        "index api_keys_key_hash_sha256_uniq",
      ]);

      const lines: string[] = [];
      const exit = jest.fn();
      const ok = await assertSchemaReady({ db: scratch, log: (l) => lines.push(l), exit });
      expect(ok).toBe(false);
      expect(exit).toHaveBeenCalledWith(1);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^Startup refused: the database schema is missing /);
      for (const name of ["users.locked_until", "ticket_number_counters", "sns_message_dedupe.status", "api_keys_key_hash_sha256_uniq"]) {
        expect(lines[0]).toContain(name);
      }
    });

    it("the migration script puts every missing object back, and then boot is allowed", async () => {
      const run = applyMigrations();
      expect(run.status).toBe(0);
      const exit = jest.fn();
      expect(await assertSchemaReady({ db: scratch, log: () => undefined, exit })).toBe(true);
      expect(exit).not.toHaveBeenCalled();
    });

    it("a catalog that cannot be read also refuses, by error type only", async () => {
      const lines: string[] = [];
      const exit = jest.fn();
      const broken = {
        query: async () => {
          throw Object.assign(new Error("password authentication failed for user secret-user"), { code: "28P01" });
        },
      };
      expect(await assertSchemaReady({ db: broken, log: (l) => lines.push(l), exit })).toBe(false);
      expect(exit).toHaveBeenCalledWith(1);
      expect(lines).toEqual(["Startup refused: the database schema could not be checked [Error 28P01]."]);
    });
  });
});
