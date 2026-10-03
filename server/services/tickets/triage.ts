import { eq } from "drizzle-orm";
import { teams } from "@shared/schema";
import { db } from "../../storage/db";

/**
 * Ruling R36: tickets that would otherwise be visible only to admins (emailed tickets, and
 * customer tickets with no user or team assignee) are queued to the team named by
 * DEFAULT_TRIAGE_TEAM_ID. Unset, blank or unusable means nothing changes.
 *
 * The id is validated once (at startup, `initDefaultTriageTeam`): a value that is not a
 * positive integer, or names no team, logs one line and is ignored for the life of the process.
 */

export interface TriageAssignment {
  assigneeType: "team";
  assigneeTeamId: number;
}

type State = { ready: false } | { ready: true; teamId: number | null };
let state: State = { ready: false };

/** Reads and validates the setting. Returns the usable team id, or null (setting unset or ignored). */
export async function initDefaultTriageTeam(
  env: NodeJS.ProcessEnv = process.env
): Promise<number | null> {
  const raw = (env.DEFAULT_TRIAGE_TEAM_ID ?? "").trim();
  if (raw === "") {
    state = { ready: true, teamId: null };
    return null;
  }
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  if (id <= 0) {
    console.error("DEFAULT_TRIAGE_TEAM_ID is not a positive integer; ignoring it (admin triage stays).");
    state = { ready: true, teamId: null };
    return null;
  }
  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, id)).limit(1);
  if (!team) {
    console.error(`DEFAULT_TRIAGE_TEAM_ID=${id} names no team; ignoring it (admin triage stays).`);
    state = { ready: true, teamId: null };
    return null;
  }
  state = { ready: true, teamId: id };
  return id;
}

/** The triage assignment to apply, or null. Initialises on first use if startup did not. */
export async function defaultTriageAssignment(): Promise<TriageAssignment | null> {
  if (!state.ready) await initDefaultTriageTeam();
  const teamId = state.ready ? state.teamId : null;
  return teamId === null ? null : { assigneeType: "team", assigneeTeamId: teamId };
}

/** Forget the cached verdict (tests that change the environment). */
export function resetDefaultTriageTeam(): void {
  state = { ready: false };
}
