import type { Task } from "@shared/schema";
import { storage } from "../../storage";
import { getAISettings } from "../../admin/aiSettings";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { describeAIError } from "./aiErrors";

/**
 * Runs after a ticket exists. Never throws: a failure here must not fail the
 * create, so every error is logged (ticket id, error type and status only) and swallowed.
 *
 * Settings are read now, not at boot, so an admin toggle applies to the next
 * ticket. With auto-response off, or Bedrock not configured, no Bedrock call is made.
 *
 * There is ONE decision: aiAutoResponseService.analyzeTicket returns
 * `shouldAutoRespond` (calculateConfidence, from the admin's enabled flag and
 * threshold) and stores the single auto-response row with wasApplied set from it.
 * This function only acts on that answer: it posts the comment, authored by the AI
 * system user and cut to maxResponseLength, and if the comment cannot be written it
 * sets the row back to not applied so the row and the comment agree.
 *
 * Escalation settings are not applied here: reassigning a customer's new ticket to
 * another team is a routing decision made by people, and this path never did it
 * (it only logged). It is not something AI authorship should start doing silently.
 */
export async function runCreateTimeAutoResponse(task: Task): Promise<void> {
  try {
    const settings = await getAISettings();
    if (!settings.autoResponseEnabled) return;

    const bedrock = await storage.getBedrockSettings();
    const configured =
      !!bedrock?.bedrockAccessKeyId && !!bedrock?.bedrockSecretAccessKey && !!bedrock?.bedrockRegion;
    if (!configured) return;

    const { aiAutoResponseService } = await import("./aiAutoResponse");
    const analysis = await aiAutoResponseService.analyzeTicket(task);

    await aiAutoResponseService.saveComplexityScore(
      task.id,
      analysis.complexity,
      analysis.factors,
      `Complexity: ${analysis.complexity}/100. Should escalate: ${analysis.shouldEscalate}`
    );

    if (!analysis.autoResponse || !analysis.shouldAutoRespond) return;

    try {
      const aiUserId = await ensureAiSystemUser();
      if (!aiUserId) throw new Error("AI system user unavailable");
      await storage.addTaskComment({
        taskId: task.id,
        userId: aiUserId,
        content: `AI Auto-Response (confidence ${(analysis.confidence * 100).toFixed(0)}%): ${analysis.autoResponse}`,
      } as any);
      // The row was stored NOT applied; it becomes applied only now that the comment exists.
      if (analysis.autoResponseRowId !== undefined) {
        await aiAutoResponseService.setApplied(analysis.autoResponseRowId, true);
      }
    } catch (error) {
      console.error(`AI auto-response comment failed for ticket ${task.id}:`, describeAIError(error));
    }
  } catch (error) {
    console.error(`AI auto-response for new ticket ${task.id} failed:`, describeAIError(error));
  }
}
