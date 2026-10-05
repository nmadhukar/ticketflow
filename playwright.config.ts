import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets parallel checkouts run side by side; 5055 is the default.
const PORT = Number(process.env.E2E_PORT ?? 5055);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error(`E2E_PORT must be an integer from 1024 to 65535 (got "${process.env.E2E_PORT}").`);
}
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
  "E2E_MANAGER_PASSWORD",
  "E2E_ADMIN_PASSWORD",
]) {
  process.env[name] ??= secret();
}

// Outbound-call guard: the app server preloads e2e/no-egress.cjs, which refuses
// every non-loopback connection and records it in this file; global-teardown
// fails the run if the file has anything in it. Generated once per run and
// inherited by the workers, like the secrets above.
process.env.E2E_EGRESS_LOG ??= `${tmpdir()}/ticketflow-e2e-egress-${randomBytes(6).toString("hex")}.log`.replace(/\\/g, "/");
const NO_EGRESS = resolve("e2e/no-egress.cjs").replace(/\\/g, "/");

// Cloud and mail credentials the server reads from the environment (dotenv fills
// only MISSING keys, so an empty string beats a developer's .env or shell).
const BLANKED_ENV = Object.fromEntries(
  [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_S3_BUCKET_NAME",
    "MAILTRAP_TOKEN",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_REDIRECT_URL",
    "MICROSOFT_TENANT_ID",
    "SNS_INBOUND_TOPIC_ARN",
    "BEDROCK_ACCESS_KEY_ID",
    "BEDROCK_SECRET_ACCESS_KEY",
    "OPENROUTER_API_KEY",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
    "SES_ACCESS_KEY_ID",
    "SES_SECRET_ACCESS_KEY",
    "TEAMS_WEBHOOK_URL",
  ].map((name) => [name, ""])
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // The flows share one database and one ticket per spec file; run them in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Chromium refuses some ports outright (ERR_UNSAFE_PORT: 5060 and 5061 are SIP);
        // allow the one this run uses so E2E_PORT can be any free port.
        launchOptions: { args: [`--explicitly-allowed-ports=${PORT}`] },
      },
    },
  ],
  webServer: {
    // The BUILT app, in production mode, so the strict CSP is what loads.
    // The no-egress guard is preloaded into the app process ONLY (not via NODE_OPTIONS, which would
    // also reach npm and the build, and npm's update check would trip it).
    command: `npm run build && node --require "${NO_EGRESS}" dist/index.js`,
    url: `${BASE_URL}/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      ...BLANKED_ENV,
      npm_config_update_notifier: "false",
      E2E_EGRESS_LOG: process.env.E2E_EGRESS_LOG!,
      NODE_ENV: "production",
      // Production refuses to boot without it (Ruling R34): links are built from it.
      APP_BASE_URL: BASE_URL,
      PORT: String(PORT),
      DATABASE_URL,
      SESSION_SECRET: process.env.E2E_SESSION_SECRET!,
      JWT_SECRET: process.env.E2E_JWT_SECRET!,
      RATE_LIMITING_ENABLED: "false",
      COOKIE_SECURE: "false",
    },
  },
});
