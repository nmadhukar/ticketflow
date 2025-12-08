import { AISettings } from "@shared/interfaces";
import { storage } from "../storage";

const DEFAULT_SETTINGS: AISettings = {
  autoResponseEnabled: true,
  confidenceThreshold: 0.7,
  maxResponseLength: 1000,
  responseTimeout: 30,

  autoLearnEnabled: true,
  minResolutionScore: 0.8,
  articleApprovalRequired: true,

  complexityThreshold: 70,
  escalationEnabled: true,
  escalationTeamId: undefined,

  bedrockModel: "",
  temperature: 0.3,
  maxTokens: 2000,

  maxRequestsPerMinute: 20,
  maxRequestsPerHour: 0,
  maxRequestsPerDay: 1000,
};

export async function getAISettings(): Promise<AISettings> {
  try {
    const settings = await storage.getBedrockSettings();
    if (!settings) {
      return DEFAULT_SETTINGS;
    }

    return {
      autoResponseEnabled: settings.autoResponseEnabled ?? true,
      confidenceThreshold: Number(settings.confidenceThreshold || 0.7),
      maxResponseLength: settings.maxResponseLength || 1000,
      responseTimeout: settings.responseTimeout || 30,
      autoLearnEnabled: settings.autoLearnEnabled ?? true,
      minResolutionScore: Number(settings.minResolutionScore || 0.8),
      articleApprovalRequired: settings.articleApprovalRequired ?? true,
      complexityThreshold: settings.complexityThreshold || 70,
      escalationEnabled: settings.escalationEnabled ?? true,
      escalationTeamId: settings.escalationTeamId || undefined,
      bedrockModel: settings.bedrockModelId || "",
      temperature: Number(settings.temperature || 0.3),
      maxTokens: settings.maxTokens || 2000,
      maxRequestsPerMinute: settings.maxRequestsPerMinute || 20,
      maxRequestsPerHour: settings.maxRequestsPerHour || 0,
      maxRequestsPerDay: settings.maxRequestsPerDay || 1000,
    };
  } catch (error) {
    console.error("Error loading AI settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveAISettings(
  settings: Partial<AISettings>,
  userId: string = "system"
): Promise<AISettings> {
  const current = await getAISettings();
  const merged = validateAISettings({ ...current, ...settings });

  await storage.updateBedrockSettings(
    {
      autoResponseEnabled: merged.autoResponseEnabled,
      confidenceThreshold: merged.confidenceThreshold.toString(),
      maxResponseLength: merged.maxResponseLength,
      responseTimeout: merged.responseTimeout,
      autoLearnEnabled: merged.autoLearnEnabled,
      minResolutionScore: merged.minResolutionScore.toString(),
      articleApprovalRequired: merged.articleApprovalRequired,
      complexityThreshold: merged.complexityThreshold,
      escalationEnabled: merged.escalationEnabled,
      escalationTeamId: merged.escalationTeamId || null,
      temperature: merged.temperature.toString(),
      maxTokens: merged.maxTokens,
      maxRequestsPerMinute: merged.maxRequestsPerMinute,
      maxRequestsPerHour: merged.maxRequestsPerHour,
      maxRequestsPerDay: merged.maxRequestsPerDay,
      // Note: bedrockModel is stored in bedrockModelId, not updated here
    },
    userId
  );

  return merged;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function validateAISettings(input: AISettings): AISettings {
  return {
    autoResponseEnabled: !!input.autoResponseEnabled,
    confidenceThreshold: clamp(Number(input.confidenceThreshold), 0, 1),
    maxResponseLength: clamp(Number(input.maxResponseLength), 100, 5000),
    responseTimeout: clamp(Number(input.responseTimeout), 5, 120),

    autoLearnEnabled: !!input.autoLearnEnabled,
    minResolutionScore: clamp(Number(input.minResolutionScore), 0, 1),
    articleApprovalRequired: !!input.articleApprovalRequired,

    complexityThreshold: clamp(Number(input.complexityThreshold), 0, 100),
    escalationEnabled: !!input.escalationEnabled,
    escalationTeamId:
      input.escalationTeamId !== undefined && input.escalationTeamId !== null
        ? Number(input.escalationTeamId)
        : undefined,

    bedrockModel: String(input.bedrockModel || DEFAULT_SETTINGS.bedrockModel),
    temperature: clamp(Number(input.temperature), 0, 1),
    maxTokens: clamp(Number(input.maxTokens), 100, 4000),

    maxRequestsPerMinute: clamp(Number(input.maxRequestsPerMinute), 1, 100),
    // allow 0 to disable hourly limit
    maxRequestsPerHour: input.maxRequestsPerHour
      ? clamp(Number(input.maxRequestsPerHour), 1, 2000)
      : 0,
    maxRequestsPerDay: clamp(Number(input.maxRequestsPerDay), 10, 10000),
  };
}
