import { and, eq } from "drizzle-orm";
import { emailTemplates } from "@shared/schema";
import { db } from "../storage/db";
import { defaultEmailTemplates } from "../services/ses/emailTemplates";

/**
 * R43 follow-up. The default `user_invitation` email used to print a "Department:" line. The
 * department is gone from the product and the default no longer has the line, but seeding only
 * inserts a template that is missing, so a database that already holds the old default would keep
 * printing "Department: " with nothing after it. This is that old default, character for character
 * (its sha256 is pinned in the test), so the fix-up can tell an untouched copy from an edited one.
 */
export const OLD_USER_INVITATION_BODY = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background-color: #1e40af;
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
        }
        .content {
            background-color: #f9fafb;
            padding: 30px;
            border-radius: 0 0 10px 10px;
        }
        .button {
            display: inline-block;
            background-color: #1e40af;
            color: white !important;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: bold;
        }
        .button:hover {
            background-color: #1e3a8a;
            color: white !important;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 12px;
            color: #666;
        }
        .details {
            background-color: #e5e7eb;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Welcome to {{companyName}}!</h1>
    </div>
    <div class="content">
        <p>Hi {{invitedName}},</p>
        
        <p>You've been invited by {{inviterName}} to join the {{companyName}} team on TicketFlow, our ticket management platform.</p>
        
        <div class="details">
            <strong>Your invitation details:</strong><br>
            Email: {{email}}<br>
            Role: {{role}}<br>
            Department: {{department}}
        </div>
        
        <p>To get started, please click the button below to create your account:</p>
        
        <center>
            <a href="{{registrationUrl}}" class="button">Create Your Account</a>
        </center>
        
        <p>This invitation will expire in 7 days. If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all;">{{registrationUrl}}</p>
        
        <p>Once you've created your account, you'll be able to:</p>
        <ul>
            <li>Create and track support tickets</li>
            <li>Collaborate with your team members</li>
            <li>Access company knowledge base</li>
            <li>Receive real-time notifications</li>
        </ul>
        
        <p>If you have any questions, please don't hesitate to reach out.</p>
        
        <p>Best regards,<br>
        The {{companyName}} Team</p>
    </div>
    <div class="footer">
        <p>This is an automated message from TicketFlow. Please do not reply to this email.</p>
        <p>© {{year}} {{companyName}}. All rights reserved.</p>
    </div>
</body>
</html>
    `;

/**
 * Startup data fix-up: when the stored `user_invitation` template body still equals the OLD default
 * exactly, it is replaced by the new default (body and variable list). A template an admin edited,
 * even by one character, is left alone. The comparison runs in the UPDATE itself, so it is atomic
 * and idempotent: once rewritten, the body no longer matches. Logs a count only. Returns the number
 * of rows rewritten (0 or 1).
 */
export async function updateOldInvitationTemplate(): Promise<number> {
  const current = defaultEmailTemplates.find((t) => t.name === "user_invitation");
  if (!current) return 0;
  const rows = await db
    .update(emailTemplates)
    .set({ body: current.body, variables: current.variables, updatedAt: new Date() })
    .where(and(eq(emailTemplates.name, "user_invitation"), eq(emailTemplates.body, OLD_USER_INVITATION_BODY)))
    .returning({ id: emailTemplates.id });
  if (rows.length > 0) {
    console.log("Invitation email template: replaced the old default (with the Department line) by the new default.");
  }
  return rows.length;
}
