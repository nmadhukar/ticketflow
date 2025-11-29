import { EMAIL_PROVIDERS } from "@shared/constants";

export interface SendTestOptions {
  to: string;
  fromEmail: string;
  fromName: string;
  metadata: Record<string, any>;
}

export interface EmailAdapter {
  sendTest(
    options: SendTestOptions
  ): Promise<{ success: boolean; message?: string }>;
}

class NotImplementedAdapter implements EmailAdapter {
  constructor(private readonly name: string) {}
  async sendTest(): Promise<{ success: boolean; message?: string }> {
    return { success: false, message: `${this.name} test not implemented` };
  }
}

class AwsSesAdapter implements EmailAdapter {
  async sendTest(
    options: SendTestOptions
  ): Promise<{ success: boolean; message?: string }> {
    const { sendTestEmail } = await import("../services/ses");
    const ok = await sendTestEmail(
      "",
      0,
      options.metadata.awsAccessKeyId || "",
      options.metadata.awsSecretAccessKey || "",
      options.metadata.awsRegion || "us-east-1",
      options.fromEmail,
      options.fromName,
      options.to
    );
    return ok
      ? { success: true }
      : { success: false, message: "SES test failed" };
  }
}

class MailtrapAdapter implements EmailAdapter {
  async sendTest(
    options: SendTestOptions
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const { MailtrapClient } = await import("mailtrap");
      const token =
        (options.metadata && (options.metadata as any).mailtrapToken) ||
        process.env.MAILTRAP_TOKEN ||
        "";
      if (!token) {
        return { success: false, message: "MAILTRAP_TOKEN is not set" };
      }
      const client = new MailtrapClient({ token });
      const fromName = options.fromName || "Helpdesk Support";
      const fromEmail = options.fromEmail;
      await client.send({
        from: { name: fromName, email: fromEmail },
        to: [{ email: options.to }],
        subject: "TicketFlow Test Email",
        text: "This is a test email sent via Mailtrap.",
      });
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || "Mailtrap send failed",
      };
    }
  }
}

export function getEmailAdapter(provider: string): EmailAdapter {
  switch (provider) {
    case EMAIL_PROVIDERS.MAILTRAP:
      return new MailtrapAdapter();
    case EMAIL_PROVIDERS.AWS:
      return new AwsSesAdapter();
    case EMAIL_PROVIDERS.SMTP:
      return new NotImplementedAdapter("SMTP");
    case EMAIL_PROVIDERS.MAILGUN:
      return new NotImplementedAdapter("Mailgun");
    case EMAIL_PROVIDERS.SENDGRID:
      return new NotImplementedAdapter("SendGrid");
    case EMAIL_PROVIDERS.CUSTOM:
      return new NotImplementedAdapter("Custom");
    default:
      return new NotImplementedAdapter("Unknown");
  }
}
