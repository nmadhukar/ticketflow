const FORBIDDEN = [
  "password",
  "passwordResetToken",
  "passwordResetExpires",
  "failedLoginAttempts",
  "lockedUntil",
  "keyHash",
  "clientSecret",
  "awsSecretAccessKey",
];

/** Returns the JSON path of every forbidden key found anywhere in `body`. */
export function findSecrets(body: unknown, path = "$"): string[] {
  if (Array.isArray(body))
    return body.flatMap((v, i) => findSecrets(v, `${path}[${i}]`));
  if (body && typeof body === "object")
    return Object.entries(body).flatMap(([k, v]) =>
      (FORBIDDEN.includes(k) ? [`${path}.${k}`] : []).concat(
        findSecrets(v, `${path}.${k}`)
      )
    );
  return [];
}

const recorded: Array<{ url: string; body: unknown }> = [];

/** Test-only: called by createTestApp's middleware for every res.json body. */
export function recordResponse(url: string, body: unknown): void {
  recorded.push({ url, body });
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
