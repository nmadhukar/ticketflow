import { describe, it, expect, jest } from '@jest/globals';

// aiAutoResponse imports the database at module load; the helper under test is pure.
jest.mock('../../storage/db', () => ({ db: {}, pool: {} }));

import { calculateConfidence } from '../../services/ai/aiAutoResponse';

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
