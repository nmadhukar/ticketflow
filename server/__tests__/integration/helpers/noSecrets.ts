import type { NextFunction, Request, Response } from "express";

const FORBIDDEN = [
  "password",
  "passwordResetToken",
  "passwordResetExpires",
  "failedLoginAttempts",
  "lockedUntil",
  "lastFailedLoginAt",
  "passwordChangedAt",
  "keyHash",
  "clientSecret",
  "awsSecretAccessKey",
  "bedrockSecretAccessKey",
  "mailtrapToken",
  "mtToken",
  // R33: an invitation token lets anyone register as the invited role.
  "invitationToken",
];

/** Returns the JSON path of every forbidden key found anywhere in `body`. */
export function findSecrets(body: unknown, path = "$"): string[] {
  if (Array.isArray(body))
    return body.flatMap((v, i) => findSecrets(v, `${path}[${i}]`));
  if (body && typeof body === "object")
    return Object.entries(body).flatMap(([k, v]) => {
      // A validation error names the FIELD that failed (`fieldErrors: { password: ["Required"] }`):
      // its keys are field names (not flagged) but its values are still scanned.
      if (k === "fieldErrors" && v && typeof v === "object" && !Array.isArray(v))
        return Object.values(v).flatMap((fieldValue) => findSecrets(fieldValue, `${path}.fieldErrors`));
      return (FORBIDDEN.includes(k) ? [`${path}.${k}`] : []).concat(
        findSecrets(v, `${path}.${k}`)
      );
    });
  return [];
}

const recorded: Array<{ url: string; body: unknown }> = [];

/** Test-only: called by createTestApp's middleware for every res.json body. */
export function recordResponse(url: string, body: unknown): void {
  recorded.push({ url, body });
}

/**
 * Test-only middleware: records every res.json body for assertNoSecretsRecorded.
 * createTestApp installs it; any other app a test builds by hand (express())
 * must `app.use(recordJsonResponses)` first, or the secrets hook does not see it.
 */
export function recordJsonResponses(req: Request, res: Response, next: NextFunction): void {
  const realJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    recordResponse(`${req.method} ${req.originalUrl}`, body);
    return realJson(body);
  }) as typeof res.json;
  next();
}

/**
 * Throws if any JSON response recorded since the last call contained a
 * forbidden key. Installed as a global afterEach for the integration project.
 */
export function assertNoSecretsRecorded(): void {
  const batch = recorded.splice(0, recorded.length);
  const leaks = batch.flatMap(({ url, body }) =>
    findSecrets(body).map((p) => `${url} -> ${p}`)
  );
  if (leaks.length) {
    throw new Error(`Secrets in API responses:\n${leaks.join("\n")}`);
  }
}

export function clearRecordedResponses(): void {
  recorded.length = 0;
}
