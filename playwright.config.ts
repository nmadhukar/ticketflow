import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = 5055;
const BASE_URL = `http://localhost:${PORT}`;

// The e2e database is whatever TEST_DATABASE_URL names. Refuse anything that is
// not obviously a test database: globalSetup writes users into it.
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
if (!/test/i.test(new URL(DATABASE_URL || "postgres://x/x").pathname)) {
  throw new Error("Set TEST_DATABASE_URL to a database whose name contains \"test\" (e.g. ticketflow_test_e2e).");
}

// Secrets and passwords are generated once per run, here, in the runner process.
// The webServer, globalSetup and the test workers all inherit them from the
// environment, so nothing is committed and nothing is printed.
const secret = () => randomBytes(24).toString("hex");
for (const name of [
  "E2E_SESSION_SECRET",
  "E2E_JWT_SECRET",
  "E2E_CUSTOMER_A_PASSWORD",
  "E2E_CUSTOMER_B_PASSWORD",
  "E2E_AGENT_PASSWORD",
  "E2E_ADMIN_PASSWORD",
]) {
  process.env[name] ??= secret();
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  // The flows share one database and one ticket per spec file; run them in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The BUILT app, in production mode, so the strict CSP is what loads.
    command: "npm run build && npm start",
    url: `${BASE_URL}/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      DATABASE_URL,
      SESSION_SECRET: process.env.E2E_SESSION_SECRET!,
      JWT_SECRET: process.env.E2E_JWT_SECRET!,
      RATE_LIMITING_ENABLED: "false",
      COOKIE_SECURE: "false",
    },
  },
});
