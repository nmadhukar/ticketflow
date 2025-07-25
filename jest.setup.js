import '@testing-library/jest-dom';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.REPL_ID = 'test-repl-id';

// Mock console methods to avoid cluttering test output
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Mock window.location for client tests
delete window.location;
window.location = { href: '', search: '', hostname: 'localhost', protocol: 'http:' };