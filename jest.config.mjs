/** @type {import('jest').Config} */

// `npm test` passes --runInBand globally because the integration suites share one database.

// ts-jest runs the suites as CommonJS, so override the module settings that
// tsconfig.json (bundler/ESNext, for Vite and tsx) sets. isolatedModules makes
// ts-jest transpile only: type errors are the job of `npm run check`.
const tsJestOptions = (extra = {}) => [
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
];
const tsJest = (extra = {}) => ({
  '^.+.tsx?$': tsJestOptions(extra),
  // sanitize-html depends on htmlparser2 and friends, which ship ES modules
  // only; ts-jest (allowJs) turns them into CommonJS for the test runtime.
  '^.+[\\\\/]node_modules[\\\\/](htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)[\\\\/].+\\.js$':
    tsJestOptions(extra),
});
// Everything in node_modules stays untouched except those ES-module-only packages.
const transformIgnorePatterns = [
  '/node_modules/(?!(htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)/)',
];

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
      transformIgnorePatterns,
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
      transformIgnorePatterns,
      setupFiles: ['<rootDir>/server/__tests__/integration/helpers/env.ts'],
      setupFilesAfterEnv: [
        '<rootDir>/server/__tests__/setup.ts',
        '<rootDir>/server/__tests__/integration/helpers/secretsHook.ts',
      ],
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
