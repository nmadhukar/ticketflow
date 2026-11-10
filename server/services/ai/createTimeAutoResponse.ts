import type { Task } from "@shared/schema";
import { storage } from "../../storage";
import { getAISettings } from "../../admin/aiSettings";
import { describeAIError } from "./aiErrors";
import { autoResponseCommentBody } from "./autoResponseComment";
import { routeTicket } from "./ticketRouting";
import { statusForConfidence } from "./aiAutoResponse";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { afterTicketUpdated, recipientsNow } from "../tickets/notifier";

/**
 * Runs after a ticket exists. Never throws: a failure here must not fail the
 * create, so every error is logged (ticket id, error type and status only) and swallowed.
 *
 * Settings are read now, not at boot, so an admin toggle applies to the next
 * ticket. With auto-response off, or OpenRouter not configured, no model call is made.
 *
 * There is ONE auto-response decision: aiAutoResponseService.analyzeTicket returns
 * `shouldAutoRespond` (calculateConfidence, from the admin's enabled flag and
 * threshold) and stores the single auto-response row with wasApplied set from it.
 * This function only acts on that answer: it posts the comment, authored by the AI
 * system user and cut to maxResponseLength, and if the comment cannot be written it
 * sets the row back to not applied so the row and the comment agree.
 *
 * The 0031 routing step (ticketRouting.routeTicket) then sees the ticket whatever the answer:
 * it classifies the ticket onto the team that owns its problem area and assigns it when nobody
 * owns it yet, and it confirms or corrects a copilot suggestion when the ticket is still in the
 * triage queue. Routing is its OWN switch (autoRoutingEnabled, on by default), so it runs whether
 * or not auto-response is on; without it the ticket is left unassigned for a person.
 *
 * The analysis also decides the ticket's status (statusForConfidence): a ticket is created
 * "open"; with NO real match it stays open for a person, and with a match the score decides
 * (50-89% in_progress, 90%+ resolved). The move is a normal ticket update
 * (storage.updateTask + afterTicketUpdated as the AI system user), so it leaves history, realtime
 * messages, webhooks and knowledge-base learning exactly as a person's change does. A resolved
 * ticket then closes automatically after the follow-up window, like any other.
 */
export async function runCreateTimeAutoResponse(
  task: Task,
  actionBaseUrl: string | null = null
): Promise<void> {
  try {
    const settings = await getAISettings();
    // Say WHY the agent did nothing. A silent return here used to look exactly like "the AI ran
    // and found nothing", which is impossible to tell apart from the ticket staying open.
    if (!settings.isActive || !process.env.OPENROUTER_API_KEY) {
      logSkipped(task, settings, {
        isActive: settings.isActive,
        openRouterKey: !!process.env.OPENROUTER_API_KEY,
      });
      return;
    }

    if (!settings.autoResponseEnabled) {
      await routeIfNoReply(task, actionBaseUrl);
      logSkipped(task, settings, { autoResponseEnabled: false });
      return;
    }

    const { aiAutoResponseService } = await import("./aiAutoResponse");
    const analysis = await aiAutoResponseService.analyzeTicket(task);

    await aiAutoResponseService.saveComplexityScore(
      task.id,
      analysis.complexity,
      analysis.factors,
      `Complexity: ${analysis.complexity}/100. Should escalate: ${analysis.shouldEscalate}`
    );
    console.log(
      `AI create-time for ticket ${task.id}: analysed, confidence ${(analysis.confidence * 100).toFixed(1)}%, ` +
        `match ${analysis.hasMatch}`
    );

    if (!analysis.autoResponse || !analysis.shouldAutoRespond) {
      // No matched solution: classify and assign to the owning team instead of replying.
      await routeIfNoReply(task, actionBaseUrl);
      // The status depends on whether there was a real answer at all, not only on the score: with
      // no match the ticket stays open for a person (see statusForConfidence); with a match the
      // score decides (50-89% in_progress, 90%+ resolved).
      console.log(
        `AI create-time for ticket ${task.id}: no auto-response (confidence ${(analysis.confidence * 100).toFixed(1)}%, ` +
          `shouldAutoRespond ${analysis.shouldAutoRespond}, degraded ${analysis.degraded === true}, ` +
          `threshold ${(settings.confidenceThreshold * 100).toFixed(0)}%); routed`
      );
      await applyStatusForConfidence(task, analysis, actionBaseUrl);
      return;
    }

    try {
      const aiUserId = await ensureAiSystemUser();
      if (!aiUserId) throw new Error("AI system user unavailable");
      await storage.addTaskComment({
        taskId: task.id,
        userId: aiUserId,
        content: autoResponseCommentBody(analysis.confidence, analysis.autoResponse),
      } as any);
    } catch (error) {
      console.error(`AI auto-response comment failed for ticket ${task.id}:`, describeAIError(error));
      return;
    }
    // The row was stored NOT applied; it becomes applied only now that the comment exists.
    // If this fails the comment is already there: say so (it is not "comment failed"), try
    // once more, and leave the row unapplied otherwise. A later apply finds the comment
    // (autoResponseCommentExists) and marks the row without posting a second one.
    if (analysis.autoResponseRowId !== undefined) {
      const rowId = analysis.autoResponseRowId;
      try {
        await aiAutoResponseService.setApplied(rowId, true);
      } catch (first) {
        try {
          await aiAutoResponseService.setApplied(rowId, true);
        } catch (second) {
          console.error(
            `AI auto-response for ticket ${task.id}: the comment was posted but marking the draft applied failed (${describeAIError(first)}; retry ${describeAIError(second)})`
          );
        }
      }
    }

    // The answer is on the ticket, but an owner is still needed: route it like an unanswered
    // ticket (the AI confirms the copilot's suggestion or picks the team itself; a deliberate
    // assignment is left alone). Done before the status moves, so the ticket is never resolved
    // while still in the triage queue.
    await routeIfNoReply(task, actionBaseUrl);

    // The reply is on the ticket: record the status the confidence earns (90%+ resolved) after
    // the comment exists, so a customer never sees a resolved ticket without its answer. A
    // degraded reply never gets here (it is not auto-responded).
    await applyStatusForConfidence(task, analysis, actionBaseUrl);
  } catch (error) {
    console.error(`AI auto-response for new ticket ${task.id} failed:`, describeAIError(error));
  }
}

