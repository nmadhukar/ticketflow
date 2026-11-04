import { createHmac, hkdfSync, timingSafeEqual } from "crypto";
import { isAssistantAgentId, type AssistantAgentId } from "@shared/assistant";

/**
 * Short-lived tokens that carry a signed-in user across the assistant's process boundaries.
 * Adapted from Workforce Nexus' reviewed portal-session token: HKDF-SHA256 key, HMAC-SHA256
 * signature, base64url(JSON claims) + "." + base64url(signature). Not a JWT.
 *
 * There are two hops, and each has its own secret and its own key label:
 *
 *   - "agent": app -> Mastra sidecar. Signed with ASSISTANT_AGENT_SECRET, which the sidecar also
 *     holds so it can verify. agents/src/mastra/session-token.ts verifies these.
 *   - "mcp":   sidecar -> the app's internal MCP endpoint. Signed with ASSISTANT_SESSION_SECRET,
 *     which never leaves the app: the app both mints and checks it, and the sidecar only forwards
 *     a token it was handed. A compromised sidecar therefore cannot mint one.
 *
 * The audience names the hop and the agent ("ticketflow-mcp:support-assistant"), so a token for one
 * hop or one agent is refused by every other. `jti` is the run id; the run registry (runAuth.ts)
 * ends it when the run ends. Never log a token.
 */

export const ASSISTANT_TOKEN_VERSION = 1;
export const ASSISTANT_TOKEN_ISSUER = "ticketflow-assistant";
export const ASSISTANT_TOKEN_TTL_SECONDS = 5 * 60;
/** How far in the future `iat` may be, for clock drift between containers. */
export const ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS = 30;

export type TokenHop = "agent" | "mcp";

const KEY_INFO: Record<TokenHop, string> = {
  agent: "ticketflow-assistant-agent-v1",
  mcp: "ticketflow-assistant-mcp-v1",
};

const AUDIENCE_PREFIX: Record<TokenHop, string> = {
  agent: "ticketflow-agent:",
  mcp: "ticketflow-mcp:",
};

/** users.id is a varchar; ids are UUIDs or short fixed names. Nothing else is accepted as `sub`. */
const SUBJECT_FORMAT = /^[A-Za-z0-9._:@-]{1,255}$/;
const RUN_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AssistantTokenClaims {
  v: typeof ASSISTANT_TOKEN_VERSION;
  sub: string;
  aud: string;
  iss: typeof ASSISTANT_TOKEN_ISSUER;
  iat: number;
  exp: number;
  jti: string;
}

export type TokenRefusal =
  | "malformed"
  | "bad_signature"
  | "bad_claims"
  | "wrong_audience"
  | "not_yet_valid"
  | "expired";

export type VerifiedToken =
  | { ok: true; claims: AssistantTokenClaims; agentId: AssistantAgentId }
  | { ok: false; reason: TokenRefusal };

export function tokenAudience(hop: TokenHop, agentId: AssistantAgentId): string {
  return `${AUDIENCE_PREFIX[hop]}${agentId}`;
}

/** Derived keys by hop and secret: every MCP call verifies a token, and the key never changes. */
const derivedKeys = new Map<string, Buffer>();

function signature(hop: TokenHop, payload: string, secret: string): Buffer {
  const cacheKey = `${hop}\0${secret}`;
  let key = derivedKeys.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "", KEY_INFO[hop], 32));
    derivedKeys.set(cacheKey, key);
  }
  return createHmac("sha256", key).update(payload).digest();
}

export function mintAssistantToken(
  hop: TokenHop,
  subject: { userId: string; agentId: AssistantAgentId; runId: string },
  secret: string,
  nowMs = Date.now(),
): string {
  if (!SUBJECT_FORMAT.test(subject.userId)) throw new Error("Assistant token: unsupported user id");
  if (!RUN_ID_FORMAT.test(subject.runId)) throw new Error("Assistant token: run id must be a lowercase UUID");
  const iat = Math.floor(nowMs / 1000);
  const claims: AssistantTokenClaims = {
    v: ASSISTANT_TOKEN_VERSION,
    sub: subject.userId,
    aud: tokenAudience(hop, subject.agentId),
    iss: ASSISTANT_TOKEN_ISSUER,
    iat,
    exp: iat + ASSISTANT_TOKEN_TTL_SECONDS,
    jti: subject.runId,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(hop, payload, secret).toString("base64url")}`;
}

/**
 * Checks a token for one hop against the current secret and then the previous one (rotation).
 * Returns the claims and the agent the audience names, or why it was refused. The caller still
 * has to reload the user and check that the agent is the one their role maps to.
 */
export function verifyAssistantToken(
  hop: TokenHop,
  token: string,
  secrets: readonly string[],
  nowMs = Date.now(),
): VerifiedToken {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payload, encodedSignature] = parts;

  const supplied = Buffer.from(encodedSignature, "base64url");
  const signed = secrets
    .filter((secret) => secret.length > 0)
    .some((secret) => {
      const expected = signature(hop, payload, secret);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    });
  if (!signed) return { ok: false, reason: "bad_signature" };

  let claims: Partial<AssistantTokenClaims>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    claims === null ||
    typeof claims !== "object" ||
    claims.v !== ASSISTANT_TOKEN_VERSION ||
    claims.iss !== ASSISTANT_TOKEN_ISSUER ||
    typeof claims.sub !== "string" ||
    !SUBJECT_FORMAT.test(claims.sub) ||
    typeof claims.jti !== "string" ||
    !RUN_ID_FORMAT.test(claims.jti) ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    // A token whose lifetime was stretched is refused even with a valid signature.
    claims.exp! - claims.iat! !== ASSISTANT_TOKEN_TTL_SECONDS
  ) {
    return { ok: false, reason: "bad_claims" };
  }

  const prefix = AUDIENCE_PREFIX[hop];
  const agentId = typeof claims.aud === "string" && claims.aud.startsWith(prefix) ? claims.aud.slice(prefix.length) : null;
  if (!isAssistantAgentId(agentId)) return { ok: false, reason: "wrong_audience" };

  const now = Math.floor(nowMs / 1000);
  if (claims.iat! > now + ASSISTANT_TOKEN_CLOCK_SKEW_SECONDS) return { ok: false, reason: "not_yet_valid" };
  if (claims.exp! <= now) return { ok: false, reason: "expired" };

  return { ok: true, claims: claims as AssistantTokenClaims, agentId };
}
