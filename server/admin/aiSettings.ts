import fs from "fs";
import path from "path";

export interface AISettings {
  autoResponseEnabled: boolean;
  confidenceThreshold: number; // 0..1
  maxResponseLength: number;
  responseTimeout: number; // seconds

  autoLearnEnabled: boolean;
  minResolutionScore: number; // 0..1
  articleApprovalRequired: boolean;

  complexityThreshold: number; // 0..100
  escalationEnabled: boolean;
  escalationTeamId?: number;

  bedrockModel: string;
  temperature: number; // 0..1
  maxTokens: number;

  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
}

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

  bedrockModel: "anthropic.claude-3-sonnet-20240229-v1:0",
  temperature: 0.3,
  maxTokens: 2000,

  maxRequestsPerMinute: 20,
  maxRequestsPerDay: 1000,
};

const DATA_DIR = path.join(process.cwd(), "server", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "ai-settings.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export async function getAISettings(): Promise<AISettings> {
  try {
    ensureDataDir();
    if (!fs.existsSync(SETTINGS_FILE)) {
      await saveAISettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    // Shallow merge with defaults to handle new fields
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveAISettings(
  settings: Partial<AISettings>
): Promise<AISettings> {
  ensureDataDir();
  const current = await getAISettings();
  const merged = validateAISettings({ ...current, ...settings });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf-8");
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
    maxRequestsPerDay: clamp(Number(input.maxRequestsPerDay), 10, 10000),
  };
}
