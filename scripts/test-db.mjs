// Applies shared/schema.ts to the integration test database.
// Plain node because Windows npm scripts cannot set env vars inline.
import { spawnSync } from "node:child_process";

// Keep this literal equal to the one in
// server/__tests__/integration/helpers/env.ts (a unit test checks they match).
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://test:test@localhost:55433/ticketflow_test";

const result = spawnSync("npx", ["drizzle-kit", "push", "--force"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
});

process.exit(result.status ?? 1);
