import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the app's agent-hop assistant token (app -> this sidecar).
 *
 * The app mints it in server/assistant/sessionToken.ts. This package is its own Docker build
 * context and cannot import app code, so the format is repeated here and
 * server/__tests__/unit/assistant/sessionToken.contract.test.ts holds the two together: change
 * both or neither.
 *
 * The sidecar only ever VERIFIES agent-hop tokens. MCP-hop tokens are signed with a secret the
 * sidecar does not have; it forwards the one the app gave it without being able to read or mint one.
 */

export const AGENT_IDS = ['support-assistant', 'ticket-assistant'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const TOKEN_VERSION = 1;
export const TOKEN_ISSUER = 'ticketflow-assistant';
export const TOKEN_TTL_SECONDS = 5 * 60;
export const CLOCK_SKEW_SECONDS = 30;

const KEY_INFO = 'ticketflow-assistant-agent-v1';
const AUDIENCE_PREFIX = 'ticketflow-agent:';
const SUBJECT_FORMAT = /^[A-Za-z0-9._:@-]{1,255}$/;
const RUN_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AgentTokenClaims {
  v: typeof TOKEN_VERSION;
  sub: string;
  aud: string;
  iss: typeof TOKEN_ISSUER;
  iat: number;
  exp: number;
  jti: string;
}

export type AgentTokenRefusal =
  | 'malformed'
  | 'bad_signature'
  | 'bad_claims'
  | 'wrong_audience'
  | 'not_yet_valid'
  | 'expired';

export type VerifiedAgentToken =
  | { ok: true; claims: AgentTokenClaims; agentId: AgentId }
  | { ok: false; reason: AgentTokenRefusal };

function isAgentId(value: unknown): value is AgentId {
  return (AGENT_IDS as readonly unknown[]).includes(value);
}

/** Derived keys by secret: every request verifies a token, and the key never changes. */
const derivedKeys = new Map<string, Buffer>();

function signature(payload: string, secret: string): Buffer {
  let key = derivedKeys.get(secret);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', secret, '', KEY_INFO, 32));
    derivedKeys.set(secret, key);
  }
  return createHmac('sha256', key).update(payload).digest();
}

/** Current ASSISTANT_AGENT_SECRET first, then ASSISTANT_AGENT_SECRET_PREVIOUS during a rotation. */
export function verifyAgentToken(
  token: string,
  secrets: readonly string[],
  nowMs = Date.now(),
): VerifiedAgentToken {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payload, encodedSignature] = parts;

  const supplied = Buffer.from(encodedSignature, 'base64url');
  const signed = secrets
    .filter((secret) => secret.length > 0)
    .some((secret) => {
      const expected = signature(payload, secret);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    });
  if (!signed) return { ok: false, reason: 'bad_signature' };

  let claims: Partial<AgentTokenClaims>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    claims === null ||
    typeof claims !== 'object' ||
    claims.v !== TOKEN_VERSION ||
    claims.iss !== TOKEN_ISSUER ||
    typeof claims.sub !== 'string' ||
    !SUBJECT_FORMAT.test(claims.sub) ||
    typeof claims.jti !== 'string' ||
    !RUN_ID_FORMAT.test(claims.jti) ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp! - claims.iat! !== TOKEN_TTL_SECONDS
  ) {
    return { ok: false, reason: 'bad_claims' };
  }

  const agentId =
    typeof claims.aud === 'string' && claims.aud.startsWith(AUDIENCE_PREFIX)
      ? claims.aud.slice(AUDIENCE_PREFIX.length)
      : null;
  if (!isAgentId(agentId)) return { ok: false, reason: 'wrong_audience' };

  const now = Math.floor(nowMs / 1000);
  if (claims.iat! > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' };
  if (claims.exp! <= now) return { ok: false, reason: 'expired' };

  return { ok: true, claims: claims as AgentTokenClaims, agentId };
}
