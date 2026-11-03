import { pool } from "../../storage/db";

/**
 * A PostgreSQL restart closes every idle pooled connection. Without an "error" listener on the
 * pool that is an uncaught error and the app exits (seen when the Docker postgres service was
 * restarted). Here the server ends one idle connection, as a restart does to all of them.
 */
describe("database pool", () => {
  it("survives the server closing an idle connection, logs only its code, and the next query works", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Two connections at once, so the one that ends the other is a different connection.
      const idle = await pool.connect();
      const other = await pool.connect();
      const { rows } = await idle.query("SELECT pg_backend_pid() AS pid");
      idle.release(); // back in the pool, idle
      await other.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
      other.release();
      await new Promise((r) => setTimeout(r, 300));

      expect(errors).toHaveBeenCalledWith(expect.stringMatching(/idle pooled connection was lost \[57P01\]/));
      expect(String(errors.mock.calls[0][0])).not.toMatch(/terminating connection/);
      expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      errors.mockRestore();
    }
  });
});
