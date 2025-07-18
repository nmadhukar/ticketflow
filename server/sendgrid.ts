import { MailService } from '@sendgrid/mail';

const mailService = new MailService();

// Only set API key if available
if (process.env.SENDGRID_API_KEY) {
  mailService.setApiKey(process.env.SENDGRID_API_KEY);
}

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    console.error('SendGrid API key not configured');
    return false;
  }

  try {
    await mailService.send({
      to: params.to,
      from: params.from,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return true;
  } catch (error) {
    console.error('SendGrid email error:', error);
    return false;
  }
}

export async function sendTestEmail(
  host: string,
  port: number,
  username: string,
  password: string,
  encryption: string,
  fromEmail: string,
  fromName: string,
  toEmail: string
): Promise<boolean> {
  // For SendGrid, we'll use the API key approach instead of SMTP
  // The SMTP settings are stored for future use with other providers
  
  if (!process.env.SENDGRID_API_KEY) {
    console.error('SendGrid API key not configured');
    return false;
  }

  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Test Email from TicketFlow</h2>
        <p>This is a test email to verify your email configuration is working correctly.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Configuration Details:</h3>
          <ul style="list-style: none; padding: 0;">
            <li><strong>From:</strong> ${fromName} &lt;${fromEmail}&gt;</li>
            <li><strong>Host:</strong> ${host}</li>
            <li><strong>Port:</strong> ${port}</li>
            <li><strong>Encryption:</strong> ${encryption.toUpperCase()}</li>
          </ul>
        </div>
        <p style="color: #666; font-size: 14px;">
          If you received this email, your email configuration is working properly!
        </p>
      </div>
    `;

    const text = `Test Email from TicketFlow\n\n` +
      `This is a test email to verify your email configuration is working correctly.\n\n` +
      `Configuration Details:\n` +
      `From: ${fromName} <${fromEmail}>\n` +
      `Host: ${host}\n` +
      `Port: ${port}\n` +
      `Encryption: ${encryption.toUpperCase()}\n\n` +
      `If you received this email, your email configuration is working properly!`;

    return await sendEmail({
      to: toEmail,
      from: fromEmail,
      subject: 'TicketFlow Test Email',
      text,
      html,
    });
  } catch (error) {
    console.error('Test email error:', error);
    return false;
  }
}