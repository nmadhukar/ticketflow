/**
 * Admin Routes Module
 *
 * Central registration point for all admin routes.
 * Routes are organized by domain for better maintainability.
 */

import type { Express } from "express";
import { registerSettingsRoutes } from "./settings";
import { registerCompanySettingsRoutes } from "./companySettings";
// Import other route modules as they are created
// import { registerUsersRoutes } from "./users";
// import { registerKnowledgeRoutes } from "./knowledge";
// import { registerHelpRoutes } from "./help";
// etc.

/**
 * Register all admin routes
 *
 * This function should be called from the main routes.ts file
 * to register all administrative endpoints.
 */
export function registerAdminRoutes(app: Express): void {
  // Register company settings (branding, tickets, preferences, email)
  registerCompanySettingsRoutes(app);

  // Register remaining settings routes (SSO, email templates, etc.)
  registerSettingsRoutes(app);

  // Register other admin route modules here as they are created:
  // registerUsersRoutes(app);
  // registerKnowledgeRoutes(app);
  // registerHelpRoutes(app);
  // registerInvitationsRoutes(app);
  // registerDepartmentsRoutes(app);
  // registerEscalationRoutes(app);
  // registerLearningQueueRoutes(app);
  // registerApiKeysRoutes(app);
}
