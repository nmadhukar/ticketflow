/**
 * Admin Settings Routes
 *
 * Handles company settings, branding, system configuration,
 * email templates, SMTP settings, and SSO configuration
 */

import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../services/auth";
import { getUserId, requireAdmin } from "../middleware/admin.middleware";
import { storage } from "../storage";
import { HttpError } from "../http/errors";
import type { SsoConfiguration } from "@shared/schema";

/** What an admin may see of the SSO config: the secret is only ever reported as set or not. */
function toPublicSsoConfig(config: SsoConfiguration | undefined) {
  return {
    clientId: config?.clientId ?? "",
    tenantId: config?.tenantId ?? "",
    hasClientSecret: !!config?.clientSecret,
  };
}

const ssoConfigBody = z.object({
  clientId: z.string().trim().max(255).optional().nullable(),
  tenantId: z.string().trim().max(255).optional().nullable(),
  // Absent, null or blank keeps the stored secret; a non-empty value replaces it.
  clientSecret: z.string().max(1024).optional().nullable(),
});

/**
 * Register company settings and branding routes
 */
export function registerSettingsRoutes(app: Express): void {
  // SSO Configuration Routes
  // GET /api/sso/config - Get SSO configuration (admin only). Never returns clientSecret.
  app.get("/api/sso/config", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const config = await storage.getSsoConfiguration();
      res.json(toPublicSsoConfig(config));
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
  app.post("/api/sso/config", isAuthenticated, async (req: any, res, next) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const parsed = ssoConfigBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(
          400,
          "validation_failed",
          "Invalid input",
          parsed.error.flatten()
        );
      }
      const body = parsed.data;
      const current = await storage.getSsoConfiguration();
      const submitted = body.clientSecret?.trim();
      const config = await storage.upsertSsoConfiguration({
        clientId: body.clientId ?? current?.clientId ?? null,
        tenantId: body.tenantId ?? current?.tenantId ?? null,
        clientSecret: submitted ? submitted : current?.clientSecret ?? null,
        updatedBy: getUserId(req),
      });
      res.json(toPublicSsoConfig(config));
    } catch (error) {
      next(error);
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
