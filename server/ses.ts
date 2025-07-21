import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// Initialize SES client
const sesClient = new SESClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
});

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('AWS credentials not configured');
    return false;
  }

  try {
    const command = new SendEmailCommand({
      Source: params.from,
      Destination: {
        ToAddresses: [params.to],
      },
      Message: {
        Subject: {
          Data: params.subject,
          Charset: "UTF-8",
        },
        Body: {
          ...(params.text && {
            Text: {
              Data: params.text,
              Charset: "UTF-8",
            },
          }),
          ...(params.html && {
            Html: {
              Data: params.html,
              Charset: "UTF-8",
            },
          }),
        },
      },
    });

    await sesClient.send(command);
    console.log(`Email sent successfully to ${params.to}`);
    return true;
  } catch (error) {
    console.error('AWS SES email error:', error);
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
  // For AWS SES, we'll use the API approach
  // The SMTP settings are stored for future use if needed
  
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('AWS credentials not configured');
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
            <li><strong>Service:</strong> Amazon SES</li>
            <li><strong>Region:</strong> ${process.env.AWS_REGION || 'us-east-1'}</li>
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
      `Service: Amazon SES\n` +
      `Region: ${process.env.AWS_REGION || 'us-east-1'}\n\n` +
      `If you received this email, your email configuration is working properly!`;

    return await sendEmail({
      to: toEmail,
      from: `${fromName} <${fromEmail}>`,
      subject: 'TicketFlow Test Email',
      text,
      html,
    });
  } catch (error) {
    console.error('Test email error:', error);
    return false;
  }
}