// Default email templates for TicketFlow

export const defaultEmailTemplates = [
  {
    name: "user_invitation",
    subject: "You've been invited to join {{companyName}} on TicketFlow",
    body: `
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
    `,
    variables: [
      "companyName",
      "invitedName",
      "inviterName",
      "email",
      "role",
      "department",
      "registrationUrl",
      "year",
    ],
    isActive: true,
  },
  {
    name: "password_reset",
    subject: "Reset your {{companyName}} TicketFlow password",
    body: `
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
            background-color: #dc2626;
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
            background-color: #dc2626;
            color: white;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: bold;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 12px;
            color: #666;
        }
        .warning {
            background-color: #fef2f2;
            border: 1px solid #fecaca;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
            color: #991b1b;
        }
        .code {
            background-color: #e5e7eb;
            padding: 20px;
            border-radius: 6px;
            margin: 20px 0;
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            letter-spacing: 2px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Password Reset Request</h1>
    </div>
    <div class="content">
        <p>Hi {{userName}},</p>
        
        <p>We received a request to reset your password for your {{companyName}} TicketFlow account.</p>
        
        <p>Your password reset code is:</p>
        
        <div class="code">
            {{resetCode}}
        </div>
        
        <p>Or you can click the button below to reset your password directly:</p>
        
        <center>
            <a href="{{resetUrl}}" class="button">Reset Password</a>
        </center>
        
        <p>This code will expire in 1 hour for security reasons.</p>
        
        <div class="warning">
            <strong>⚠️ Important Security Notice:</strong><br>
            If you didn't request this password reset, please ignore this email and your password will remain unchanged. 
            You may want to review your account security settings.
        </div>
        
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all;">{{resetUrl}}</p>
        
        <p>For security reasons:</p>
        <ul>
            <li>This link will expire in 1 hour</li>
            <li>This link can only be used once</li>
            <li>We'll never ask for your password via email</li>
        </ul>
        
        <p>Best regards,<br>
        The {{companyName}} Security Team</p>
    </div>
    <div class="footer">
        <p>This is an automated security message from TicketFlow. Please do not reply to this email.</p>
        <p>Request details: IP Address {{ipAddress}} | Time: {{timestamp}}</p>
        <p>© {{year}} {{companyName}}. All rights reserved.</p>
    </div>
</body>
</html>
    `,
    variables: [
      "companyName",
      "userName",
      "resetCode",
      "resetUrl",
      "ipAddress",
      "timestamp",
      "year",
    ],
    isActive: true,
  },
  {
    name: "ticket_created",
    subject: "Ticket #{{ticketNumber}} has been created",
    body: `
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
            background-color: #10b981;
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
        .ticket-details {
            background-color: white;
            border: 1px solid #e5e7eb;
            padding: 20px;
            border-radius: 6px;
            margin: 20px 0;
        }
        .button {
            display: inline-block;
            background-color: #10b981;
            color: white;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: bold;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 12px;
            color: #666;
        }
        .priority {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 12px;
        }
        .priority-high { background-color: #fef2f2; color: #991b1b; }
        .priority-medium { background-color: #fef3c7; color: #92400e; }
        .priority-low { background-color: #f0fdf4; color: #166534; }
    </style>
</head>
<body>
    <div class="header">
        <h1>New Ticket Created</h1>
    </div>
    <div class="content">
        <p>Hi {{assigneeName}},</p>
        
        <p>A new ticket has been created and assigned to you:</p>
        
        <div class="ticket-details">
            <h3>{{ticketTitle}}</h3>
            <p><strong>Ticket Number:</strong> {{ticketNumber}}</p>
            <p><strong>Priority:</strong> <span class="priority priority-{{priority}}">{{priority}}</span></p>
            <p><strong>Category:</strong> {{category}}</p>
            <p><strong>Created by:</strong> {{creatorName}}</p>
            <p><strong>Due Date:</strong> {{dueDate}}</p>
            <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
            <p><strong>Description:</strong></p>
            <p>{{description}}</p>
        </div>
        
        <center>
            <a href="{{ticketUrl}}" class="button">View Ticket</a>
        </center>
        
        <p>Please review this ticket at your earliest convenience.</p>
        
        <p>Best regards,<br>
        The {{companyName}} Support Team</p>
    </div>
    <div class="footer">
        <p>This is an automated message from TicketFlow. To update your notification preferences, visit your account settings.</p>
        <p>© {{year}} {{companyName}}. All rights reserved.</p>
    </div>
</body>
</html>
    `,
    variables: [
      "companyName",
      "assigneeName",
      "ticketTitle",
      "ticketNumber",
      "priority",
      "category",
      "creatorName",
      "dueDate",
      "description",
      "ticketUrl",
      "year",
    ],
    isActive: true,
  },
  {
    name: "ticket_updated",
    subject: "Ticket #{{ticketNumber}} has been updated",
    body: `
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
            background-color: #3b82f6;
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
        .update-details {
            background-color: #eff6ff;
            border: 1px solid #bfdbfe;
            padding: 20px;
            border-radius: 6px;
            margin: 20px 0;
        }
        .button {
            display: inline-block;
            background-color: #3b82f6;
            color: white;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: bold;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 12px;
            color: #666;
        }
        .change-item {
            background-color: white;
            padding: 10px;
            margin: 10px 0;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Ticket Updated</h1>
    </div>
    <div class="content">
        <p>Hi {{recipientName}},</p>
        
        <p>Ticket #{{ticketNumber}} has been updated by {{updaterName}}:</p>
        
        <div class="update-details">
            <h3>{{ticketTitle}}</h3>
            <p><strong>Update Type:</strong> {{updateType}}</p>
            <div class="change-item">
                {{updateDetails}}
            </div>
            {{#if comment}}
            <div class="change-item">
                <strong>Comment:</strong><br>
                {{comment}}
            </div>
            {{/if}}
        </div>
        
        <center>
            <a href="{{ticketUrl}}" class="button">View Ticket</a>
        </center>
        
        <p>Current Status: <strong>{{currentStatus}}</strong></p>
        
        <p>Best regards,<br>
        The {{companyName}} Support Team</p>
    </div>
    <div class="footer">
        <p>This is an automated message from TicketFlow. To update your notification preferences, visit your account settings.</p>
        <p>© {{year}} {{companyName}}. All rights reserved.</p>
    </div>
</body>
</html>
    `,
    variables: [
      "companyName",
      "recipientName",
      "ticketNumber",
      "ticketTitle",
      "updaterName",
      "updateType",
      "updateDetails",
      "comment",
      "currentStatus",
      "ticketUrl",
      "year",
    ],
    isActive: true,
  },
];
