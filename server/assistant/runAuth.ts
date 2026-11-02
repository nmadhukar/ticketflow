import { randomUUID } from "crypto";
import { agentForRole, type AssistantAgentId } from "@shared/assistant";
import { normalizeRole, type Role } from "../permissions/roles";
import {
  ASSISTANT_TOKEN_TTL_SECONDS,
  mintAssistantToken,
  verifyAssistantToken,
  type TokenRefusal,
} from "./sessionToken";

/**
 * Assistant runs and the checks behind the MCP hop.
 *
 * A run starts when the app accepts a signed-in user's chat request. The app mints two tokens for
 * it (sessionToken.ts): one the sidecar verifies, one the sidecar forwards on every MCP call. This
 * module is what the app applies to that forwarded token, every time:
 *
 *   - the run is still open (ended runs are refused even before their token expires),
 *   - the user is reloaded and still allowed in (active, approved, not a system account, no
 *     forced password change, no password change since the token was issued),
 *   - the user's CURRENT role still maps to the agent the token names, so a role change or a
 *     customer token on the staff agent is refused at the next call.
 *
 * Renewal keeps a long run going: the token may be exchanged once, in its last two minutes, for
 * a fresh one with the same run id, while the run is within its maximum length.
 *
 * Runs are held in memory: one app replica. Every refusal carries a reason code for the audit log.
 */

/** A token may be renewed only in this many final seconds of its life, and only once. */
export const RENEW_WINDOW_SECONDS = 120;

export type RunRefusal =
  | TokenRefusal
  | "run_not_open"
  | "run_mismatch"
  | "run_too_long"
  | "renew_too_early"
  | "already_renewed"
  | "user_not_found"
  | "user_blocked"
  | "password_changed"
  | "password_change_required"
  | "role_not_allowed";

interface OpenRun {
  userId: string;
  agentId: AssistantAgentId;
  openedAtMs: number;
  /** `iat` of the newest MCP token issued for this run: only that one may be renewed. */
  latestIat: number;
}

/** The columns these checks read. The users row (User) has all of them. */
export interface RunUser {
  id: string;
  role: string;
  email?: string | null;
  isActive?: boolean | null;
  isApproved?: boolean | null;
  passwordChangedAt?: Date | string | null;
  mustChangePassword?: boolean | null;
}

export interface RunAuthDeps<U extends RunUser> {
  /** Current then previous ASSISTANT_SESSION_SECRET (MCP hop). */
  sessionSecrets: readonly string[];
  /** Current ASSISTANT_AGENT_SECRET (agent hop); only minted here. */
  agentSecret: string;
  runMaxSeconds: number;
  loadUser: (id: string) => Promise<U | undefined>;
  /** keyOwnerBlockReason (services/auth/apiKeys.ts) in production. */
  blockReason: (user: U) => string | null;
  now?: () => number;
}

export type RunAuthResult<U extends RunUser = RunUser> =
  | {
      ok: true;
      user: U & { role: Role };
      agentId: AssistantAgentId;
      runId: string;
      /** `iat` of the token presented. */
      issuedAt: number;
    }
  | { ok: false; reason: RunRefusal; runId?: string; userId?: string };

export class AssistantRuns<U extends RunUser = RunUser> {
  private readonly runs = new Map<string, OpenRun>();

  constructor(private readonly deps: RunAuthDeps<U>) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /**
   * Opens a run for a user the caller has already authenticated (session) and mapped to an agent.
   * Returns both tokens; the run stays open until `end` or its maximum length.
   */
  start(userId: string, agentId: AssistantAgentId): { runId: string; agentToken: string; mcpToken: string } {
    this.prune();
    const runId = randomUUID();
    const nowMs = this.now();
    const subject = { userId, agentId, runId };
    const mcpToken = mintAssistantToken("mcp", subject, this.deps.sessionSecrets[0], nowMs);
    this.runs.set(runId, { userId, agentId, openedAtMs: nowMs, latestIat: Math.floor(nowMs / 1000) });
    return { runId, agentToken: mintAssistantToken("agent", subject, this.deps.agentSecret, nowMs), mcpToken };
  }

