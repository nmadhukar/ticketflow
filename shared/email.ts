import { z } from "zod";
import { EMAIL_PROVIDERS } from "./constants";

export const EmailProviderEnum = z.enum([
  EMAIL_PROVIDERS.AWS,
  EMAIL_PROVIDERS.SMTP,
  EMAIL_PROVIDERS.MAILGUN,
  EMAIL_PROVIDERS.SENDGRID,
  EMAIL_PROVIDERS.CUSTOM,
]);

export const AwsSesConfigSchema = z.object({
  provider: z.literal(EMAIL_PROVIDERS.AWS),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
  awsAccessKeyId: z.string().min(1),
  awsSecretAccessKey: z.string().optional(),
  awsRegion: z.string().default("us-east-1"),
});

export const SmtpConfigSchema = z.object({
  provider: z.literal(EMAIL_PROVIDERS.SMTP),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  username: z.string().min(1),
  password: z.string().optional(),
  encryption: z.enum(["tls", "ssl", "none"]).default("tls"),
});

export const MailgunConfigSchema = z.object({
  provider: z.literal(EMAIL_PROVIDERS.MAILGUN),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
  domain: z.string().min(1),
  apiKey: z.string().min(1),
  region: z.enum(["us", "eu"]).default("us"),
});

export const SendgridConfigSchema = z.object({
  provider: z.literal(EMAIL_PROVIDERS.SENDGRID),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
  apiKey: z.string().min(1),
});

export const CustomConfigSchema = z.object({
  provider: z.literal(EMAIL_PROVIDERS.CUSTOM),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
  config: z.record(z.any()).default({}),
});

export const SaveEmailSettingsSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal(EMAIL_PROVIDERS.MAILTRAP),
    fromEmail: z.string().email(),
    fromName: z.string().min(1),
    token: z.string().min(1).optional(),
  }),
  AwsSesConfigSchema,
  SmtpConfigSchema,
  MailgunConfigSchema,
  SendgridConfigSchema,
  CustomConfigSchema,
]);

export type SaveEmailSettingsRequest = z.infer<typeof SaveEmailSettingsSchema>;

export const TestEmailSchema = z.object({
  testEmail: z.string().email(),
});

export type TestEmailRequest = z.infer<typeof TestEmailSchema>;
