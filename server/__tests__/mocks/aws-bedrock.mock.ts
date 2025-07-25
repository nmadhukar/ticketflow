import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Mock responses for different scenarios
export const mockBedrockResponses = {
  highConfidence: {
    body: new TextEncoder().encode(JSON.stringify({
      content: [{
        text: "Based on the ticket description, this appears to be a common authentication issue. Try clearing your browser cache and cookies, then attempt to log in again. If the issue persists, check that your username and password are correct and that your account hasn't been locked."
      }],
      usage: { input_tokens: 150, output_tokens: 75 }
    }))
  },
  mediumConfidence: {
    body: new TextEncoder().encode(JSON.stringify({
      content: [{
        text: "This seems to be related to network connectivity. I recommend checking your internet connection and firewall settings. However, this issue might require additional investigation by our technical team."
      }],
      usage: { input_tokens: 140, output_tokens: 60 }
    }))
  },
  lowConfidence: {
    body: new TextEncoder().encode(JSON.stringify({
      content: [{
        text: "I understand you're experiencing an issue, but I need more specific information to provide accurate assistance. This ticket should be reviewed by a human agent for proper diagnosis."
      }],
      usage: { input_tokens: 120, output_tokens: 50 }
    }))
  },
  knowledgeExtraction: {
    body: new TextEncoder().encode(JSON.stringify({
      content: [{
        text: JSON.stringify({
          title: "Browser Cache Authentication Fix",
          summary: "Resolving login issues by clearing browser cache and cookies",
          content: "When users experience authentication problems, clearing browser cache and cookies often resolves the issue. This solution works for most browser-related login problems.",
          category: "troubleshooting",
          tags: ["authentication", "browser", "cache", "login"],
          effectiveness_score: 0.85
        })
      }],
      usage: { input_tokens: 200, output_tokens: 120 }
    }))
  },
  complexityAnalysis: {
    body: new TextEncoder().encode(JSON.stringify({
      content: [{
        text: JSON.stringify({
          complexity_score: 75,
          factors: [
            "Multiple system components involved",
            "Requires database investigation",
            "Potential security implications"
          ],
          escalation_recommended: true,
          suggested_team: "technical"
        })
      }],
      usage: { input_tokens: 180, output_tokens: 90 }
    }))
  }
};

// Mock the AWS Bedrock client
export const createMockBedrockClient = () => {
  const mockClient = {
    send: (global as any).jest?.fn() || (() => Promise.resolve(mockBedrockResponses.highConfidence))
  };

  // Default to high confidence response
  if ((global as any).jest) {
    mockClient.send.mockResolvedValue(mockBedrockResponses.highConfidence);
  }

  return mockClient as unknown as BedrockRuntimeClient;
};

// Helper to set specific mock responses
export const setMockResponse = (mockClient: any, responseType: keyof typeof mockBedrockResponses) => {
  mockClient.send.mockResolvedValue(mockBedrockResponses[responseType]);
};

// Helper to simulate API errors
export const setMockError = (mockClient: any, error: Error) => {
  mockClient.send.mockRejectedValue(error);
};

// Test data for different ticket scenarios
export const testTickets = {
  simpleAuth: {
    id: 1,
    title: "Can't log in to account",
    description: "I'm trying to log in but it says invalid credentials",
    category: "support",
    priority: "medium",
    status: "open"
  },
  complexNetwork: {
    id: 2,
    title: "Intermittent connection timeouts",
    description: "Users are experiencing random disconnections during peak hours. The issue affects multiple services and seems to correlate with high traffic periods.",
    category: "incident",
    priority: "high",
    status: "open"
  },
  vague: {
    id: 3,
    title: "Something is broken",
    description: "It doesn't work",
    category: "bug",
    priority: "low",
    status: "open"
  },
  resolved: {
    id: 4,
    title: "Email notifications not working",
    description: "Email notifications stopped working after the last update",
    category: "bug",
    priority: "medium",
    status: "resolved",
    resolution: "Updated email service configuration and restarted the notification service. All emails are now being sent successfully."
  }
};