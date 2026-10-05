import { describeError } from "../http/errors";

/**
 * Startup seeding with a demo gate.
 *
 * Always (every environment), in this order (M8):
 *  1. deactivation of leftover demo logins (first: nothing may run while a
 *     published demo password still signs in);
 *  2. the data fix-ups: legacy role "user" -> agent, assignee columns, legacy
 *     API keys;
 *  3. the passwordless system user and the AI system user;
 *  4. the default email templates, then the invitation template fix-up (best effort, both);
 *  5. the bootstrap admin (only if no admin exists and ADMIN_EMAIL/ADMIN_PASSWORD are set).
 * A failure in any step but 4 stops startup (StartupStepError, one line).
 *
 * Only when SEED_DEMO_DATA === "true", best effort: demo users with fixed
 * passwords, sample departments, teams, tickets, knowledge articles, help
 * documents and learning tickets.
 */

/** A required startup step failed: the server must not start. The message is one log line. */
export class StartupStepError extends Error {
  constructor(
    public readonly step: string,
    cause: unknown
  ) {
    super(`Startup refused: required step "${step}" failed [${describeError(cause)}]`, { cause });
    this.name = "StartupStepError";
  }
}

/** The one log line server/index.ts prints before exiting when seeding throws. */
export function startupFailureLine(error: unknown): string {
  return error instanceof StartupStepError
    ? error.message
    : `Startup refused: seeding failed [${describeError(error)}]`;
}

async function required(step: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    throw new StartupStepError(step, error);
  }
}

async function bestEffort(step: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`Startup step "${step}" failed; continuing without it [${describeError(error)}]`);
  }
}

export interface SeederSet {
  /** Startup data fix-up: legacy role "user" becomes "agent". Runs right after the demo deactivation. */
  migrateLegacyRoles?(): Promise<unknown>;
  /** Startup data fix-up: consistent assignee columns on tickets. Runs right after the role fix-up. */
  migrateAssigneeTypes?(): Promise<unknown>;
  /** Startup data fix-up: API keys stored without a hash are switched off. Runs right after the other fix-ups. */
  deactivateLegacyApiKeys?(): Promise<unknown>;
  systemUser(): Promise<void>;
  /** The "ai-assistant" account AI comments are authored by. Runs always (not behind SEED_DEMO_DATA). */
  aiSystemUser(): Promise<unknown>;
  deactivateDemoAccounts(env: NodeJS.ProcessEnv): Promise<unknown>;
  bootstrapAdmin(env: NodeJS.ProcessEnv): Promise<void>;
  emailTemplates(): Promise<void>;
  /** Startup data fix-up: a stored `user_invitation` still equal to the OLD default (with the Department line) becomes the new default. Runs right after emailTemplates. */
  updateOldInvitationTemplate?(): Promise<unknown>;
  /** R90: text for documents uploaded before extraction existed. Started after the bootstrap admin, not awaited: never blocks or fails boot. */
  backfillDocumentText?(): Promise<unknown>;
  demoUsers(): Promise<void>;
  departments(): Promise<void>;
  teams(): Promise<void>;
  tickets(): Promise<void>;
  knowledge(): Promise<void>;
  helpAndDocs(): Promise<void>;
  knowledgeLearning(): Promise<void>;
}

async function defaultSeeders(): Promise<SeederSet> {
  const seed = await import("./index");
  const { seedSystemUser } = await import("./seedUsers");
  const { seedBootstrapAdmin } = await import("./bootstrapAdmin");
  const { deactivateDemoAccounts } = await import("./deactivateDemoAccounts");
  const { migrateLegacyRoles } = await import("./legacyRoleFixup");
  const { migrateAssigneeTypes } = await import("./assigneeTypeFixup");
  const { deactivateLegacyApiKeys } = await import("./legacyApiKeyFixup");
  const { ensureAiSystemUser } = await import("../utils/aiSystemUser");
  const { updateOldInvitationTemplate } = await import("./invitationTemplateFixup");
  const { backfillDocumentText } = await import("../services/documents/backfillText");
  return {
    backfillDocumentText: () => backfillDocumentText(),
    aiSystemUser: ensureAiSystemUser,
    migrateLegacyRoles,
    migrateAssigneeTypes,
    deactivateLegacyApiKeys,
    systemUser: seedSystemUser,
    deactivateDemoAccounts,
    bootstrapAdmin: seedBootstrapAdmin,
    emailTemplates: seed.seedEmailTemplates,
    updateOldInvitationTemplate,
    demoUsers: seed.seedUsers,
    departments: seed.seedDepartments,
    teams: seed.seedTeams,
    tickets: seed.seedTickets,
    knowledge: seed.seedKnowledgeArticles,
    helpAndDocs: seed.seedHelpAndDocs,
    knowledgeLearning: seed.seedKnowledgeLearning,
  };
}

export async function runSeeders(
  env: NodeJS.ProcessEnv = process.env,
  seeders?: SeederSet
): Promise<void> {
  const s = seeders ?? (await defaultSeeders());

  // Security first (M8): old demo logins off before anything else runs, and in
  // particular before the "is there an admin?" check.
  await required("demo account deactivation", () => s.deactivateDemoAccounts(env));
  // Data fix-ups, before anything reads roles, assignees or keys.
  if (s.migrateLegacyRoles) await required("legacy role fix-up", s.migrateLegacyRoles);
  if (s.migrateAssigneeTypes) await required("assignee type fix-up", s.migrateAssigneeTypes);
  if (s.deactivateLegacyApiKeys) await required("legacy API key fix-up", s.deactivateLegacyApiKeys);
  await required("system user", s.systemUser);
  await required("AI system user", s.aiSystemUser);
  // Default templates are data, not security: a failure is logged and startup goes on.
  await bestEffort("default email templates", s.emailTemplates);
  if (s.updateOldInvitationTemplate) await bestEffort("invitation template update", s.updateOldInvitationTemplate);
  await required("bootstrap admin", () => s.bootstrapAdmin(env));
  // Best effort and NOT awaited (R90): parsing old uploads must not hold up or stop the server.
  if (s.backfillDocumentText) void bestEffort("document text backfill", s.backfillDocumentText);

  if (env.SEED_DEMO_DATA !== "true") return;

  console.log("SEED_DEMO_DATA=true: seeding demo data");
  const demo: Array<[string, () => Promise<void>]> = [
    ["users", s.demoUsers],
    ["departments", s.departments],
    ["teams", s.teams],
    ["tickets", s.tickets],
    ["knowledge articles", s.knowledge],
    ["help and docs", s.helpAndDocs],
    ["knowledge learning", s.knowledgeLearning],
  ];
  for (const [name, run] of demo) await bestEffort(`demo ${name}`, run);
}
