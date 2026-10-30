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

import { calculateConfidence, articleRelevance, trimToLength, toSearchTerms, AIAutoResponseService } from '../../services/ai/aiAutoResponse';
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


describe('trimToLength: a reply is never cut mid-word', () => {
  it('returns short text unchanged', () => {
    expect(trimToLength("All good.", 1000)).toBe("All good.");
  });

  it('ends on a whole sentence when one fits inside the budget', () => {
    const out = trimToLength("First sentence. Second sentence here that is longer.", 30);
    expect(out).toBe("First sentence.");
  });

  it('falls back to a word boundary and marks the cut, never a half word', () => {
    const full = "alpha bravo charlie delta echo foxtrot golf hotel india";
    const out = trimToLength(full, 24);
    expect(out.endsWith("…")).toBe(true);
    const kept = out.replace("…", "").trimEnd();
    // Everything kept is a prefix of the original, and it stops on a whole word.
    expect(full.startsWith(kept)).toBe(true);
    expect(full[kept.length]).toBe(" ");
  });

  it('does not leave the partial word the old slice produced', () => {
    const text = "Once we have this information, we will audit the logs and correct the invoice. - Work w";
    expect(trimToLength(text, text.length - 1)).not.toContain("Work w");
  });
});

describe('toSearchTerms: the search keeps non-English words', () => {
  it('keeps an accented word instead of stripping it to nothing', () => {
    expect(toSearchTerms('Contraseña caducada')).toContain('contraseña');
  });

  it('keeps Cyrillic words', () => {
    expect(toSearchTerms('пароль сбросить')).toContain('пароль');
  });

  it('keeps CJK words that clear the length floor', () => {
    // The four-character floor still applies, so a two-character CJK word is dropped as noise;
    // the point here is that the script survives the split at all.
    expect(toSearchTerms('密码重置 失败')).toEqual(['密码重置']);
  });

  it('still drops English stop words and short words', () => {
    expect(toSearchTerms('please reset the password now')).toEqual(['reset', 'password']);
  });
});

