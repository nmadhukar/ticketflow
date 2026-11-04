import { AuditUnavailableError, hashIp, logAssistantSecurityEvent, recordAssistantAudit, setAuditSink } from "../../../assistant/securityLog";

describe("assistant audit record", () => {
  let rows: unknown[];
  let restore: ReturnType<typeof setAuditSink>;
  const lines: string[] = [];
  const log = (line: string) => void lines.push(line);

  beforeEach(() => {
    rows = [];
    lines.length = 0;
    restore = setAuditSink(async (row) => void rows.push(row));
  });
  afterEach(() => {
    setAuditSink(restore);
  });

  it("writes a log line and a row, with the IP hashed and nothing else unexpected", async () => {
    await recordAssistantAudit(
      { event: "write_proposed", reason: "add_comment", userId: "u1", runId: "3f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01", agentId: "support-assistant", ticketId: 42, ip: "203.0.113.9" },
      { log },
    );
    expect(rows).toEqual([
      {
        eventType: "write_proposed",
        reason: "add_comment",
        actorUserId: "u1",
        agentId: "support-assistant",
        runId: "3f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01",
        proposalId: null,
        ticketId: 42,
        ipHash: hashIp("203.0.113.9"),
      },
    ]);
    expect(lines[0]).toMatch(/^SECURITY_AUDIT: /);
    expect(lines[0]).not.toContain("203.0.113.9");
  });

  it("stores only well-formed ids: a refused token's run id is dropped", async () => {
    await recordAssistantAudit({ event: "mcp_auth_refused", reason: "bad_signature", runId: "not-a-uuid'; drop", proposalId: "x" }, { log });
    expect(rows[0]).toMatchObject({ runId: null, proposalId: null });
  });

  it("hashes an IP the same way every time, keyed by the server secret", () => {
    expect(hashIp("10.0.0.1", { SESSION_SECRET: "a" })).toBe(hashIp("10.0.0.1", { SESSION_SECRET: "a" }));
    expect(hashIp("10.0.0.1", { SESSION_SECRET: "a" })).not.toBe(hashIp("10.0.0.1", { SESSION_SECRET: "b" }));
    expect(hashIp("10.0.0.1")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp(undefined)).toBeUndefined();
  });

  it("a required record throws when its row cannot be written; the plain form never throws", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    setAuditSink(async () => {
      throw new Error("db down");
    });
    await expect(recordAssistantAudit({ event: "write_confirmed", reason: "add_comment" }, { required: true, log })).rejects.toBeInstanceOf(AuditUnavailableError);
    expect(() => logAssistantSecurityEvent({ event: "run_refused", reason: "cross_origin" }, log)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
