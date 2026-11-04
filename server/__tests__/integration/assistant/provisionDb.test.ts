import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import pg from "pg";

/**
 * scripts/db/provision-assistant-db.mjs against the test database: idempotent, and the role it
 * creates owns `mastra` and can read no TicketFlow table.
 */
const run = promisify(execFile);
const SCRIPT = join(__dirname, "../../../../scripts/db/provision-assistant-db.mjs");
const ROLE = "tf_test_mastra";
const PASSWORD = "Provision-test-password-0123456789";

const env = (over: Record<string, string> = {}) => ({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL!,
  MASTRA_DB_USER: ROLE,
  MASTRA_DB_PASSWORD: PASSWORD,
  ...over,
});

function asRole() {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = ROLE;
  url.password = PASSWORD;
  return new pg.Client({ connectionString: url.toString() });
}

describe("assistant database provisioning", () => {
  it("creates the role and schema, and a second run changes nothing", async () => {
    for (let i = 0; i < 2; i++) {
      const { stdout } = await run(process.execPath, [SCRIPT], { env: env() });
      expect(stdout).toMatch(new RegExp(`role ${ROLE} and schema mastra are in place`));
      expect(stdout).toMatch(/verified/);
      expect(stdout).not.toContain(PASSWORD);
    }
  });

  it("the role owns mastra, and cannot read TicketFlow's tables", async () => {
    const client = asRole();
    await client.connect();
    try {
      await expect(client.query("SELECT count(*) FROM public.users")).rejects.toThrow(/permission denied/);
      await client.query("CREATE TABLE IF NOT EXISTS mastra.provision_probe (id int)");
      await client.query("DROP TABLE mastra.provision_probe");
      const { rows } = await client.query("SELECT current_setting('search_path') AS path");
      expect(rows[0].path).toBe("mastra");
    } finally {
      await client.end();
    }
  });

  it("refuses a weak password or a bad role name, and prints neither secret nor SQL", async () => {
    await expect(run(process.execPath, [SCRIPT], { env: env({ MASTRA_DB_PASSWORD: "short" }) })).rejects.toMatchObject({
      stderr: expect.stringMatching(/at least 24 characters/),
    });
    for (const bad of ["Has@AtSign-0123456789abcdefgh", "Has#Hash-0123456789abcdefghi", "Has/Slash-0123456789abcdefg", "Has:Colon-0123456789abcdefg"]) {
      await expect(run(process.execPath, [SCRIPT], { env: env({ MASTRA_DB_PASSWORD: bad }) })).rejects.toMatchObject({
        stderr: expect.stringMatching(/only letters, digits/),
      });
    }
    await expect(run(process.execPath, [SCRIPT], { env: env({ MASTRA_DB_USER: "x; drop role y" }) })).rejects.toMatchObject({
      stderr: expect.stringMatching(/lowercase identifier/),
    });
  });
});
