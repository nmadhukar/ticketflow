import type { Task } from "@shared/schema";
import { storage } from "../../storage";
import { getAISettings } from "../../admin/aiSettings";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { describeAIError } from "./aiErrors";

/**
 * Runs after a ticket exists. Never throws: a failure here must not fail the
 * create, so every error is logged (type and status only) and swallowed.
 *
 * Settings are read now, not at boot, so an admin toggle applies to the next
 * ticket. With auto-response off, or Bedrock not configured, no Bedrock call is made.
 * The comment is authored by the AI system user, never by the ticket's creator.
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

    const threshold = Math.max(0, Math.min(1, Number(settings.confidenceThreshold)));
    if (analysis.autoResponse && analysis.confidence >= threshold) {
      await aiAutoResponseService.saveAutoResponse(task.id, analysis.autoResponse, analysis.confidence, true);
      try {
        await storage.addTaskComment({
          taskId: task.id,
          userId: await ensureAiSystemUser(),
          content: `AI Auto-Response (confidence ${(analysis.confidence * 100).toFixed(0)}%): ${analysis.autoResponse}`,
        } as any);
      } catch (error) {
        console.error("AI auto-response comment failed:", describeAIError(error));
      }
    }
  } catch (error) {
    console.error("AI auto-response for new ticket failed:", describeAIError(error));
  }
}