describe('articleRelevance: one shared common word is not a match', () => {
  it('scores a title or tag hit above a body hit', () => {
    const article = { title: "Password Reset", content: "reset your password", tags: [] };
    expect(articleRelevance(article, ["reset"])).toBe(3);
    expect(articleRelevance({ title: "Guide", content: "reset it", tags: [] }, ["reset"])).toBe(1);
  });

  it('drops an unrelated article that only shares one body word (the real mouse case)', () => {
    // "FAQ: Why can’t I see my team’s tickets?" matched the mouse ticket on "request" alone,
    // in its body; that one hit made confidence pass the threshold and skipped routing.
    const article = { title: "FAQ: Why can’t I see my team’s tickets?", content: "Submit a request to your admin.", tags: [] };
    expect(articleRelevance(article, ["request", "mouse", "scroll", "wheel", "desk"])).toBeLessThan(2);
  });

  it('keeps an article that matches the ticket on several terms', () => {
    const article = { title: "Quick Fixes: VPN Not Connecting", content: "vpn connection error", tags: [] };
    expect(articleRelevance(article, ["vpn", "connect", "error"])).toBeGreaterThanOrEqual(2);
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

  it('returns the generated response and the decision when confidence is high', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.9, shouldAutoRespond: true });

    const result = await service.analyzeTicket(ticket);

    expect(bedrock.generateResponse).toHaveBeenCalledWith(ticket, articles);
    // The fourth argument is the count of similar resolved tickets (a match in its own right);
    // the fifth is the MODEL's own confidence in the reply it just wrote, which is the score.
    expect(bedrock.calculateConfidence).toHaveBeenCalledWith(ticket, articles.length, 20, 1, undefined);
    expect(result).toMatchObject({
      autoResponse: 'Reset your password.',
      confidence: 0.9,
      complexity: 20,
      shouldEscalate: false,
    });
    expect(result.factors.urgency).toBe(20); // high priority
    expect(result.factors.historical).toBe(0); // a similar ticket exists
    expect(storeAutoResponse).toHaveBeenCalledWith(7, expect.objectContaining({ confidence: 0.9 }));
  });

  it('returns the one decision and stores exactly ONE row, never marked applied by the service itself', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.9, shouldAutoRespond: true });
    storeAutoResponse.mockResolvedValue(42);

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldAutoRespond).toBe(true);
    expect(result.autoResponseRowId).toBe(42);
    expect(storeAutoResponse).toHaveBeenCalledTimes(1);
    expect(storeAutoResponse.mock.calls[0][1]).not.toHaveProperty('applied');
  });

  it('decision no: shouldAutoRespond false, still one row (a draft)', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.8, shouldAutoRespond: false });

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldAutoRespond).toBe(false);
    expect(storeAutoResponse).toHaveBeenCalledTimes(1);
  });

  it('cuts the stored and returned text to maxResponseLength (the one clamp)', async () => {
    bedrock.generateResponse.mockResolvedValue({ response: 'x'.repeat(5000), suggestedArticles: [] });
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.9, shouldAutoRespond: true });

    const result = await service.analyzeTicket(ticket);

    // getAISettings falls back to its defaults without a database (maxResponseLength 1000)
    expect(result.autoResponse).toHaveLength(1000);
    expect((storeAutoResponse.mock.calls[0][1] as { response: string }).response).toHaveLength(1000);
  });

  it('escalates when Bedrock says confidence is below its auto-respond threshold', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.3, shouldAutoRespond: false });

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldEscalate).toBe(true);
    expect(result.autoResponse).toBe('Reset your password.');
    expect(storeAutoResponse).toHaveBeenCalledTimes(1);
  });

  it("passes the model's reported confidence through as the score, and says whether a real match backed it", async () => {
    bedrock.generateResponse.mockResolvedValue({
      response: 'Reset your password.',
      confidence: 0.86,
      suggestedArticles: [11],
    });
    bedrock.calculateConfidence.mockImplementation((async (
      _t: unknown,
      _articles: unknown,
      _complexity: unknown,
      _resolved: unknown,
      modelConfidence?: number,
    ) => ({ confidenceScore: modelConfidence ?? 0, shouldAutoRespond: modelConfidence === 0.86 })) as any);

    const result = await service.analyzeTicket(ticket);

    expect(bedrock.calculateConfidence).toHaveBeenCalledWith(ticket, 1, 20, 1, 0.86);
    expect(result.confidence).toBe(0.86);
    expect(result.hasMatch).toBe(true);
    expect(result.shouldAutoRespond).toBe(true);
  });

  it('no real match (no article, no similar resolved ticket) is reported as hasMatch false', async () => {
    jest.spyOn(service as any, 'searchKnowledgeBase').mockResolvedValue([]);
    jest.spyOn(service as any, 'findSimilarResolvedTickets').mockResolvedValue([]);
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0, shouldAutoRespond: false });

    const result = await service.analyzeTicket(ticket);

    expect(bedrock.calculateConfidence).toHaveBeenCalledWith(ticket, 0, 20, 0, undefined);
    expect(result.hasMatch).toBe(false);
    expect(result.shouldAutoRespond).toBe(false);
  });

  it('does not store a response when confidence is zero', async () => {
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0, shouldAutoRespond: false });

    const result = await service.analyzeTicket(ticket);

    expect(result.shouldEscalate).toBe(true);
    expect(storeAutoResponse).not.toHaveBeenCalled();
  });

  it('never auto-responds on a degraded reply, and stores no row for it', async () => {
    bedrock.generateResponse.mockResolvedValue({
      response: "I'm unable to generate an automated response at this time. A support agent will assist you shortly.",
      suggestedArticles: [],
      degraded: true,
    });
    bedrock.calculateConfidence.mockResolvedValue({ confidenceScore: 0.9, shouldAutoRespond: true });

    const result = await service.analyzeTicket(ticket);

    expect(result.degraded).toBe(true);
    expect(result.shouldAutoRespond).toBe(false);
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
      hasMatch: false,
    });
    expect(storeAutoResponse).not.toHaveBeenCalled();
  });
});
