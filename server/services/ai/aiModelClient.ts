export type GenerateRequest = {
  operation: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
  temperature: number;
  responseSchema?: Record<string, unknown>;
  /**
   * Set when the visible text must be complete (a JSON operation). A provider that stopped at the
   * token cap returned a fragment: fail as unusable instead of parsing a partial object. Free-text
   * calls leave this unset, because a short answer that reached the cap is truncated but still a
   * valid answer, and refusing it would report a working key as broken.
   */
  requireCompleteOutput?: boolean;
  /**
   * Set false to ask the provider to skip hidden reasoning for this call. Reasoning tokens
   * count against maxOutputTokens on a reasoning model, so a structured (JSON) call whose
   * budget is spent thinking comes back with truncated or empty visible text.
   */
  reasoning?: boolean;
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
