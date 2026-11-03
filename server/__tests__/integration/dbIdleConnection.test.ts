import { pool } from "../../storage/db";

/**
 * A PostgreSQL restart closes every pooled connection, idle or in use. Without an "error" listener
 * that is an uncaught error and the app exits (seen when the Docker postgres service was
 * restarted). Here the server ends one connection, as a restart does to all of them. Were the
 * error uncaught, Jest would fail the test with it.
 */
const LOST = /pooled connection was lost/;

function spyOnErrors() {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  const lost = () => spy.mock.calls.map((call) => String(call[0])).filter((line) => LOST.test(line));
  // Waits for the log line, however long the server takes to deliver the termination.
  const until = async (count: number) => {
    const deadline = Date.now() + 10_000;
    while (lost().length < count && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    return lost();
  };
  return { spy, until };
}

async function terminate(pid: number) {
  // A connection of its own, so the one being ended is never the one ending it.
  const other = await pool.connect();
  try {
    await other.query("SELECT pg_terminate_backend($1)", [pid]);
  } finally {
    other.release();
  }
}

describe("database pool", () => {
  it("survives the server closing an idle connection, logs it once with its code only, and the next query works", async () => {
    const { spy, until } = spyOnErrors();
    try {
      const idle = await pool.connect();
      const { rows } = await idle.query("SELECT pg_backend_pid() AS pid");
      const other = await pool.connect(); // held, so terminate() cannot be handed the idle one
      idle.release();
      other.release();
      await terminate(rows[0].pid);

      const lines = await until(1);
      expect(lines).toEqual([expect.stringMatching(/\[57P01\]/)]);
      expect(lines[0]).not.toMatch(/terminating connection/);
      expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("survives the server closing a connection that is checked out between queries", async () => {
    const { spy, until } = spyOnErrors();
    try {
      const held = await pool.connect(); // as a transaction holds one while it awaits other work
      const { rows } = await held.query("SELECT pg_backend_pid() AS pid");
      await terminate(rows[0].pid);

      // A checked-out connection reports the server's 57P01, then (as its socket closes) a plain
      // Error: one line each, the same message, and never the error text.
      const lines = await until(1);
      expect(lines[0]).toMatch(/\[57P01\]/);
      for (const line of lines) expect(line).not.toMatch(/terminating connection/);
      // The lost connection fails its next query, and is thrown away rather than reused.
      await expect(held.query("SELECT 1")).rejects.toThrow();
      held.release(true);
      expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
