/**
 * Admin Settings Routes
 *
 * Handles company settings, branding, system configuration,
 * email templates, SMTP settings, and SSO configuration
 */

import type { Express } from "express";
import { isAuthenticated } from "../auth";
import { getUserId, requireAdmin } from "../middleware/admin.middleware";
import { storage } from "../storage";

/**
 * Register company settings and branding routes
 */
export function registerSettingsRoutes(app: Express): void {
  // SSO Configuration Routes
  // GET /api/sso/config - Get SSO configuration (admin only)
  app.get("/api/sso/config", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const config = await storage.getSsoConfiguration();
      res.json(config || { clientId: "", clientSecret: "", tenantId: "" });
    } catch (error) {
      console.error("Error fetching SSO configuration:", error);
      res.status(500).json({ message: "Failed to fetch SSO configuration" });
    }
  });

  // GET /api/sso/status - Get SSO status (any authenticated user)
  app.get("/api/sso/status", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getSsoConfiguration();
      const isConfigured = !!(
        config?.clientId &&
        config?.clientSecret &&
        config?.tenantId
      );
      res.json({ configured: isConfigured });
    } catch (error) {
      console.error("Error checking SSO status:", error);
      res.status(500).json({ message: "Failed to check SSO status" });
    }
  });

  // POST /api/sso/config - Update SSO configuration (admin only)
  app.post("/api/sso/config", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const userId = getUserId(req);
      const config = await storage.upsertSsoConfiguration({
        ...req.body,
        updatedBy: userId,
      });
      res.json(config);
    } catch (error) {
      console.error("Error updating SSO configuration:", error);
      res.status(500).json({ message: "Failed to update SSO configuration" });
    }
  });

  // POST /api/sso/test - Test SSO configuration (admin only)
  app.post("/api/sso/test", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const config = await storage.getSsoConfiguration();
      if (!config?.clientId || !config?.clientSecret || !config?.tenantId) {
        return res.status(400).json({ message: "SSO not configured" });
      }

      // Test the configuration by trying to fetch the OpenID configuration
      const metadataUrl = `https://login.microsoftonline.com/${config.tenantId}/v2.0/.well-known/openid-configuration`;

      try {
        const response = await fetch(metadataUrl);
        if (!response.ok) {
          return res.status(400).json({
            message: "Invalid tenant ID or Azure AD configuration",
            details: `Failed to fetch metadata from ${metadataUrl}`,
          });
        }

        const metadata = await response.json();
        res.json({
          success: true,
          message: "SSO configuration is valid",
          issuer: metadata.issuer,
        });
      } catch (fetchError: any) {
        console.error("Error testing SSO config:", fetchError);
        res.status(400).json({
          message: "Failed to connect to Azure AD",
          details: fetchError.message,
        });
      }
    } catch (error) {
      console.error("Error testing SSO configuration:", error);
      res.status(500).json({ message: "Failed to test SSO configuration" });
    }
  });
}
