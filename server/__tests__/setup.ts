/**
 * Jest Test Setup
 *
 * This file runs before each test file and sets up the testing environment.
 */

import { jest, beforeAll, afterAll } from "@jest/globals";

// Mock console methods to reduce noise in tests
const originalConsole = console;

beforeAll(() => {
  // Suppress console.log during tests unless explicitly needed
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterAll(() => {
  // Restore original console
  global.console = originalConsole;
});

// Global test timeout
jest.setTimeout(10000);
