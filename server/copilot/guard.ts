/**
 * The copilot's code-level guardrails, applied to what a user SENDS.
 *
 * The proposal path already runs the content guard (server/assistant/contentGuard.ts) on what the
 * assistants write. This runs the same checks on the message a person types, before the copilot run
 * starts, so that:
 *
 *   1. a message that is only abuse, or that pastes a password/API key/card number, never reaches the
 *      model - the tokens an irrelevant run would spend are never spent; and
 *   2. the blocked attempt is recorded (SECURITY_AUDIT line + assistant_audit_events row) by CATEGORY
 *      only, never the matched text, so a manager can review it.
 *
 * It is deliberately narrow, because a false positive turns away a real customer: a rude complaint
 * that also describes a problem is allowed through, and only an explicit threat, a credential, or
 * abuse that is the whole message is refused. Mastra's OpenAI moderation processor (attached in
 * server/mastra/agents/ticket-agent.ts) is the second, model-backed layer.
 */
import type { Request, Response, NextFunction } from "express";
import { checkUserMessage, userMessageRefusal } from "../assistant/contentGuard";
import { logAssistantSecurityEvent } from "../assistant/securityLog";

/** The last message a client sends in a run, as CopilotKit/AG-UI posts it. */
interface AgentMessage {
  role?: string;
  content?: unknown;
  parts?: Array<{ type?: string; text?: string }>;
}

/** One message's text: `content` as a string, or the text parts of a content-parts array. */
export function messageText(message: AgentMessage | undefined | null): string {
  if (!message || typeof message !== "object") return "";
  if (typeof message.content === "string") return message.content;
  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? (message.content as Array<{ type?: string; text?: string }>)
      : [];
  return parts
    .filter((p) => p && (p.type === "text" || typeof p.text === "string") && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/** The newest user message in a run payload; empty when there is none (a tool-only step). */
export function lastUserMessage(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as AgentMessage;
    if (message?.role === "user") return messageText(message);
  }
  return "";
}

export interface GuardOutcome {
  allowed: boolean;
  /** Set when allowed is false: the HTTP status and body the client is shown. */
  status?: 422;
  body?: { error: string; message: string };
  /** The audit reason, a category only ("content_guard:contains a password"), never the text. */
  auditReason?: string;
}

/**
 * Decides on one run payload. Pure: no response, no logging, so the middleware and its tests share it.
 * `userText` comes from lastUserMessage (or any equivalent extraction).
 */
export function inspectUserMessage(userText: string): GuardOutcome {
  const verdict = checkUserMessage(userText);
  if (verdict.ok) return { allowed: true };
  const kind = verdict.kind === "secret" ? "secret" : "abuse";
  return {
    allowed: false,
    status: 422,
    body: { error: "content_blocked", message: userMessageRefusal(verdict) },
    auditReason: `content_guard:${kind}`,
  };
}

/**
 * The Express middleware. It reads the JSON body already parsed by bodyParser (the copilot middleware
 * is registered after it), refuses a blocked run with a 422 the client can show, and otherwise calls
 * next() untouched. Anything it cannot parse is let through: the runtime refuses malformed input
 * itself, and a guard must never break a working chat by guessing.
 */
export function createContentGuardMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST" || !/\/(run|connect)$/.test(req.path)) return next();
    const body = req.body as { messages?: unknown } | undefined;
    const text = lastUserMessage(body?.messages);
    if (!text) return next();

    const outcome = inspectUserMessage(text);
    if (outcome.allowed) return next();

    // Logged by category only: the matched text may be the credential or the abuse itself.
    const user = req.user as { id?: string; role?: string } | undefined;
    logAssistantSecurityEvent({
      event: "run_refused",
      reason: outcome.auditReason ?? "content_guard:blocked",
      userId: user?.id,
      ip: req.ip,
    });
    return res.status(outcome.status ?? 422).json(outcome.body);
  };
}
