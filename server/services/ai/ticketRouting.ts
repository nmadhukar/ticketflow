import { eq } from "drizzle-orm";
import { departments, teams, type Task } from "@shared/schema";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { getAISettings } from "../../admin/aiSettings";
import { bedrockIntegration } from "./bedrockIntegration";
import { describeAIError } from "./aiErrors";
import { AI_SYSTEM_USER_ID, ensureAiSystemUser } from "../../utils/aiSystemUser";
import { defaultTriageAssignment } from "../tickets/triage";

/**
 * 0031 content-based routing: the "no matching solution" half of the create-time agent.
 *
 * A new ticket whose auto-response analysis found no confident answer is classified onto the team
 * that owns its problem area, and the assignment is written with the AI system user as the actor
 * (so task history shows why the ticket moved). Everything here is opt-in and best-effort:
 *
 *  - It runs only when ai_settings.auto_routing_enabled is on, AI is active and OpenRouter is
 *    configured. The default is off: reassigning a customer's ticket is a routing decision, so an
 *    admin turns it on deliberately.
 *  - It never throws; a failure is logged by type (never the ticket text or model output) and the
 *    ticket is left as it was created.
 *  - A ticket a person already owns (a user assignee, or a team other than the catch-all triage
 *    queue) is never touched.
 *
 * The model is only ever allowed to name a team from the live list; an unknown id falls back to the
 * configured escalation team, then to the default triage team.
 */

export interface RoutingDecision {
  teamId: number;
  /** The chosen team's department, when the model named it; informational only. */
  departmentId: number | null;
  confidence: number;
  reason: string;
}

/** The teams an AI may route to: a team in an active department. */
async function routableTeams() {
  return db
    .select({ id: teams.id, name: teams.name, departmentId: teams.departmentId })
    .from(teams)
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(eq(departments.isActive, true))
    .orderBy(teams.name);
}

async function routableDepartments() {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.isActive, true))
    .orderBy(departments.name);
}

/** True when the ticket is already assigned to something more specific than the triage queue. */
async function hasDeliberateAssignment(task: Task): Promise<boolean> {
  if (task.assigneeId) return true;
  if (task.assigneeType !== "team" || !task.assigneeTeamId) return false;
  const triage = await defaultTriageAssignment();
  // No triage team configured: a team assignee was chosen by a person, so leave it.
  if (triage === null) return true;
  // The catch-all triage queue is not a deliberate routing decision; anything else is.
  return triage.assigneeTeamId !== task.assigneeTeamId;
}

/**
 * Classifies and assigns a new ticket, or returns null when routing is off or cannot be applied.
 * Never throws.
 */
export async function routeTicket(task: Task): Promise<RoutingDecision | null> {
  try {
    const settings = await getAISettings();
    if (!settings.autoRoutingEnabled || !settings.isActive || !process.env.OPENROUTER_API_KEY) return null;
    if (await hasDeliberateAssignment(task)) return null;

    const [teamList, departmentList] = await Promise.all([routableTeams(), routableDepartments()]);
    if (teamList.length === 0) return null;

    let decision: RoutingDecision | null = null;
    try {
      const model = await bedrockIntegration.classifyTicketForRouting(
        task,
        departmentList,
        teamList,
        task.createdBy ?? undefined
      );
      if (model.teamId !== null && teamList.some((team) => team.id === model.teamId)) {
        decision = { teamId: model.teamId, departmentId: model.departmentId, confidence: model.confidence, reason: model.reason };
      }
    } catch (error) {
      // The model was unreachable, rate limited or answered unusable JSON: fall back below.
      console.warn(`AI ticket routing for ticket ${task.id}: no usable classification (${describeAIError(error)})`);
    }

    if (!decision) {
      decision = await fallbackDecision(teamList);
      if (!decision) return null;
    }

    if (task.assigneeType === "team" && task.assigneeTeamId === decision.teamId) return decision;

    const actor = (await ensureAiSystemUser()) ?? AI_SYSTEM_USER_ID;
    await storage.updateTask(
      task.id,
      { assigneeType: "team", assigneeTeamId: decision.teamId, assigneeId: null },
      actor
    );
    return decision;
  } catch (error) {
    console.error(`AI ticket routing for new ticket ${task.id} failed:`, describeAIError(error));
    return null;
  }
}

/** The configured escalation team when it is still routable, else the default triage team. */
async function fallbackDecision(
  teamList: Array<{ id: number; name: string; departmentId: number | null }>
): Promise<RoutingDecision | null> {
  const settings = await getAISettings();
  const escalationTeamId = settings.escalationTeamId;
  if (escalationTeamId && teamList.some((team) => team.id === escalationTeamId)) {
    return { teamId: escalationTeamId, departmentId: null, confidence: 0, reason: "escalation team fallback" };
  }
  const triage = await defaultTriageAssignment();
  if (triage && teamList.some((team) => team.id === triage.assigneeTeamId)) {
    return { teamId: triage.assigneeTeamId, departmentId: null, confidence: 0, reason: "default triage team fallback" };
  }
  return null;
}