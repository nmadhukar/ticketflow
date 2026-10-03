# Server tests

Three Jest projects (see `jest.config.mjs`): `unit` (no database), `integration` (a real
PostgreSQL, run in band) and `client`. Nothing here calls AWS: Bedrock is faked at the SDK boundary.

## Layout

```
server/__tests__/
├── unit/                 # Pure logic, no database (run with the DB variables unset)
├── integration/          # Real Express app + real PostgreSQL
│   ├── helpers/          # testApp, testDb, fixtures, mcpClient, secrets hooks
│   ├── mcp/              # MCP tool tests (over the real /api/mcp endpoint)
│   └── ai.routes.test.ts # AI routes, auto-response, analytics, log-redaction
├── mocks/
│   └── aws-bedrock.mock.ts   # Bedrock fake (see below)
├── fixtures/ses/         # Recorded SNS and SES payloads for inbound email
├── utils/                # snsTestSigner.ts, test-data-generator.ts
└── setup.ts
```

## Running

```bash
npm run test:unit                       # needs no database
export TEST_DATABASE_URL=postgres://test:test@localhost:55433/ticketflow_test
npm run test:db:push                    # create the schema in the test database
npm run test:integration                # or: npx jest --runInBand
npm run check                           # tsc for app, tests and e2e
```

Never point `TEST_DATABASE_URL` at a database you care about: the integration helpers truncate tables.

## AWS Bedrock mock

`mocks/aws-bedrock.mock.ts` fakes AWS at the SDK boundary (`BedrockRuntimeClient.prototype.send`),
so the real `bedrockIntegration`, cost monitoring and `calculateConfidence` run. It re-implements
no production rule:

```typescript
import { bedrockMock, MOCK_MODEL_ID } from './mocks/aws-bedrock.mock';

beforeEach(() => bedrockMock.reset());               // after any jest.restoreAllMocks()
bedrockMock.handler = (prompt) => '{"response":"..."}'; // or return an Error to make the call throw
expect(bedrockMock.totalCalls()).toBe(0);            // prompts seen: bedrockMock.prompts / seen()
```

Store `bedrockModelId: MOCK_MODEL_ID` in the Bedrock settings so the Claude reply format is used.
See `integration/ai.routes.test.ts`.

## Conventions

- Each integration test creates its own users and tickets through `helpers/fixtures.ts`; none may
  depend on the order of another test or on rows an earlier test left behind.
- Assert status AND error code (`error` field) for failures.
- Error text from a failing call must never appear in a log line; the log tests plant a marker
  string and assert it is absent.
- `bedrock-api.test.ts` is the one suite that can talk to real AWS, and only with
  `RUN_INTEGRATION_TESTS=true` and real credentials. It is skipped otherwise.
