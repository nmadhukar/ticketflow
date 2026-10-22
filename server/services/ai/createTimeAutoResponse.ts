import type { Task } from "@shared/schema";
import { storage } from "../../storage";
import { getAISettings } from "../../admin/aiSettings";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { describeAIError } from "./aiErrors";
import { autoResponseCommentBody } from "./autoResponseComment";
import { routeTicket } from "./ticketRouting";

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
 * When that analysis finds no confident answer, the ticket is handed to the 0031
 * routing step (ticketRouting.routeTicket): it classifies the ticket onto the team
 * that owns its problem area and assigns it. Routing is its OWN opt-in setting
 * (autoRoutingEnabled, default off), so it runs whether or not auto-response is on,
 * and it never throws either.
 */
export async function runCreateTimeAutoResponse(
  task: Task,
  actionBaseUrl: string | null = null
): Promise<void> {
  try {
    const settings = await getAISettings();
    if (!settings.isActive || !process.env.OPENROUTER_API_KEY) return;

    if (!settings.autoResponseEnabled) {
      await routeIfNoReply(task, actionBaseUrl);
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

    if (!analysis.autoResponse || !analysis.shouldAutoRespond) {
      // No matched solution: classify and assign to the owning team instead of replying.
      await routeIfNoReply(task, actionBaseUrl);
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
  } catch (error) {
    console.error(`AI auto-response for new ticket ${task.id} failed:`, describeAIError(error));
  }
}

/** No-match routing, isolated so a routing failure can never affect the auto-response path. */
async function routeIfNoReply(task: Task, actionBaseUrl: string | null): Promise<void> {
  try {
    await routeTicket(task, actionBaseUrl);
  } catch (error) {
    console.error(`AI ticket routing for new ticket ${task.id} failed:`, describeAIError(error));
  }
}