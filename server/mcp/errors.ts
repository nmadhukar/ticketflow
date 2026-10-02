import { TicketError } from "../services/tickets/ticketError";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** A successful tool result: the service value as JSON text. */
export function toolOk(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * A failed tool result. A TicketError carries `{code, message, details?}`, all of
 * which are written for the caller. Anything else is unexpected: it is logged by
 * type only (error text can carry SQL, hostnames or request data) and the caller
 * gets a generic message. Never a stack.
 */
export function toolError(e: unknown): ToolResult {
  if (e instanceof TicketError) {
    const body: { code: string; message: string; details?: unknown } = { code: e.code, message: e.message };
    if (e.details !== undefined) body.details = e.details;
    return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
  }
  console.error(`MCP tool failed: ${e instanceof Error ? e.name : "error"}`);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code: "INTERNAL", message: "The request could not be completed" }) }],
  };
}

/** Runs one tool body, turning any failure into an isError result. */
export async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return toolOk(await fn());
  } catch (e) {
    return toolError(e);
  }
}
