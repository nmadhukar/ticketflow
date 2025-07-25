import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Integration tests for AWS Bedrock API
describe('AWS Bedrock Integration Tests', () => {
  let bedrockClient: BedrockRuntimeClient;
  const isIntegrationTestEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

  beforeAll(() => {
    if (!isIntegrationTestEnabled) {
      console.log('Skipping integration tests. Set RUN_INTEGRATION_TESTS=true to run.');
      return;
    }

    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  });

  const skipIfNotEnabled = () => {
    if (!isIntegrationTestEnabled) {
      return it.skip;
    }
    return it;
  };

  describe('Claude 3 Sonnet Model', () => {
    skipIfNotEnabled()('should successfully invoke Claude 3 Sonnet', async () => {
      const input = {
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: "Analyze this support ticket and provide a helpful response: User cannot log into their account and gets 'invalid credentials' error."
            }
          ]
        })
      };

      const command = new InvokeModelCommand(input);
      const response = await bedrockClient.send(command);
      
      expect(response).toBeDefined();
      expect(response.body).toBeDefined();
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      expect(responseBody.content).toBeDefined();
      expect(responseBody.content[0].text).toContain('log');
      expect(responseBody.usage).toBeDefined();
      expect(responseBody.usage.input_tokens).toBeGreaterThan(0);
      expect(responseBody.usage.output_tokens).toBeGreaterThan(0);
    }, 30000);

    skipIfNotEnabled()('should handle different confidence thresholds', async () => {
      const testCases = [
        {
          description: "Clear authentication issue",
          expected_confidence: "high"
        },
        {
          description: "Complex network infrastructure problem with multiple interconnected systems failing",
          expected_confidence: "medium"
        },
        {
          description: "Something is broken",
          expected_confidence: "low"
        }
      ];

      for (const testCase of testCases) {
        const input = {
          modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 500,
            messages: [
              {
                role: "user",
                content: `Analyze this ticket and rate your confidence in providing an accurate response (high/medium/low): ${testCase.description}`
              }
            ]
          })
        };

        const command = new InvokeModelCommand(input);
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        
        expect(responseBody.content[0].text.toLowerCase()).toContain('confidence');
      }
    }, 60000);

    skipIfNotEnabled()('should generate knowledge base articles from resolutions', async () => {
      const ticketResolution = {
        title: "Email notifications not working",
        description: "Email notifications stopped working after the last update",
        resolution: "Updated email service configuration and restarted the notification service. All emails are now being sent successfully."
      };

      const input = {
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `Extract knowledge from this resolved ticket to create a knowledge base article. Return JSON with title, summary, content, category, tags, and effectiveness_score (0-1):

Ticket: ${ticketResolution.title}
Description: ${ticketResolution.description}
Resolution: ${ticketResolution.resolution}`
            }
          ]
        })
      };

      const command = new InvokeModelCommand(input);
      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      const content = responseBody.content[0].text;
      expect(content).toContain('title');
      expect(content).toContain('summary');
      expect(content).toContain('effectiveness_score');
      
      // Try to parse as JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const knowledgeData = JSON.parse(jsonMatch[0]);
        expect(knowledgeData.title).toBeDefined();
        expect(knowledgeData.effectiveness_score).toBeGreaterThan(0);
        expect(knowledgeData.effectiveness_score).toBeLessThanOrEqual(1);
      }
    }, 30000);
  });

  describe('Error Handling', () => {
    skipIfNotEnabled()('should handle rate limiting gracefully', async () => {
      // Simulate rapid requests to test rate limiting
      const promises = Array.from({ length: 5 }, async (_, i) => {
        const input = {
          modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 100,
            messages: [
              {
                role: "user",
                content: `Test request ${i}`
              }
            ]
          })
        };

        const command = new InvokeModelCommand(input);
        return bedrockClient.send(command);
      });

      const results = await Promise.allSettled(promises);
      
      // At least some should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);
    }, 45000);

    skipIfNotEnabled()('should handle invalid model parameters', async () => {
      const input = {
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: -1, // Invalid value
          messages: [
            {
              role: "user",
              content: "Test"
            }
          ]
        })
      };

      const command = new InvokeModelCommand(input);
      await expect(bedrockClient.send(command)).rejects.toThrow();
    });
  });

  describe('Performance Benchmarks', () => {
    skipIfNotEnabled()('should respond within acceptable time limits', async () => {
      const startTime = Date.now();
      
      const input = {
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: "Provide a quick response to help a user who can't access their account."
            }
          ]
        })
      };

      const command = new InvokeModelCommand(input);
      const response = await bedrockClient.send(command);
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      expect(response).toBeDefined();
      expect(responseTime).toBeLessThan(15000); // Should respond within 15 seconds
      
      console.log(`Bedrock response time: ${responseTime}ms`);
    }, 20000);
  });
});