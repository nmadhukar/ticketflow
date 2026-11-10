import { eq } from "drizzle-orm";
import { departments, teams, type Task } from "@shared/schema";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { getAISettings } from "../../admin/aiSettings";
import { bedrockIntegration } from "./bedrockIntegration";
import { describeAIError } from "./aiErrors";
import { ensureAiSystemUser, isAiSystemUserId } from "../../utils/aiSystemUser";
import { defaultTriageAssignment } from "../tickets/triage";
import { afterTicketUpdated, recipientsNow } from "../tickets/notifier";

/**
 * 0031 content-based routing: the "no matching solution" half of the create-time agent.
 *
 * A new ticket whose auto-response analysis found no confident answer is classified onto the team
 * that owns its problem area, and the assignment is written with the AI system user as the actor
 * (so task history shows why the ticket moved). Everything here is opt-in and best-effort:
 *
 *  - It runs only when ai_settings.auto_routing_enabled is on (the default: the AI owning team
 *    assignment is part of the create-time agent), AI is active and OpenRouter is configured.
 *    An admin can still turn it off, which leaves every new ticket unassigned/in triage.
 *  - It never throws; a failure is logged by type (never the ticket text or model output) and the
 *    ticket is left as it was created.
 *  - A ticket a person already owns (a user assignee, or a team other than the catch-all triage
 *    queue) is never touched.
 *
 * The model is only ever allowed to name a team from the live list; an unknown id falls back to the
 * configured escalation team, then to the default triage team.
 *
 * A classification below ROUTING_MIN_CONFIDENCE is treated as no answer at all: a guess that weak
 * moved the ticket out of triage just as confidently as a good one, so it takes the fallback path
 * instead. And the assignment is written through the same update hooks as a person's change
 * (afterTicketUpdated), so the realtime broadcast, the Teams webhooks and the team the ticket
 * landed on all hear about it.
 */

export interface RoutingDecision {
  teamId: number;
  /** The chosen team's department, when the model named it; informational only. */
  departmentId: number | null;
  confidence: number;
  reason: string;
}

/**
 * The weakest classification that is allowed to move a ticket. Below this the model is guessing,
 * and a wrong queue is worse than the triage queue, so the fallback (escalation, then triage) wins.
 */
const ROUTING_MIN_CONFIDENCE = 0.5;

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

/** The name of the team the customer suggested on create, or null. */
function suggestedTeamName(task: Task, teamList: Array<{ id: number; name: string }>): string | null {
  const suggestedId = (task as { suggestedTeamId?: number | null }).suggestedTeamId;
  if (!suggestedId) return null;
  return teamList.find((team) => team.id === suggestedId)?.name ?? null;
}

/** True when the ticket is already assigned to something more specific than the triage queue. */
async function hasDeliberateAssignment(task: Task): Promise<boolean> {
  // A user owner is a person's decision. The AI account as assignee is not: it is how a ticket
  // raised inside the copilot arrives (the agent's own identity), and it must still be routed.
  if (task.assigneeId && !isAiSystemUserId(task.assigneeId)) return true;
  // An explicit team owner is someone's decision, so routing leaves it.
  if (task.assigneeType === "team" && task.assigneeTeamId) {
    const triage = await defaultTriageAssignment();
    // No triage team configured: a team assignee was therefore chosen by a person.
    if (triage === null) return true;
    // The catch-all triage queue is not a deliberate routing decision; anything else is.
    return triage.assigneeTeamId !== task.assigneeTeamId;
  }
  // Unassigned is nobody's decision: the AI owns the first assignment.
  return false;
}

/**
 * Classifies and assigns a new ticket, or returns null when routing is off or cannot be applied.
 * Never throws.
 */
export async function routeTicket(task: Task, actionBaseUrl: string | null = null): Promise<RoutingDecision | null> {
  try {
    const settings = await getAISettings();
    if (settings.autoRoutingEnabled === false || !settings.isActive || !process.env.OPENROUTER_API_KEY) return null;
    if (await hasDeliberateAssignment(task)) return null;

    const [teamList, departmentList] = await Promise.all([routableTeams(), routableDepartments()]);
    if (teamList.length === 0) return null;

    let decision: RoutingDecision | null = null;
    // A copilot ticket may carry the customer's own suggestion (suggestedTeamId). Routing still
    // decides; the suggestion is only shown to the model as a hint, never applied blindly.
    const suggested = suggestedTeamName(task, teamList);
    const routingInput: Task = suggested
      ? { ...task, description: `${task.description ?? ""}\n\nThe customer suggested this team: ${suggested}. Use it only if it fits.` }
      : task;
    try {
      const model = await bedrockIntegration.classifyTicketForRouting(
        routingInput,
        departmentList,
        teamList,
        task.createdBy ?? undefined
      );
      if (
        model.teamId !== null &&
        model.confidence >= ROUTING_MIN_CONFIDENCE &&
        teamList.some((team) => team.id === model.teamId)
      ) {
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

    // The model calls above take seconds, which is long enough for a person to pick the ticket up.
    // Re-read before writing, so a decision taken on the row as it was created cannot overwrite an
    // agent's assignment; a ticket that is no longer in the triage queue is left exactly as it is.
    const current = await storage.getTask(task.id);
    if (!current || await hasDeliberateAssignment(current)) return null;
    if (current.assigneeType === "team" && current.assigneeTeamId === decision.teamId) return decision;

    // The assignment is attributed to the AI account, and task_history.user_id is a foreign key to
    // users: without the real row the history insert fails and the assignment is rolled back.
    const actor = await ensureAiSystemUser();
    if (!actor) {
      console.error(`AI ticket routing for ticket ${task.id}: skipped (AI system user unavailable)`);
      return null;
    }
    const updates = { assigneeType: "team" as const, assigneeTeamId: decision.teamId, assigneeId: null };
    // A reassignment changes who can see the ticket: capture the audience BEFORE the write.
    const recipientsBefore = await recipientsNow(task.id);
    const updatedTask = await storage.updateTask(task.id, updates, actor);
    // The same side effects a person's reassignment produces (webhooks, realtime broadcast).
    await afterTicketUpdated({
      ticketId: task.id,
      before: current,
      updatedTask,
      updates,
      actorId: actor,
      recipientsBefore,
      reassigns: true,
      actionBaseUrl,
    });
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