/**
 * Moves a new ticket to the status its AI confidence earns (see statusForConfidence).
 *
 * The write goes through storage.updateTask and afterTicketUpdated with the AI system user as the
 * actor, so it is an ordinary ticket change: history entry, realtime broadcast, webhooks and the
 * resolved-ticket learning all behave as they do for a person. Re-read first: the routing step may
 * have just assigned the ticket, and a person may have changed the status in the meantime, in which
 * case the ticket is left alone. Never throws.
 */
async function applyStatusForConfidence(
  task: Task,
  analysis: { confidence: number; hasMatch: boolean; degraded?: boolean },
  actionBaseUrl: string | null
): Promise<void> {
  try {
    const target = statusForConfidence(analysis.confidence, analysis.hasMatch);
    if (target === "open") {
      console.log(
        `AI ticket status for new ticket ${task.id}: stays open (` +
          `${analysis.hasMatch ? `confidence ${(analysis.confidence * 100).toFixed(1)}% is below 50%` : "no matching solution"})`
      );
      return;
    }

    const current = await storage.getTask(task.id);
    if (!current || current.status !== "open") {
      console.log(
        `AI ticket status for new ticket ${task.id}: left as "${current?.status ?? "missing"}" (changed since the analysis)`
      );
      return;
    }

    // The AI account must really exist: storage.updateTask writes a task_history row attributed to
    // this id, and its foreign key needs the users row. A null answer means the account could not
    // be created (an email clash), so there is nobody to attribute the change to and it is skipped
    // rather than written with an id the history insert would reject.
    const actor = await ensureAiSystemUser();
    if (!actor) {
      console.error(`AI ticket status for new ticket ${task.id}: skipped (AI system user unavailable)`);
      return;
    }
    const updates = { status: target };
    const recipientsBefore = await recipientsNow(task.id);
    const updatedTask = await storage.updateTask(task.id, updates, actor, { expectedStatus: "open" });
    console.log(`AI ticket status for new ticket ${task.id}: open -> ${target} (confidence ${(analysis.confidence * 100).toFixed(1)}%)`);
    await afterTicketUpdated({
      ticketId: task.id,
      before: current,
      updatedTask,
      updates,
      actorId: actor,
      recipientsBefore,
      reassigns: false,
      actionBaseUrl,
    });
  } catch (error) {
    console.error(`AI ticket status for new ticket ${task.id} failed:`, describeAIError(error));
  }
}

/** One line saying why the create-time agent did nothing, so a ticket that stays open is explainable. */
function logSkipped(task: Task, settings: { modelId: string }, reason: Record<string, unknown>): void {
  console.log(`AI create-time for ticket ${task.id}: skipped`, JSON.stringify({ ...reason, model: settings.modelId }));
}

/** No-match routing, isolated so a routing failure can never affect the auto-response path. */
async function routeIfNoReply(task: Task, actionBaseUrl: string | null): Promise<void> {
  try {
    await routeTicket(task, actionBaseUrl);
  } catch (error) {
    console.error(`AI ticket routing for new ticket ${task.id} failed:`, describeAIError(error));
  }
}