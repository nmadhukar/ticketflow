export type GenerateRequest = {
  operation: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
  temperature: number;
  responseSchema?: Record<string, unknown>;
  context?: { userId?: string; ticketId?: number };
};

export type GenerateResult = {
  text: string;
  requestedModel: string;
  actualModel: string;
  promptTokens: number;
  completionTokens: number;
  generationId?: string;
  estimatedCostUsd: number;
  verifiedCostUsd?: number;
};

export interface AiModelClient {
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
