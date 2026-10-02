/**
 * Startup seeding with a demo gate.
 *
 * Always (every environment): the passwordless system user, the default email
 * templates, deactivation of leftover demo logins, and the bootstrap admin (only if no admin exists and
 * ADMIN_EMAIL/ADMIN_PASSWORD are set).
 *
 * Only when SEED_DEMO_DATA === "true": demo users with fixed passwords,
 * sample departments, teams, tickets, knowledge articles, help documents and
 * learning tickets.
 */
export interface SeederSet {
  /** Startup data fix-up: legacy role "user" becomes "agent". Runs first. */
  migrateLegacyRoles?(): Promise<unknown>;
  /** Startup data fix-up: consistent assignee columns on tickets. Runs right after the role fix-up. */
  migrateAssigneeTypes?(): Promise<unknown>;
  systemUser(): Promise<void>;
  deactivateDemoAccounts(env: NodeJS.ProcessEnv): Promise<unknown>;
  bootstrapAdmin(env: NodeJS.ProcessEnv): Promise<void>;
  emailTemplates(): Promise<void>;
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
  return {
    migrateLegacyRoles,
    migrateAssigneeTypes,
    systemUser: seedSystemUser,
    deactivateDemoAccounts,
    bootstrapAdmin: seedBootstrapAdmin,
    emailTemplates: seed.seedEmailTemplates,
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

  // Required for the app to work: a failure here stops startup.
  // Role data fix-up first, before anything reads roles.
  await s.migrateLegacyRoles?.();
  await s.migrateAssigneeTypes?.();
  await s.systemUser();
  await s.emailTemplates();
  // Old demo logins must be off before the "is there an admin?" check.
  await s.deactivateDemoAccounts(env);
  await s.bootstrapAdmin(env);

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
  for (const [name, run] of demo) {
    try {
      await run();
    } catch (error) {
      console.error(`Failed to seed demo ${name}:`, error);
    }
  }
}
