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
  maxRequestsPerHour: number; // 0 disables hourly cap
  maxRequestsPerDay: number;
}
