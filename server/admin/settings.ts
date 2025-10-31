/**
 * Admin Settings Routes
 *
 * Handles company settings, branding, system configuration,
 * email templates, SMTP settings, and SSO configuration
 */

import type { Express } from "express";
import { storage } from "../storage";
import {
  insertCompanySettingsSchema,
  insertApiKeySchema,
} from "@shared/schema";
import { TICKET_PRIORITIES } from "@shared/constants";
import { z } from "zod";
import { getUserId, requireAdmin, isAdmin } from "./middleware";
import { isAuthenticated } from "../auth";

/**
 * Register company settings and branding routes
 */
export function registerSettingsRoutes(app: Express): void {
  // Company Settings Routes
  // GET /api/company-settings - Get company settings (any authenticated user)
  app.get("/api/company-settings", isAuthenticated, async (req, res) => {
    try {
      const settings = await storage.getCompanySettings();
      res.json(
        settings || {
          companyName: "TicketFlow",
          primaryColor: "#3b82f6",
          ticketPrefix: "TKT",
          defaultTicketPriority: "medium",
          autoCloseDays: 7,
          timezone: "UTC",
          dateFormat: "YYYY-MM-DD",
          timeFormat: "24h",
          maxFileUploadSize: 10,
          maintenanceMode: false,
        }
      );
    } catch (error) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: "Failed to fetch company settings" });
    }
  });

  // PATCH /api/company-settings - Update company settings (admin only)
  app.patch("/api/company-settings", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const userId = getUserId(req);

      // Validate userId exists before using it as updatedBy
      if (userId) {
        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(400).json({
            message: `Invalid userId: ${userId} does not exist`,
          });
        }
      }

      // Validate priority if provided
      if (req.body.defaultTicketPriority) {
        if (!TICKET_PRIORITIES.includes(req.body.defaultTicketPriority)) {
          return res.status(400).json({
            message: `Invalid priority. Must be one of: ${TICKET_PRIORITIES.join(
              ", "
            )}`,
          });
        }
      }

      // Validate and clamp autoCloseDays
      if (req.body.autoCloseDays !== undefined) {
        const days = Number(req.body.autoCloseDays);
        if (isNaN(days) || (days !== null && days <= 0)) {
          return res.status(400).json({
            message: "autoCloseDays must be a positive number or null",
          });
        }
        // Allow null to disable auto-close, or clamp to 1-365
        if (days === 0) {
          req.body.autoCloseDays = null;
        } else {
          req.body.autoCloseDays = Math.max(1, Math.min(365, days));
        }
      }

      // Validate maxFileUploadSize
      if (req.body.maxFileUploadSize !== undefined) {
        const size = Number(req.body.maxFileUploadSize);
        if (isNaN(size) || size < 1 || size > 100) {
          return res.status(400).json({
            message: "maxFileUploadSize must be between 1 and 100 MB",
          });
        }
      }

      const settingsData = insertCompanySettingsSchema.parse(req.body);
      const settings = await storage.updateCompanySettings(
        settingsData,
        userId
      );
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid settings data", errors: error.errors });
      }
      console.error("Error updating company settings:", error);
      res.status(500).json({ message: "Failed to update company settings" });
    }
  });

  // POST /api/company-settings/logo - Upload company logo (admin only)
  app.post(
    "/api/company-settings/logo",
    isAuthenticated,
    async (req: any, res) => {
      try {
        if (!(await requireAdmin(req, res))) return;

        const { fileName, fileType, fileData } = req.body;

        // Validate fileData exists
        if (!fileData || typeof fileData !== "string") {
          return res.status(400).json({
            message: "File data is required",
          });
        }

        // Validate file type
        if (!["image/jpeg", "image/jpg", "image/png"].includes(fileType)) {
          return res.status(400).json({
            message: "Invalid file type. Only JPG and PNG are allowed.",
          });
        }

        // Validate base64 size using maxFileUploadSize from company settings
        // Base64 is ~33% larger than binary
        const estimatedBinarySize = (fileData.length * 3) / 4;

        // Get max file upload size from company settings
        const companySettings = await storage.getCompanySettings();
        const maxSizeMB = companySettings?.maxFileUploadSize || 10;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;

        if (estimatedBinarySize > maxSizeBytes) {
          return res.status(400).json({
            message: `File size exceeds ${maxSizeMB}MB limit`,
          });
        }

        // Validate base64 format
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(fileData)) {
          return res.status(400).json({
            message: "Invalid base64 file data format",
          });
        }

        // Convert base64 to data URL
        const logoUrl = `data:${fileType};base64,${fileData}`;

        const userId = getUserId(req);

        // Validate userId exists before using it as updatedBy
        if (userId) {
          const user = await storage.getUser(userId);
          if (!user) {
            return res.status(400).json({
              message: `Invalid userId: ${userId} does not exist`,
            });
          }
        }

        const settings = await storage.updateCompanySettings(
          { logoUrl },
          userId
        );
        res.json(settings);
      } catch (error) {
        console.error("Error uploading logo:", error);
        res.status(500).json({ message: "Failed to upload logo" });
      }
    }
  );

  // SMTP Settings Routes (admin only)
  // GET /api/smtp/settings - Get SMTP settings
  app.get("/api/smtp/settings", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const settings = await storage.getSmtpSettings();
      if (!settings) return res.json({});
      res.json({
        awsAccessKeyId: settings.awsAccessKeyId || "",
        awsRegion: settings.awsRegion || "us-east-1",
        fromEmail: settings.fromEmail,
        fromName: settings.fromName || "TicketFlow",
        hasAwsSecret: !!settings.awsSecretAccessKey,
      });
    } catch (error) {
      console.error("Error fetching SMTP settings:", error);
      res.status(500).json({ message: "Failed to fetch SMTP settings" });
    }
  });

  // POST /api/smtp/settings - Update SMTP settings
  app.post("/api/smtp/settings", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const userId = getUserId(req);
      const current = await storage.getSmtpSettings();
      const merged = {
        awsAccessKeyId:
          req.body.awsAccessKeyId ?? current?.awsAccessKeyId ?? "",
        awsSecretAccessKey:
          req.body.awsSecretAccessKey !== undefined &&
          req.body.awsSecretAccessKey !== ""
            ? req.body.awsSecretAccessKey
            : current?.awsSecretAccessKey ?? "",
        awsRegion: req.body.awsRegion ?? current?.awsRegion ?? "us-east-1",
        fromEmail: req.body.fromEmail ?? current?.fromEmail ?? "",
        fromName: req.body.fromName ?? current?.fromName ?? "TicketFlow",
        useAwsSes: true,
        isActive: true,
      };
      const saved = await storage.updateSmtpSettings(merged as any, userId);
      res.json({
        awsAccessKeyId: saved.awsAccessKeyId || "",
        awsRegion: saved.awsRegion || "us-east-1",
        fromEmail: saved.fromEmail,
        fromName: saved.fromName || "TicketFlow",
        hasAwsSecret: !!saved.awsSecretAccessKey,
      });
    } catch (error) {
      console.error("Error updating SMTP settings:", error);
      res.status(500).json({ message: "Failed to update SMTP settings" });
    }
  });

  // POST /api/smtp/test - Test SMTP configuration
  app.post("/api/smtp/test", isAuthenticated, async (req, res) => {
    try {
      if (!(await requireAdmin(req as any, res))) return;

      const { testEmail } = req.body;

      if (!testEmail) {
        return res
          .status(400)
          .json({ message: "Test email address is required" });
      }

      const smtpSettings = await storage.getSmtpSettings();

      if (!smtpSettings) {
        return res
          .status(400)
          .json({ message: "SMTP settings not configured" });
      }

      // Import sendTestEmail dynamically to avoid circular dependencies
      const { sendTestEmail } = await import("../ses");

      const success = await sendTestEmail(
        "",
        0,
        smtpSettings.awsAccessKeyId || "",
        smtpSettings.awsSecretAccessKey || "",
        smtpSettings.awsRegion || "us-east-1",
        smtpSettings.fromEmail,
        smtpSettings.fromName,
        testEmail
      );

      if (success) {
        res.json({ message: "Test email sent successfully" });
      } else {
        res.status(500).json({
          message:
            "Failed to send test email. Please check your AWS credentials and ensure the email addresses are verified in SES.",
        });
      }
    } catch (error) {
      console.error("SMTP test error:", error);
      res.status(500).json({ message: "Failed to test SMTP configuration" });
    }
  });

  // Email Template Routes (admin only)
  // GET /api/email-templates - Get all email templates
  app.get("/api/email-templates", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const templates = await storage.getEmailTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  // PUT /api/email-templates/:name - Update email template
  app.put(
    "/api/email-templates/:name",
    isAuthenticated,
    async (req: any, res) => {
      try {
        if (!(await requireAdmin(req, res))) return;

        const userId = getUserId(req);
        const template = await storage.updateEmailTemplate(
          req.params.name,
          req.body,
          userId
        );
        res.json(template);
      } catch (error) {
        console.error("Error updating email template:", error);
        res.status(500).json({ message: "Failed to update email template" });
      }
    }
  );

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
