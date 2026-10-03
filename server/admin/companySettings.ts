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
import { isAuthenticated } from "../services/auth";
import { s3Service } from "../services/s3Service";
import { fail, logRouteError } from "../http/errors";

/** The company ticket prefix: 1 to 6 ASCII letters or digits. */
export const TICKET_PREFIX_PATTERN = /^[A-Za-z0-9]{1,6}$/;

/** The submitted secret if non-blank, else the stored one if any, as a metadata fragment. */
function secretOrKept(
  field: string,
  submitted: unknown,
  stored: Record<string, any>
): Record<string, string> {
  if (typeof submitted === "string" && submitted.trim() !== "") {
    return { [field]: submitted };
  }
  return typeof stored[field] === "string" && stored[field]
    ? { [field]: stored[field] }
    : {};
}

export function registerCompanySettingsRoutes(app: Express): void {
  // GET /api/company-settings/branding - scoped fetch
  app.get(
    "/api/company-settings/branding",
    isAuthenticated,
    async (req, res) => {
      try {
        // A copy: getCompanySettings hands out its cached row, and writing the presigned
        // URL into that object replaced the stored logo key for every later reader.
        const stored = await storage.getCompanySettings();
        const s = stored ? { ...stored } : stored;

        // If logo is stored as S3 key, generate presigned URL
        if (s?.logoUrl && s3Service.isS3Url(s.logoUrl)) {
          try {
            const presignedUrl = await s3Service.getPresignedUrl(
              s3Service.extractKeyFromUrl(s.logoUrl),
              86400 // 24 hours for logos
            );
            s.logoUrl = presignedUrl;
          } catch (error) {
            console.warn("Failed to generate presigned URL for logo:", error);
            // Keep original URL/key if presigned URL generation fails
          }
        }
        res.json({
          companyName: s?.companyName ?? "TicketFlow",
          logoUrl: s?.logoUrl ?? null,
          primaryColor: s?.primaryColor ?? "#3b82f6",
        });
      } catch (error) {
        logRouteError("Error fetching branding settings", error);
        fail(res, 500, "Failed to fetch branding settings");
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
        logRouteError("Error fetching ticket settings", error);
        fail(res, 500, "Failed to fetch ticket settings");
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
        logRouteError("Error fetching preference settings", error);
        fail(res, 500, "Failed to fetch preference settings");
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
        // The columns are varchar(255) not null and varchar(7): anything else used to be a
        // database error (500) or a blank company name shown in every page header.
        const name = req.body.companyName;
        if (
          name !== undefined &&
          (typeof name !== "string" || name.trim() === "" || name.trim().length > 255)
        ) {
          return fail(res, 400, "companyName must be 1 to 255 characters", {
            details: { formErrors: [], fieldErrors: { companyName: ["1 to 255 characters"] } },
          });
        }
        const color = req.body.primaryColor;
        if (color !== undefined && (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
          return fail(res, 400, "primaryColor must be a #rrggbb colour", {
            details: { formErrors: [], fieldErrors: { primaryColor: ["#rrggbb"] } },
          });
        }
        const userId = getUserId(req);
        const payload: any = {};
        if (name !== undefined) payload.companyName = name.trim();
        if (color !== undefined) payload.primaryColor = color;
        const updated = await storage.updateCompanySettings(payload, userId);
        res.json({
          companyName: updated.companyName,
          primaryColor: updated.primaryColor,
          logoUrl: updated.logoUrl,
        });
      } catch (error) {
        logRouteError("Error updating branding settings", error);
        fail(res, 500, "Failed to update branding settings");
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
        // M5: ticket numbers are PREFIX-YYYY-NNNN, matched by the inbound-email tag and
        // the counter's backfill as [A-Za-z0-9]+; anything else would make numbers that
        // no reply can reference.
        // FU5: validated only when the request changes it, so a legacy prefix longer
        // than 6 characters (which keeps numbering tickets) does not block saving the
        // other fields when the settings form sends it back unchanged.
        const currentPrefix =
          req.body.ticketPrefix !== undefined
            ? ((await storage.getCompanySettings())?.ticketPrefix ?? "TKT")
            : undefined;
        if (
          req.body.ticketPrefix !== undefined &&
          req.body.ticketPrefix !== currentPrefix &&
          (typeof req.body.ticketPrefix !== "string" || !TICKET_PREFIX_PATTERN.test(req.body.ticketPrefix))
        ) {
          return fail(res, 400, "ticketPrefix must be 1 to 6 letters or digits", {
            details: { formErrors: [], fieldErrors: { ticketPrefix: ["1 to 6 letters or digits"] } },
          });
        }
        if (req.body.defaultTicketPriority) {
          if (!TICKET_PRIORITIES.includes(req.body.defaultTicketPriority)) {
            return fail(
              res,
              400,
              `Invalid priority. Must be one of: ${TICKET_PRIORITIES.join(", ")}`
            );
          }
        }
        if (req.body.autoCloseDays !== undefined) {
          const days = Number(req.body.autoCloseDays);
          if (isNaN(days)) {
            return fail(res, 400, "autoCloseDays must be a number or null");
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
        logRouteError("Error updating ticket settings", error);
        fail(res, 500, "Failed to update ticket settings");
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
            return fail(res, 400, "maxFileUploadSize must be between 1 and 100 MB");
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
        logRouteError("Error updating preference settings", error);
        fail(res, 500, "Failed to update preference settings");
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
        const { fileName: _fileName, fileType, fileData } = req.body;

        if (!fileData || typeof fileData !== "string") {
          return fail(res, 400, "File data is required");
        }
        if (!["image/jpeg", "image/jpg", "image/png"].includes(fileType)) {
          return fail(res, 400, "Invalid file type. Only JPG and PNG are allowed.");
        }

        const estimatedBinarySize = (fileData.length * 3) / 4;
        const companySettings = await storage.getCompanySettings();
        const maxSizeMB = companySettings?.maxFileUploadSize || 10;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (estimatedBinarySize > maxSizeBytes) {
          return fail(res, 400, `File size exceeds ${maxSizeMB}MB limit`);
        }
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(fileData)) {
          return fail(res, 400, "Invalid base64 file data format");
        }

        // Convert base64 to Buffer
        const buffer = Buffer.from(fileData, "base64");

        // Determine file extension from MIME type
        const extension =
          fileType === "image/jpeg" || fileType === "image/jpg" ? "jpg" : "png";

        // Upload to S3
        const s3Key = `logos/company-logo.${extension}`;

        const currentSettings = await storage.getCompanySettings();

        // Upload first: the old logo used to be deleted before this, so a failed upload
        // left the stored key pointing at an object that no longer existed.
        await s3Service.uploadFile(s3Key, buffer, fileType);

        // Store S3 key in database (we'll use presigned URLs when serving)
        const logoUrl = s3Key;
        const userId = getUserId(req);
        const settings = await storage.updateCompanySettings(
          { logoUrl },
          userId
        );

        // Then remove the previous logo, unless it is the object just written (png over png).
        if (
          currentSettings?.logoUrl &&
          s3Service.isS3Url(currentSettings.logoUrl)
        ) {
          try {
            const oldKey = s3Service.extractKeyFromUrl(currentSettings.logoUrl);
            if (oldKey !== s3Key) await s3Service.deleteFile(oldKey);
          } catch (error) {
            console.warn("Failed to delete old logo from S3:", error);
            // The new logo is already live; a leftover object is harmless
          }
        }
        res.json(settings);
      } catch (error) {
        logRouteError("Error uploading logo", error);
        fail(res, 500, "Failed to upload logo");
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
          // Secrets are never returned: only whether one is stored.
          hasSmtpPassword: !!meta.password,
        });
      } catch (error) {
        logRouteError("Error fetching email provider", error);
        fail(res, 500, "Failed to fetch email settings");
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
          return fail(res, 400, "Invalid payload", {
            details: { issues: parsed.error.issues },
          });
        }

        const userId = getUserId(req);
        const data = parsed.data;

        // A blank secret keeps the stored one, but only for the same provider:
        // a secret must never follow an admin from one provider to another.
        const active: any = await storage.getActiveEmailProvider();
        const prev: Record<string, any> =
          active && active.provider === data.provider
            ? active.metadata || {}
            : {};

        // A stored secret is only kept while the identifier it belongs to is
        // unchanged. Changing the identifier with a blank secret is refused
        // rather than silently pairing the old secret with a new identity.
        const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
        // fieldErrors, the same shape every other form field error has.
        const secretRequired = (field: string, why: string) =>
          fail(res, 400, `${field} is required ${why}`, {
            code: "validation_failed",
            details: { formErrors: [], fieldErrors: { [field]: [`Required ${why}`] } },
          });
        if (
          data.provider === EMAIL_PROVIDERS.AWS &&
          blank(data.awsSecretAccessKey) &&
          prev.awsSecretAccessKey &&
          prev.awsAccessKeyId !== data.awsAccessKeyId
        ) {
          return secretRequired("awsSecretAccessKey", "when the account identifier changes");
        }
        // Nothing stored and nothing submitted: the SES sender would pair this access key id
        // with the SERVER's own AWS secret (environment fallback). That is only coherent when
        // the key id is the environment's own; any other id (a new host or account) must
        // bring its secret.
        if (
          data.provider === EMAIL_PROVIDERS.AWS &&
          blank(data.awsSecretAccessKey) &&
          !prev.awsSecretAccessKey &&
          data.awsAccessKeyId !== process.env.AWS_ACCESS_KEY_ID
        ) {
          return secretRequired("awsSecretAccessKey", "for an access key id that is not the server's own");
        }
        if (
          data.provider === EMAIL_PROVIDERS.SMTP &&
          blank(data.password) &&
          prev.password &&
          (prev.host !== data.host || prev.username !== data.username)
        ) {
          return secretRequired("password", "when the host or username changes");
        }
        // SMTP has no environment fallback (its adapter is not implemented), so a blank
        // password with nothing stored simply saves none; nothing is borrowed from the server.

        const saved = await storage.upsertEmailProvider(
          {
            provider: data.provider,
            fromEmail: data.fromEmail,
            fromName: data.fromName,
            metadata: (() => {
              switch (data.provider) {
                case EMAIL_PROVIDERS.MAILTRAP:
                  return {
                    ...secretOrKept(
                      "mailtrapToken",
                      (data as any).token,
                      prev
                    ),
                  };
                case EMAIL_PROVIDERS.AWS:
                  return {
                    awsAccessKeyId: data.awsAccessKeyId,
                    ...secretOrKept(
                      "awsSecretAccessKey",
                      data.awsSecretAccessKey,
                      prev
                    ),
                    awsRegion: data.awsRegion,
                  };
                case EMAIL_PROVIDERS.SMTP:
                  return {
                    host: data.host,
                    port: data.port,
                    username: data.username,
                    ...secretOrKept("password", data.password, prev),
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
        logRouteError("Error updating email settings", error);
        fail(res, 500, "Failed to update email settings");
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
          return fail(res, 400, "fromEmail is required");
        }
        if (!fromName || typeof fromName !== "string") {
          return fail(res, 400, "fromName is required");
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
        logRouteError("Error updating sender", error);
        fail(res, 500, "Failed to update sender");
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
          return fail(res, 400, "fromEmail is required");
        }
        if (!fromName || typeof fromName !== "string") {
          return fail(res, 400, "fromName is required");
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
        logRouteError("Error updating email settings", error);
        fail(res, 500, "Failed to update email settings");
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
          return fail(res, 400, "Invalid payload", {
            details: { issues: parsed.error.issues },
          });
        }

        const active = await storage.getActiveEmailProvider();
        if (!active) {
          return fail(res, 400, "Email provider not configured");
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
          // The adapter's own message can echo provider responses; send a fixed one.
          fail(res, 501, "Failed to send test email", { code: "email_test_failed" });
        }
      } catch (error) {
        logRouteError("Email test error", error);
        fail(res, 500, "Failed to test email configuration");
      }
    }
  );
}
