import type { Express } from "express";
import { storage } from "../storage";
import {
  TICKET_PRIORITIES,
  EMAIL_PROVIDERS,
  DEFAULT_COMPANY,
} from "@shared/constants";
import { SaveEmailSettingsSchema, TestEmailSchema } from "@shared/email";
import { getEmailAdapter } from "../email/adapters";
import { getUserId, isAdmin } from "../middleware/admin.middleware";
import { isAuthenticated } from "../auth";

export function registerCompanySettingsRoutes(app: Express): void {
  // GET /api/company-settings/branding - scoped fetch
  app.get(
    "/api/company-settings/branding",
    isAuthenticated,
    async (req, res) => {
      try {
        const s = await storage.getCompanySettings();
        res.json({
          companyName: s?.companyName ?? "TicketFlow",
          logoUrl: s?.logoUrl ?? null,
          primaryColor: s?.primaryColor ?? "#3b82f6",
        });
      } catch (error) {
        console.error("Error fetching branding settings:", error);
        res.status(500).json({ message: "Failed to fetch branding settings" });
      }
    }
  );

  // GET /api/company-settings/tickets - scoped fetch
  app.get(
    "/api/company-settings/tickets",
    isAuthenticated,
    async (req, res) => {
      try {
        const s = await storage.getCompanySettings();
        res.json({
          ticketPrefix: s?.ticketPrefix ?? "TKT",
          defaultTicketPriority: s?.defaultTicketPriority ?? "medium",
          autoCloseDays: s?.autoCloseDays ?? 7,
        });
      } catch (error) {
        console.error("Error fetching ticket settings:", error);
        res.status(500).json({ message: "Failed to fetch ticket settings" });
      }
    }
  );

  // GET /api/company-settings/preferences - scoped fetch
  app.get(
    "/api/company-settings/preferences",
    isAuthenticated,
    async (req, res) => {
      try {
        const s = await storage.getCompanySettings();
        res.json({
          timezone: s?.timezone ?? "UTC",
          dateFormat: s?.dateFormat ?? "YYYY-MM-DD",
          timeFormat: s?.timeFormat ?? "24h",
          maxFileUploadSize: s?.maxFileUploadSize ?? 10,
          maintenanceMode: s?.maintenanceMode ?? false,
        });
      } catch (error) {
        console.error("Error fetching preference settings:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch preference settings" });
      }
    }
  );

  // PATCH /api/company-settings/branding - scoped update
  app.patch(
    "/api/company-settings/branding",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        const payload: any = {};
        if (req.body.companyName !== undefined)
          payload.companyName = req.body.companyName;
        if (req.body.primaryColor !== undefined)
          payload.primaryColor = req.body.primaryColor;
        const updated = await storage.updateCompanySettings(payload, userId);
        res.json({
          companyName: updated.companyName,
          primaryColor: updated.primaryColor,
          logoUrl: updated.logoUrl,
        });
      } catch (error) {
        console.error("Error updating branding settings:", error);
        res.status(500).json({ message: "Failed to update branding settings" });
      }
    }
  );

  // PATCH /api/company-settings/tickets - scoped update
  app.patch(
    "/api/company-settings/tickets",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        if (req.body.defaultTicketPriority) {
          if (!TICKET_PRIORITIES.includes(req.body.defaultTicketPriority)) {
            return res.status(400).json({
              message: `Invalid priority. Must be one of: ${TICKET_PRIORITIES.join(
                ", "
              )}`,
            });
          }
        }
        if (req.body.autoCloseDays !== undefined) {
          const days = Number(req.body.autoCloseDays);
          if (isNaN(days)) {
            return res
              .status(400)
              .json({ message: "autoCloseDays must be a number or null" });
          }
          if (days === 0) req.body.autoCloseDays = null;
          else req.body.autoCloseDays = Math.max(1, Math.min(365, days));
        }
        const userId = getUserId(req);
        const payload: any = {};
        if (req.body.ticketPrefix !== undefined)
          payload.ticketPrefix = req.body.ticketPrefix;
        if (req.body.defaultTicketPriority !== undefined)
          payload.defaultTicketPriority = req.body.defaultTicketPriority;
        if (req.body.autoCloseDays !== undefined)
          payload.autoCloseDays = req.body.autoCloseDays;
        const updated = await storage.updateCompanySettings(payload, userId);
        res.json({
          ticketPrefix: updated.ticketPrefix,
          defaultTicketPriority: updated.defaultTicketPriority,
          autoCloseDays: updated.autoCloseDays,
        });
      } catch (error) {
        console.error("Error updating ticket settings:", error);
        res.status(500).json({ message: "Failed to update ticket settings" });
      }
    }
  );

  // PATCH /api/company-settings/preferences - scoped update
  app.patch(
    "/api/company-settings/preferences",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        if (req.body.maxFileUploadSize !== undefined) {
          const size = Number(req.body.maxFileUploadSize);
          if (isNaN(size) || size < 1 || size > 100) {
            return res.status(400).json({
              message: "maxFileUploadSize must be between 1 and 100 MB",
            });
          }
        }
        const userId = getUserId(req);
        const payload: any = {};
        const keys = [
          "timezone",
          "dateFormat",
          "timeFormat",
          "maxFileUploadSize",
          "maintenanceMode",
        ] as const;
        for (const k of keys)
          if (req.body[k] !== undefined) (payload as any)[k] = req.body[k];
        const updated = await storage.updateCompanySettings(payload, userId);
        res.json({
          timezone: updated.timezone,
          dateFormat: updated.dateFormat,
          timeFormat: updated.timeFormat,
          maxFileUploadSize: updated.maxFileUploadSize,
          maintenanceMode: updated.maintenanceMode,
        });
      } catch (error) {
        console.error("Error updating preference settings:", error);
        res
          .status(500)
          .json({ message: "Failed to update preference settings" });
      }
    }
  );

  // POST /api/company-settings/branding/logo - Upload company logo (admin only)
  app.post(
    "/api/company-settings/branding/logo",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const { fileName, fileType, fileData } = req.body;

        if (!fileData || typeof fileData !== "string") {
          return res.status(400).json({ message: "File data is required" });
        }
        if (!["image/jpeg", "image/jpg", "image/png"].includes(fileType)) {
          return res.status(400).json({
            message: "Invalid file type. Only JPG and PNG are allowed.",
          });
        }

        const estimatedBinarySize = (fileData.length * 3) / 4;
        const companySettings = await storage.getCompanySettings();
        const maxSizeMB = companySettings?.maxFileUploadSize || 10;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (estimatedBinarySize > maxSizeBytes) {
          return res
            .status(400)
            .json({ message: `File size exceeds ${maxSizeMB}MB limit` });
        }
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(fileData)) {
          return res
            .status(400)
            .json({ message: "Invalid base64 file data format" });
        }

        const logoUrl = `data:${fileType};base64,${fileData}`;
        const userId = getUserId(req);
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

  // Email Settings Routes (multi-provider)
  app.get(
    "/api/company-settings/email",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const active = await storage.getActiveEmailProvider();
        if (!active) return res.json({});
        const meta = (active as any).metadata || {};
        const mailtrapHasToken =
          (active as any).provider === EMAIL_PROVIDERS.MAILTRAP &&
          Boolean(
            (active as any).metadata?.mailtrapToken ||
              process.env.MAILTRAP_TOKEN
          );
        res.json({
          provider: (active as any).provider || EMAIL_PROVIDERS.MAILTRAP,
          fromEmail: (active as any).fromEmail,
          fromName: (active as any).fromName || DEFAULT_COMPANY.EMAIL.FROM_NAME,
          // provider-specific hints for client
          awsAccessKeyId: meta.awsAccessKeyId || "",
          awsRegion: meta.awsRegion || "",
          hasAwsSecret: !!meta.awsSecretAccessKey,
          mailtrapHasToken,
          // Return Mailtrap token if stored (for UI display)
          mtToken: meta.mailtrapToken || "",
        });
      } catch (error) {
        console.error("Error fetching email provider:", error);
        res.status(500).json({ message: "Failed to fetch email settings" });
      }
    }
  );

  app.post(
    "/api/company-settings/email",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const parsed = SaveEmailSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: "Invalid payload", issues: parsed.error.issues });
        }

        const userId = getUserId(req);
        const data = parsed.data;

        const saved = await storage.upsertEmailProvider(
          {
            provider: data.provider,
            fromEmail: data.fromEmail,
            fromName: data.fromName,
            metadata: (() => {
              switch (data.provider) {
                case EMAIL_PROVIDERS.MAILTRAP:
                  return {
                    ...((data as any).token
                      ? { mailtrapToken: (data as any).token }
                      : {}),
                  };
                case EMAIL_PROVIDERS.AWS:
                  return {
                    awsAccessKeyId: data.awsAccessKeyId,
                    ...(data.awsSecretAccessKey
                      ? { awsSecretAccessKey: data.awsSecretAccessKey }
                      : {}),
                    awsRegion: data.awsRegion,
                  };
                case EMAIL_PROVIDERS.SMTP:
                  return {
                    host: data.host,
                    port: data.port,
                    username: data.username,
                    ...(data.password ? { password: data.password } : {}),
                    encryption: data.encryption,
                  };
                case EMAIL_PROVIDERS.MAILGUN:
                  return {
                    domain: data.domain,
                    apiKey: data.apiKey,
                    region: data.region,
                  };
                case EMAIL_PROVIDERS.SENDGRID:
                  return { apiKey: data.apiKey };
                case EMAIL_PROVIDERS.CUSTOM:
                  return { config: data.config };
                default:
                  return {};
              }
            })(),
            isActive: true,
          } as any,
          userId
        );

        res.json({
          provider: (saved as any).provider,
          fromEmail: (saved as any).fromEmail,
          fromName: (saved as any).fromName,
          isActive: (saved as any).isActive,
        });
      } catch (error) {
        console.error("Error updating email settings:", error);
        res.status(500).json({ message: "Failed to update email settings" });
      }
    }
  );

  // Update only sender (fromEmail/fromName)
  app.patch(
    "/api/company-settings/email/sender",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const { fromEmail, fromName } = req.body || {};
        if (!fromEmail || typeof fromEmail !== "string") {
          return res.status(400).json({ message: "fromEmail is required" });
        }
        if (!fromName || typeof fromName !== "string") {
          return res.status(400).json({ message: "fromName is required" });
        }
        const updated = await storage.updateActiveEmailProvider({
          fromEmail,
          fromName,
        });
        res.json({
          provider: (updated as any).provider,
          fromEmail: (updated as any).fromEmail,
          fromName: (updated as any).fromName,
        });
      } catch (error) {
        console.error("Error updating sender:", error);
        res.status(500).json({ message: "Failed to update sender" });
      }
    }
  );

  // Combined sender + optional template update
  app.patch(
    "/api/company-settings/email/settings",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const { fromEmail, fromName, template } = req.body || {};
        if (!fromEmail || typeof fromEmail !== "string") {
          return res.status(400).json({ message: "fromEmail is required" });
        }
        if (!fromName || typeof fromName !== "string") {
          return res.status(400).json({ message: "fromName is required" });
        }
        const updated = await storage.updateActiveEmailProvider({
          fromEmail,
          fromName,
        });

        let updatedTemplate: any = null;
        if (template && template.name) {
          const userId = getUserId(req);
          updatedTemplate = await storage.updateEmailTemplate(
            String(template.name),
            {
              subject: template.subject,
              body: template.body,
            } as any,
            userId
          );
        }

        res.json({
          provider: (updated as any).provider,
          fromEmail: (updated as any).fromEmail,
          fromName: (updated as any).fromName,
          template: updatedTemplate,
        });
      } catch (error) {
        console.error("Error updating email settings:", error);
        res.status(500).json({ message: "Failed to update email settings" });
      }
    }
  );

  app.post(
    "/api/company-settings/email/test",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const parsed = TestEmailSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: "Invalid payload", issues: parsed.error.issues });
        }

        const active = await storage.getActiveEmailProvider();
        if (!active) {
          return res
            .status(400)
            .json({ message: "Email provider not configured" });
        }

        const provider = (active as any).provider as string;
        const meta = (active as any).metadata || {};
        const adapter = getEmailAdapter(provider);
        const result = await adapter.sendTest({
          to: (parsed.data as any).testEmail,
          fromEmail: (active as any).fromEmail,
          fromName: (active as any).fromName,
          metadata: meta,
        });

        if (result.success) {
          res.json({ message: "Test email sent successfully" });
        } else {
          res
            .status(501)
            .json({ message: result.message || "Failed to send test email" });
        }
      } catch (error) {
        console.error("Email test error:", error);
        res.status(500).json({ message: "Failed to test email configuration" });
      }
    }
  );
}