  /** Ends a run (finished, stopped or failed). Its tokens are refused from now on. */
  end(runId: string): void {
    this.runs.delete(runId);
  }

  isOpen(runId: string): boolean {
    const run = this.runs.get(runId);
    return !!run && !this.tooLong(run);
  }

  /** The check behind every MCP call that carries an assistant token. */
  async authenticate(token: string): Promise<RunAuthResult<U>> {
    const verified = verifyAssistantToken("mcp", token, this.deps.sessionSecrets, this.now());
    if (!verified.ok) return { ok: false, reason: verified.reason };
    const { claims, agentId } = verified;
    const ids = { runId: claims.jti, userId: claims.sub };

    const run = this.runs.get(claims.jti);
    if (!run) return { ok: false, reason: "run_not_open", ...ids };
    if (run.userId !== claims.sub || run.agentId !== agentId) return { ok: false, reason: "run_mismatch", ...ids };
    if (this.tooLong(run)) {
      this.runs.delete(claims.jti);
      return { ok: false, reason: "run_too_long", ...ids };
    }

    const user = await this.deps.loadUser(claims.sub);
    // The run may have ended while the user was loading: an ended run is refused, never approved.
    if (this.runs.get(claims.jti) !== run) return { ok: false, reason: "run_not_open", ...ids };
    if (!user) return { ok: false, reason: "user_not_found", ...ids };
    if (this.deps.blockReason(user)) return { ok: false, reason: "user_blocked", ...ids };
    if (user.mustChangePassword) return { ok: false, reason: "password_change_required", ...ids };
    // Same rule as a bearer JWT: a token issued before the last password change dies with it.
    if (user.passwordChangedAt) {
      const changedAt = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if (claims.iat < changedAt) return { ok: false, reason: "password_changed", ...ids };
    }
    const role = normalizeRole(user.role);
    if (!role || agentForRole(role) !== agentId) return { ok: false, reason: "role_not_allowed", ...ids };

    return { ok: true, user: { ...user, role }, agentId, runId: claims.jti, issuedAt: claims.iat };
  }

  /**
   * Exchanges an MCP token near its expiry for a new one with the same run id. Applies every check
   * `authenticate` does, so a user deactivated or demoted mid-run cannot renew.
   */
  async renew(token: string): Promise<RunAuthResult<U> & { mcpToken?: string }> {
    const result = await this.authenticate(token);
    if (!result.ok) return result;
    const ids = { runId: result.runId, userId: result.user.id };
    // From here to the update of latestIat nothing awaits, so two renewals of one token cannot both pass.
    const run = this.runs.get(result.runId);
    if (!run) return { ok: false, reason: "run_not_open", ...ids };
    const iat = result.issuedAt;

    if (iat !== run.latestIat) return { ok: false, reason: "already_renewed", ...ids };
    const nowSeconds = Math.floor(this.now() / 1000);
    if (nowSeconds < iat + ASSISTANT_TOKEN_TTL_SECONDS - RENEW_WINDOW_SECONDS) {
      return { ok: false, reason: "renew_too_early", ...ids };
    }

    const nowMs = this.now();
    const mcpToken = mintAssistantToken(
      "mcp",
      { userId: result.user.id, agentId: result.agentId, runId: result.runId },
      this.deps.sessionSecrets[0],
      nowMs,
    );
    run.latestIat = Math.floor(nowMs / 1000);
    return { ...result, mcpToken };
  }

  private tooLong(run: OpenRun): boolean {
    return this.now() - run.openedAtMs > this.deps.runMaxSeconds * 1000;
  }

  /** Drops runs past their maximum length, so a run never ended (a crashed stream) cannot pile up. */
  private prune(): void {
    for (const [runId, run] of Array.from(this.runs)) {
      if (this.tooLong(run)) this.runs.delete(runId);
    }
  }
}
