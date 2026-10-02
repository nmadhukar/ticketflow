/** @type {import('jest').Config} */

// ts-jest runs the suites as CommonJS, so override the module settings that
// tsconfig.json (bundler/ESNext, for Vite and tsx) sets. isolatedModules makes
// ts-jest transpile only: type errors are the job of `npm run check`.
const tsJest = (extra = {}) => ({
  '^.+\.tsx?$': [
    'ts-jest',
    {
      tsconfig: {
        isolatedModules: true,
        module: 'commonjs',
        moduleResolution: 'node',
        target: 'es2022',
        esModuleInterop: true,
        allowJs: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        baseUrl: '.',
        paths: {
          '@/*': ['./client/src/*'],
          '@shared/*': ['./shared/*'],
        },
        ...extra,
      },
    },
  ],
});

const common = {
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@/(.*)$': '<rootDir>/client/src/$1',
    // tsconfig baseUrl is '.', so some server files import 'server/...' bare
    '^server/(.*)$': '<rootDir>/server/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
};

export default {
  collectCoverageFrom: [
    'server/**/*.ts',
    '!server/**/*.d.ts',
    '!server/__tests__/**',
    '!server/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  projects: [
    {
      ...common,
      displayName: 'unit',
      testEnvironment: 'node',
      roots: ['<rootDir>/server'],
      testMatch: [
        '<rootDir>/server/__tests__/unit/**/*.test.ts',
        '<rootDir>/server/__tests__/ai/**/*.test.ts',
        '<rootDir>/server/**/*.unit.test.ts',
        '<rootDir>/server/__tests__/*.test.ts',
      ],
      transform: tsJest(),
      setupFilesAfterEnv: ['<rootDir>/server/__tests__/setup.ts'],
      testTimeout: 10000,
    },
    {
      ...common,
      displayName: 'integration',
      testEnvironment: 'node',
      roots: ['<rootDir>/server'],
      testMatch: ['<rootDir>/server/__tests__/integration/**/*.test.ts'],
      transform: tsJest(),
      setupFiles: ['<rootDir>/server/__tests__/integration/helpers/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/server/__tests__/setup.ts'],
      testTimeout: 30000,
    },
    {
      ...common,
      displayName: 'client',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/client/src'],
      testMatch: ['<rootDir>/client/src/**/*.test.{ts,tsx}'],
      transform: tsJest({ jsx: 'react-jsx' }),
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    },
  ],
};
