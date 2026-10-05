# Server tests

Jest runs unit tests without a database, integration tests against a dedicated PostgreSQL test database, and client tests. Model calls in integration tests are faked at the OpenRouter HTTP boundary; the real model client, pricing, budget, and workflow code still run.

## Running

```bash
npm run test:unit
npm run test:db:up
npm run test:db:push
npm run test:integration
npm run check
```

`TEST_DATABASE_URL` must name a disposable database containing `test`. Integration helpers truncate its tables. Never aim them at a database you care about.

## OpenRouter HTTP fake

`mocks/openRouter.mock.ts` answers model metadata and chat completions. It does not duplicate production parsing or cost rules:

```typescript
import { aiModelMock, MOCK_MODEL_ID } from "../mocks/openRouter.mock";

beforeEach(() => aiModelMock.reset());
aiModelMock.handler = (prompt) => '{"response":"..."}';
expect(aiModelMock.totalCalls()).toBe(1);
```

Store `modelId: MOCK_MODEL_ID` in `ai_settings` and enable the provider for tests that call a model. Restore `OPENROUTER_API_KEY` and `jest` spies after the suite. Live provider smoke checks run separately from Jest and use a fixed harmless prompt, never ticket content.

Integration tests should create their own users and tickets with `helpers/fixtures.ts`; no test may rely on rows left by another. Assert both status and error code for failures. Logs must not contain prompt, provider response, or credential text.
