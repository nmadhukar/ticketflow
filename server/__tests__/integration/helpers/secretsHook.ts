// Jest setupFilesAfterEnv entry for the integration project: after every test,
// fail if any JSON response the app produced contained a secret field.
import { afterEach, beforeEach } from "@jest/globals";
import { assertNoSecretsRecorded, clearRecordedResponses } from "./noSecrets";

beforeEach(() => clearRecordedResponses());
afterEach(() => assertNoSecretsRecorded());
