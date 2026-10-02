// Jest setupFiles entry for the integration project. Runs before any module is
// imported, so server/storage/db.ts sees the test database.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://test:test@localhost:55433/ticketflow_test";
process.env.SESSION_SECRET = "integration-test-session-secret";
process.env.NODE_ENV = "test";
