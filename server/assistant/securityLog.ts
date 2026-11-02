/**
 * Assistant security events as one JSON log line each: refused tokens, refused runs, refused
 * tools. Codes and ids only; never a token, a message or ticket content.
 *
 * Stage 8 of the assistant plan adds the durable assistant_audit_events table; until then this is
 * the record, in the same SECURITY_AUDIT format as server/security/index.ts (which this does not
 * import: that module pulls in the whole validation stack).
 */
export interface AssistantSecurityEvent {
  event: "mcp_auth_refused" | "renew_refused" | "run_refused";
  reason: string;
  userId?: string;
  runId?: string;
  agentId?: string;
  ip?: string;
}

export function logAssistantSecurityEvent(entry: AssistantSecurityEvent, log: (line: string) => void = console.log): void {
  log(`SECURITY_AUDIT: ${JSON.stringify({ timestamp: new Date().toISOString(), type: "ASSISTANT_SECURITY_EVENT", ...entry })}`);
}
