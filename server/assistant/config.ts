import { isPlaceholderSecret, MIN_SECRET_LENGTH } from "../security/secrets";

/**
 * Assistant configuration. Everything is off unless ASSISTANT_ENABLED is exactly "true".
 *
 * When it is on, the two token secrets (sessionToken.ts) are required in every environment, not
 * only production: there is no development fallback, because a fallback is a value in the source
 * tree that would sign tokens. Problems name variables, never values.
 */

export const ASSISTANT_SECRET_NAMES = [
  "ASSISTANT_SESSION_SECRET",
  "ASSISTANT_SESSION_SECRET_PREVIOUS",
  "ASSISTANT_AGENT_SECRET",
  "ASSISTANT_AGENT_SECRET_PREVIOUS",
] as const;

/** Secrets the assistant ones must differ from: reusing one would let either forge the other. */
const OTHER_SECRETS = ["SESSION_SECRET", "JWT_SECRET"] as const;

export const DEFAULT_RUN_MAX_SECONDS = 15 * 60;
const RUN_MAX_SECONDS_RANGE = { min: 60, max: 60 * 60 };

export function isAssistantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASSISTANT_ENABLED === "true";
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Current secret first, then the previous one when a rotation is in progress. */
export interface AssistantSecrets {
  session: string[];
  agent: string[];
}

export function assistantConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isAssistantEnabled(env)) return [];
  const problems: string[] = [];

  for (const base of ["ASSISTANT_SESSION_SECRET", "ASSISTANT_AGENT_SECRET"] as const) {
    const previousName = `${base}_PREVIOUS`;
    if (!read(env, base)) {
      problems.push(`${base} must be set when ASSISTANT_ENABLED=true.`);
      if (read(env, previousName)) problems.push(`${previousName} is set without ${base}.`);
    }
  }

  for (const name of ASSISTANT_SECRET_NAMES) {
    const value = read(env, name);
    if (!value) continue;
    if (isPlaceholderSecret(value)) {
      problems.push(`${name} is still a placeholder value. Set a random secret (for example openssl rand -base64 32).`);
    } else if (value.length < MIN_SECRET_LENGTH) {
      problems.push(`${name} is too short: use at least ${MIN_SECRET_LENGTH} characters (for example openssl rand -base64 32).`);
    }
  }

  // Every assistant secret must be distinct from every other secret, assistant or not.
  // The assistant names come first, so every pair below has an assistant secret on the left.
  const named = [...ASSISTANT_SECRET_NAMES, ...OTHER_SECRETS]
    .map((name) => ({ name, value: read(env, name) }))
    .filter((entry) => entry.value !== undefined);
  for (let i = 0; i < ASSISTANT_SECRET_NAMES.length && i < named.length; i++) {
    const a = named[i];
    if (!(ASSISTANT_SECRET_NAMES as readonly string[]).includes(a.name)) break;
    for (const b of named.slice(i + 1)) {
      if (a.value === b.value) problems.push(`${a.name} must differ from ${b.name}.`);
    }
  }

  const internalPort = env.ASSISTANT_INTERNAL_PORT?.trim();
  if (internalPort) {
    const n = Number(internalPort);
    const publicPort = Number(env.PORT?.trim() || "5000");
    if (!/^\d+$/.test(internalPort) || n < 1 || n > 65535) {
      problems.push("ASSISTANT_INTERNAL_PORT must be an integer from 1 to 65535.");
    } else if (n === publicPort) {
      problems.push("ASSISTANT_INTERNAL_PORT must differ from PORT: the internal listener is never public.");
    }
  }

  const runMax = env.ASSISTANT_RUN_MAX_SECONDS?.trim();
  if (runMax) {
    const n = Number(runMax);
    if (!/^\d+$/.test(runMax) || n < RUN_MAX_SECONDS_RANGE.min || n > RUN_MAX_SECONDS_RANGE.max) {
      problems.push(
        `ASSISTANT_RUN_MAX_SECONDS must be an integer from ${RUN_MAX_SECONDS_RANGE.min} to ${RUN_MAX_SECONDS_RANGE.max}.`,
      );
    }
  }
  return problems;
}

/** The secrets, for an enabled assistant whose configuration has no problems. Throws otherwise. */
export function readAssistantSecrets(env: NodeJS.ProcessEnv = process.env): AssistantSecrets {
  const problems = assistantConfigProblems(env);
  if (!isAssistantEnabled(env)) problems.unshift("The assistant is not enabled (ASSISTANT_ENABLED=true).");
  if (problems.length > 0) throw new Error(problems.join(" "));
  const pair = (base: string) => [read(env, base)!, read(env, `${base}_PREVIOUS`)].filter((v): v is string => !!v);
  return { session: pair("ASSISTANT_SESSION_SECRET"), agent: pair("ASSISTANT_AGENT_SECRET") };
}

export function readRunMaxSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ASSISTANT_RUN_MAX_SECONDS?.trim();
  return raw ? Number(raw) : DEFAULT_RUN_MAX_SECONDS;
}
