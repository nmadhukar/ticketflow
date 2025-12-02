/**
 * Mailtrap Email Service
 *
 * This module handles email sending via Mailtrap Email API.
 * Mailtrap provides email delivery services with API and SMTP integration.
 *
 * Documentation: https://api-docs.mailtrap.io/
 */

import { MailtrapClient } from "mailtrap";
import type { EmailTemplate } from "@shared/schema";

interface EmailParams {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  text?: string;
  html?: string;
  mailtrapToken?: string;
}

interface TemplateEmailOptions {
  to: string;
  template: EmailTemplate;
  variables: Record<string, string>;
  fromEmail: string;
  fromName: string;
  mailtrapToken?: string;
}

/**
 * Send email via Mailtrap API
 * @param params - Email parameters including recipient, sender, subject, and content
 * @returns Promise<boolean> - true if email was sent successfully, false otherwise
 */
export async function sendEmail(params: EmailParams): Promise<boolean> {
  // Use provided token or fall back to environment variable
  const token = params.mailtrapToken || process.env.MAILTRAP_TOKEN || "";

  if (!token) {
    console.error("Mailtrap token not configured");
    return false;
  }

  try {
    // Create Mailtrap client with the provided token
    const client = new MailtrapClient({ token });

    // Extract email from "Name <email>" format if needed
    const fromEmail = params.from.includes("<")
      ? params.from.match(/<(.+)>/)?.[1] || params.from
      : params.from;

    // Send email via Mailtrap API
    await client.send({
      from: {
        name: params.fromName,
        email: fromEmail,
      },
      to: [{ email: params.to }],
      subject: params.subject,
      ...(params.text && { text: params.text }),
      ...(params.html && { html: params.html }),
    });

    console.log(`Mailtrap email sent successfully to ${params.to}`);
    return true;
  } catch (error: any) {
    console.error("Mailtrap email error:", error);
    return false;
  }
}

/**
 * Send email using a template with variable substitution
 * @param options - Template email options including template, variables, and recipient info
 * @returns Promise<boolean> - true if email was sent successfully, false otherwise
 */
export async function sendEmailWithTemplate(
  options: TemplateEmailOptions
): Promise<boolean> {
  const { to, template, variables, fromEmail, fromName, mailtrapToken } =
    options;

  // Replace variables in subject and body
  let subject = template.subject;
  let html = template.body;
  let text = "";

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    subject = subject.replace(regex, value);
    html = html.replace(regex, value);
    // Generate plain text version from HTML (simple strip)
    text = html.replace(/<[^>]*>/g, "").replace(/\n\s*\n/g, "\n");
  });

  return sendEmail({
    to,
    from: fromEmail, // Mailtrap expects just the email, not "Name <email>" format
    fromName,
    subject,
    html,
    text,
    mailtrapToken,
  });
}

/**
 * Send a test email via Mailtrap
 * @param mailtrapToken - Mailtrap API token
 * @param fromEmail - Sender email address
 * @param fromName - Sender name
 * @param toEmail - Recipient email address
 * @returns Promise<boolean> - true if test email was sent successfully, false otherwise
 */
export async function sendTestEmail(
  mailtrapToken: string,
  fromEmail: string,
  fromName: string,
  toEmail: string
): Promise<boolean> {
  if (!mailtrapToken) {
    console.error("Mailtrap token not configured");
    return false;
  }

  try {
    const client = new MailtrapClient({ token: mailtrapToken });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Test Email from TicketFlow</h2>
        <p>This is a test email to verify your email configuration is working correctly.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Configuration Details:</h3>
          <ul style="list-style: none; padding: 0;">
            <li><strong>From:</strong> ${fromName} &lt;${fromEmail}&gt;</li>
            <li><strong>Service:</strong> Mailtrap Email API</li>
          </ul>
        </div>
        <p style="color: #666; font-size: 14px;">
          If you received this email, your email configuration is working properly!
        </p>
      </div>
    `;

    const text =
      `Test Email from TicketFlow\n\n` +
      `This is a test email to verify your email configuration is working correctly.\n\n` +
      `Configuration Details:\n` +
      `From: ${fromName} <${fromEmail}>\n` +
      `Service: Mailtrap Email API\n\n` +
      `If you received this email, your email configuration is working properly!`;

    await client.send({
      from: {
        name: fromName,
        email: fromEmail,
      },
      to: [{ email: toEmail }],
      subject: "TicketFlow Test Email",
      text,
      html,
    });

    console.log(`Mailtrap test email sent successfully to ${toEmail}`);
    return true;
  } catch (error: any) {
    console.error("Mailtrap test email error:", error);
    return false;
  }
}
