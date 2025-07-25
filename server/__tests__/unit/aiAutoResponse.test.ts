import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { analyzeTicket, generateResponse, calculateConfidence } from '../../aiAutoResponse';
import { createMockBedrockClient, setMockResponse, setMockError, testTickets } from '../mocks/aws-bedrock.mock';

// Mock the Bedrock client
jest.mock('@aws-sdk/client-bedrock-runtime');

describe('AI Auto Response Service', () => {
  let mockBedrockClient: any;

  beforeEach(() => {
    mockBedrockClient = createMockBedrockClient();
    // Mock the module to return our mock client
    jest.doMock('../../bedrockIntegration', () => ({
      getBedrockClient: () => mockBedrockClient
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeTicket', () => {
    it('should analyze a simple ticket correctly', async () => {
      setMockResponse(mockBedrockClient, 'highConfidence');
      
      const result = await analyzeTicket(testTickets.simpleAuth);
      
      expect(result).toHaveProperty('ticketId', testTickets.simpleAuth.id);
      expect(result).toHaveProperty('complexity');
      expect(result).toHaveProperty('suggestedCategory');
      expect(result).toHaveProperty('requiresEscalation');
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle complex tickets appropriately', async () => {
      setMockResponse(mockBedrockClient, 'complexityAnalysis');
      
      const result = await analyzeTicket(testTickets.complexNetwork);
      
      expect(result.complexity).toBeGreaterThan(50);
      expect(result.requiresEscalation).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      setMockError(mockBedrockClient, new Error('API Rate Limit Exceeded'));
      
      await expect(analyzeTicket(testTickets.simpleAuth)).rejects.toThrow('API Rate Limit Exceeded');
    });
  });

  describe('generateResponse', () => {
    it('should generate appropriate response for auth issues', async () => {
      setMockResponse(mockBedrockClient, 'highConfidence');
      
      const response = await generateResponse(
        testTickets.simpleAuth,
        [],
        { confidenceThreshold: 0.7 }
      );
      
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('confidence');
      expect(response.content).toContain('authentication');
      expect(response.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should incorporate knowledge base context', async () => {
      const knowledgeContext = [
        {
          id: 1,
          title: 'Login Troubleshooting Guide',
          content: 'Clear browser cache and cookies to resolve login issues',
          category: 'troubleshooting'
        }
      ];

      setMockResponse(mockBedrockClient, 'highConfidence');
      
      const response = await generateResponse(
        testTickets.simpleAuth,
        knowledgeContext,
        { confidenceThreshold: 0.7 }
      );
      
      expect(response.content).toContain('cache');
      expect(mockBedrockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            body: expect.stringContaining('knowledge base')
          })
        })
      );
    });

    it('should respect confidence threshold settings', async () => {
      setMockResponse(mockBedrockClient, 'lowConfidence');
      
      const response = await generateResponse(
        testTickets.vague,
        [],
        { confidenceThreshold: 0.8 }
      );
      
      expect(response.confidence).toBeLessThan(0.8);
      expect(response.shouldAutoRespond).toBe(false);
    });
  });

  describe('calculateConfidence', () => {
    it('should calculate high confidence for clear issues', () => {
      const confidence = calculateConfidence(
        testTickets.simpleAuth,
        'Clear authentication issue with standard resolution steps',
        []
      );
      
      expect(confidence).toBeGreaterThan(0.7);
    });

    it('should calculate lower confidence for vague descriptions', () => {
      const confidence = calculateConfidence(
        testTickets.vague,
        'Insufficient information provided',
        []
      );
      
      expect(confidence).toBeLessThan(0.5);
    });

    it('should increase confidence with relevant knowledge base matches', () => {
      const knowledgeMatches = [
        { id: 1, title: 'Login Issues', similarity: 0.9 },
        { id: 2, title: 'Authentication Guide', similarity: 0.8 }
      ];

      const confidenceWithKB = calculateConfidence(
        testTickets.simpleAuth,
        'Authentication troubleshooting steps',
        knowledgeMatches
      );

      const confidenceWithoutKB = calculateConfidence(
        testTickets.simpleAuth,
        'Authentication troubleshooting steps',
        []
      );
      
      expect(confidenceWithKB).toBeGreaterThan(confidenceWithoutKB);
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      setMockError(mockBedrockClient, new Error('Request timeout'));
      
      await expect(analyzeTicket(testTickets.simpleAuth)).rejects.toThrow('Request timeout');
    });

    it('should handle invalid API responses', async () => {
      mockBedrockClient.send.mockResolvedValue({
        body: new TextEncoder().encode('invalid json')
      });
      
      await expect(analyzeTicket(testTickets.simpleAuth)).rejects.toThrow();
    });

    it('should handle missing required fields', async () => {
      const invalidTicket = { ...testTickets.simpleAuth, description: '' };
      
      await expect(analyzeTicket(invalidTicket)).rejects.toThrow('description');
    });
  });
});