import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// aiAutoResponse imports the database at module load; nothing here needs a real one.
jest.mock('../../storage/db', () => ({ db: {}, pool: {} }));
jest.mock('../../services/ai/knowledgeBase', () => ({ knowledgeBaseService: {} }));
jest.mock('../../utils/systemUser', () => ({ getSystemUserId: jest.fn() }));
jest.mock('../../services/ai/bedrockIntegration', () => ({
  bedrockIntegration: {
    analyzeTicket: jest.fn(),
    generateResponse: jest.fn(),
    calculateConfidence: jest.fn(),
    updateKnowledgeBase: jest.fn(),
  },
}));

import { calculateConfidence, AIAutoResponseService } from '../../services/ai/aiAutoResponse';
import { bedrockIntegration } from '../../services/ai/bedrockIntegration';

const bedrock = bedrockIntegration as unknown as Record<string, jest.Mock<any>>;

const LONG_RESPONSE = 'Please reset your password using the link on the sign-in page, then try again.';

const loginTicket: any = {
  id: 1,
  title: "Can't login",
  description: 'It says invalid credentials',
};

const vagueTicket: any = {
  id: 3,
  title: 'Something is broken',
  description: "It doesn't work",
};

describe('calculateConfidence', () => {
  it('starts at 0.7 for a ticket that mentions a known support keyword', () => {
    expect(calculateConfidence(loginTicket, LONG_RESPONSE, [])).toBeCloseTo(0.7);
  });

  it('starts at 0.4 for a vague ticket', () => {
    expect(calculateConfidence(vagueTicket, LONG_RESPONSE, [])).toBeCloseTo(0.4);
  });

  it('matches keywords in the description as well as the title', () => {
    const ticket: any = { id: 2, title: 'Help', description: 'My password does not work' };
    expect(calculateConfidence(ticket, LONG_RESPONSE, [])).toBeCloseTo(0.7);
  });

  it('subtracts 0.2 when the response is shorter than 50 characters', () => {
    expect(calculateConfidence(vagueTicket, 'Insufficient information provided', [])).toBeCloseTo(0.2);
  });

  it('adds 0.1 per knowledge match, capped at 0.3', () => {
    const matches = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
    expect(calculateConfidence(loginTicket, LONG_RESPONSE, matches(1))).toBeCloseTo(0.8);
    expect(calculateConfidence(loginTicket, LONG_RESPONSE, matches(2))).toBeCloseTo(0.9);
    expect(calculateConfidence(loginTicket, LONG_RESPONSE, matches(10))).toBeCloseTo(1.0);
  });

  it('never leaves the 0..1 range', () => {
    expect(calculateConfidence(vagueTicket, '', [])).toBeGreaterThanOrEqual(0);
    expect(calculateConfidence(loginTicket, LONG_RESPONSE, new Array(50).fill({}))).toBeLessThanOrEqual(1);
  });
});


describe('AIAutoResponseService.analyzeTicket', () => {
  const ticket: any = { id: 7, title: 'Cannot login', description: 'invalid credentials', priority: 'high' };
  const articles = [{ id: 11, title: 'Reset your password' }];
  let service: AIAutoResponseService;
  let storeAutoResponse: jest.Mock<any>;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AIAutoResponseService();
    // Database-backed collaborators are stubbed; Bedrock is the unit boundary.
    jest.spyOn(service as any, 'findSimilarResolvedTickets').mockResolvedValue([{ id: 1 }]);
    jest.spyOn(service as any, 'searchKnowledgeBase').mockResolvedValue(articles);
    storeAutoResponse = jest.spyOn(service as any, 'storeAutoResponse').mockResolvedValue(undefined) as any;
    bedrock.analyzeTicket.mockResolvedValue({ complexityScore: 20 });
    bedrock.generateResponse.mockResolvedValue({ response: 'Reset your password.', suggestedArticles: [11] });
  });

  it('returns the generated response and stores it as applied when confidence is high', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.9, shouldAutoRespond: true });

    const result = await service.analyzeTicket(ticket);

    expect(bedrock.generateResponse).toHaveBeenCalledWith(ticket, articles);
    expect(bedrock.calculateConfidence).toHaveBeenCalledWith(ticket, articles.length, 20);
    expect(result).toMatchObject({
      autoResponse: 'Reset your password.',
      confidence: 0.9,
      complexity: 20,
      shouldEscalate: false,
    });
    expect(result.factors.urgency).toBe(20); // high priority
    expect(result.factors.historical).toBe(0); // a similar ticket exists
    expect(storeAutoResponse).toHaveBeenCalledWith(7, expect.objectContaining({ applied: true, confidence: 0.9 }));
  });

  it('returns the one decision (shouldAutoRespond) and stores exactly ONE row, whose applied flag matches it', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.9, shouldAutoRespond: true });
    storeAutoResponse.mockResolvedValue(42);

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldAutoRespond).toBe(true);
    expect(result.autoResponseRowId).toBe(42);
    expect(storeAutoResponse).toHaveBeenCalledTimes(1);
    expect(storeAutoResponse).toHaveBeenCalledWith(7, expect.objectContaining({ applied: true }));
  });

  it('autoApply false (an on-demand draft): the row is NOT applied even when the decision is yes', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.9, shouldAutoRespond: true });

    const result = await service.analyzeTicket(ticket, { autoApply: false });

    expect(result.shouldAutoRespond).toBe(true);
    expect(storeAutoResponse).toHaveBeenCalledTimes(1);
    expect(storeAutoResponse).toHaveBeenCalledWith(7, expect.objectContaining({ applied: false }));
  });

  it('decision no: shouldAutoRespond false and the row is not applied', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.8, shouldAutoRespond: false });

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldAutoRespond).toBe(false);
    expect(storeAutoResponse).toHaveBeenCalledWith(7, expect.objectContaining({ applied: false }));
  });

  it('escalates when Bedrock says confidence is below its auto-respond threshold', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.3, shouldAutoRespond: false });

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldEscalate).toBe(true);
    expect(result.autoResponse).toBe('Reset your password.');
    expect(storeAutoResponse).toHaveBeenCalledWith(7, expect.objectContaining({ applied: false }));
  });

  it('does not store a response when confidence is zero', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0, shouldAutoRespond: false });

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldEscalate).toBe(true);
    expect(storeAutoResponse).not.toHaveBeenCalled();
  });

  it('falls back to an escalated, empty result when Bedrock fails', async () => {
    bedrock.analyzeTicket.mockRejectedValue(new Error('Bedrock throttled'));

    const result = await service.analyzeTicket(ticket);

    expect(result).toEqual({
      autoResponse: null,
      confidence: 0,
      complexity: 50,
      factors: { keywords: 0, urgency: 0, technical: 0, historical: 0, sentiment: 0 },
      shouldEscalate: true,
      shouldAutoRespond: false,
    });
    expect(storeAutoResponse).not.toHaveBeenCalled();
  });
});
