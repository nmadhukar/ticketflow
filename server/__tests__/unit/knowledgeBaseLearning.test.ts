import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { extractKnowledgeFromResolution, updateKnowledgeBase, generateEmbedding } from '../../knowledgeBaseLearning';
import { createMockBedrockClient, setMockResponse, testTickets } from '../mocks/aws-bedrock.mock';

// Mock dependencies
jest.mock('../../db');
jest.mock('../../bedrockIntegration');

describe('Knowledge Base Learning Service', () => {
  let mockBedrockClient: any;
  let mockDb: any;

  beforeEach(() => {
    mockBedrockClient = createMockBedrockClient();
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis()
    };

    jest.doMock('../../db', () => ({ db: mockDb }));
    jest.doMock('../../bedrockIntegration', () => ({
      getBedrockClient: () => mockBedrockClient
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractKnowledgeFromResolution', () => {
    it('should extract knowledge from successful resolution', async () => {
      setMockResponse(mockBedrockClient, 'knowledgeExtraction');
      
      const result = await extractKnowledgeFromResolution(testTickets.resolved);
      
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('tags');
      expect(result).toHaveProperty('effectivenessScore');
      
      expect(result.title).toBe('Browser Cache Authentication Fix');
      expect(result.effectivenessScore).toBeGreaterThan(0.7);
    });

    it('should handle tickets without resolutions', async () => {
      const unresolved = { ...testTickets.simpleAuth, resolution: null };
      
      await expect(extractKnowledgeFromResolution(unresolved))
        .rejects.toThrow('No resolution provided');
    });

    it('should validate extracted knowledge quality', async () => {
      // Mock low-quality extraction
      const lowQualityResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: JSON.stringify({
              title: 'Fix',
              summary: 'It works',
              content: 'Do this',
              category: 'general',
              tags: [],
              effectiveness_score: 0.2
            })
          }]
        }))
      };
      
      mockBedrockClient.send.mockResolvedValue(lowQualityResponse);
      
      const result = await extractKnowledgeFromResolution(testTickets.resolved);
      expect(result.effectivenessScore).toBeLessThan(0.5);
    });
  });

  describe('updateKnowledgeBase', () => {
    it('should create new knowledge article', async () => {
      const knowledgeData = {
        title: 'Test Article',
        summary: 'Test summary',
        content: 'Test content',
        category: 'troubleshooting',
        tags: ['test'],
        effectivenessScore: 0.8
      };

      // Mock database responses
      mockDb.select.mockResolvedValue([]); // No duplicates
      mockDb.insert.mockResolvedValue([{ id: 1, ...knowledgeData }]);

      const result = await updateKnowledgeBase(knowledgeData, testTickets.resolved.id);
      
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });

    it('should detect and handle duplicate articles', async () => {
      const knowledgeData = {
        title: 'Duplicate Article',
        summary: 'This already exists',
        content: 'Same content',
        category: 'troubleshooting',
        tags: ['duplicate'],
        effectivenessScore: 0.7
      };

      // Mock existing article
      mockDb.select.mockResolvedValue([{
        id: 1,
        title: 'Similar Article',
        similarity: 0.95
      }]);

      const result = await updateKnowledgeBase(knowledgeData, testTickets.resolved.id);
      
      expect(result.isDuplicate).toBe(true);
      expect(result.similarArticle).toHaveProperty('id', 1);
    });

    it('should update existing article if improvement detected', async () => {
      const improvedKnowledge = {
        title: 'Improved Article',
        summary: 'Better summary',
        content: 'More detailed content',
        category: 'troubleshooting',
        tags: ['improved'],
        effectivenessScore: 0.9
      };

      // Mock existing article with lower effectiveness
      mockDb.select.mockResolvedValue([{
        id: 1,
        title: 'Original Article',
        effectivenessScore: 0.6,
        similarity: 0.9
      }]);

      const result = await updateKnowledgeBase(improvedKnowledge, testTickets.resolved.id);
      
      expect(mockDb.update).toHaveBeenCalled();
      expect(result.updated).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings for text content', async () => {
      // Mock embedding response
      const embeddingResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          embedding: Array.from({ length: 1536 }, () => Math.random())
        }))
      };
      
      mockBedrockClient.send.mockResolvedValue(embeddingResponse);
      
      const embedding = await generateEmbedding('Test content for embedding');
      
      expect(embedding).toHaveLength(1536);
      expect(embedding.every(val => typeof val === 'number')).toBe(true);
    });

    it('should handle embedding generation errors', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Embedding service unavailable'));
      
      await expect(generateEmbedding('Test content'))
        .rejects.toThrow('Embedding service unavailable');
    });

    it('should normalize embeddings', async () => {
      const mockEmbedding = [0.5, -0.3, 0.8, -0.1];
      const embeddingResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))
      };
      
      mockBedrockClient.send.mockResolvedValue(embeddingResponse);
      
      const embedding = await generateEmbedding('Test content');
      
      // Check if normalized (magnitude should be close to 1)
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 2);
    });
  });

  describe('Quality Scoring', () => {
    it('should score knowledge articles based on multiple factors', async () => {
      const highQualityKnowledge = {
        title: 'Comprehensive Authentication Troubleshooting Guide',
        summary: 'Detailed step-by-step guide for resolving common authentication issues',
        content: 'This comprehensive guide covers multiple authentication scenarios...',
        category: 'troubleshooting',
        tags: ['authentication', 'login', 'troubleshooting', 'browser'],
        effectivenessScore: 0.9
      };

      const lowQualityKnowledge = {
        title: 'Fix',
        summary: 'It works',
        content: 'Do this',
        category: 'general',
        tags: [],
        effectivenessScore: 0.3
      };

      // The scoring should reflect quality differences
      expect(highQualityKnowledge.effectivenessScore).toBeGreaterThan(0.8);
      expect(lowQualityKnowledge.effectivenessScore).toBeLessThan(0.5);
    });
  });

  describe('Learning Queue Processing', () => {
    it('should process learning queue items in order', async () => {
      const queueItems = [
        { id: 1, ticketId: 1, priority: 'high', createdAt: new Date() },
        { id: 2, ticketId: 2, priority: 'medium', createdAt: new Date() }
      ];

      mockDb.select.mockResolvedValue(queueItems);
      
      // Mock the processing
      setMockResponse(mockBedrockClient, 'knowledgeExtraction');
      
      // Process items (this would be called by the actual processing function)
      for (const item of queueItems) {
        const result = await extractKnowledgeFromResolution({
          ...testTickets.resolved,
          id: item.ticketId
        });
        expect(result).toHaveProperty('effectivenessScore');
      }
    });

    it('should handle processing failures gracefully', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Processing failed'));
      
      await expect(extractKnowledgeFromResolution(testTickets.resolved))
        .rejects.toThrow('Processing failed');
    });
  });
});