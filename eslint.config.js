import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "migrations/**",
      "coverage/**",
      ".superpowers/**",
      "playwright-report/**",
      "test-results/**",
      // Scratch folders tests create and remove; one left by a killed run must not fail lint.
      ".tmp-*/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["server/**/*.{ts,js,mjs}", "shared/**/*.ts", "scripts/**/*.{js,mjs,ts}", "docs/**/*.mjs", "*.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/__tests__/**", "jest.setup.js"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    // Preloaded by node (NODE_OPTIONS=--require) as plain CommonJS.
    files: ["e2e/**/*.cjs"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Jest runs this file untransformed as CommonJS (package.json is "type": "module").
    files: ["jest.setup.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      // Unused imports, locals, parameters and catch bindings are errors. Write
      // `catch {` when the error is not used. A leading underscore marks an
      // intentional unused parameter/local (it does not apply to catch bindings).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
        },
      ],
      // Baseline: 786 occurrences at the time this config was added. Fixing them
      // means typing the whole codebase, which is not behaviour-neutral. Kept as
      // a warning so it stays visible; tighten as modules are typed.
      "@typescript-eslint/no-explicit-any": "warn",
      // Baseline: 11 occurrences. Attaching `cause` changes the thrown error
      // object, so those sites are left for the error-handling work.
      "preserve-caught-error": "warn",
    },
  },
);
