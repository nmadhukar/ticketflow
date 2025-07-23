# AWS SES Setup Guide for TicketFlow

## Prerequisites
- An AWS account (if you don't have one, create a free account at https://aws.amazon.com)
- Admin access to your AWS account

## Step 1: Create an IAM User for SES

1. **Sign in to AWS Console**
   - Go to https://console.aws.amazon.com
   - Sign in with your AWS account credentials

2. **Navigate to IAM (Identity and Access Management)**
   - In the AWS Console, search for "IAM" in the top search bar
   - Click on "IAM" to open the IAM dashboard

3. **Create a New IAM User**
   - In the left sidebar, click on "Users"
   - Click the "Create user" button
   - Enter a username like "ticketflow-ses-user"
   - Select "Programmatic access" (this gives you the Access Key ID and Secret Access Key)
   - Click "Next: Permissions"

4. **Set Permissions**
   - Select "Attach existing policies directly"
   - Search for "AmazonSESFullAccess" in the search box
   - Check the box next to "AmazonSESFullAccess"
   - Click "Next: Tags" (you can skip tags)
   - Click "Next: Review"
   - Click "Create user"

5. **Save Your Credentials**
   - **IMPORTANT**: This is the only time you'll see the Secret Access Key!
   - Copy the "Access key ID" - this is your AWS Access Key ID
   - Copy the "Secret access key" - this is your AWS Secret Access Key
   - Save these securely - you'll need them for TicketFlow

## Step 2: Set Up SES and Verify Email Address

1. **Navigate to Amazon SES**
   - In the AWS Console, search for "SES" or "Simple Email Service"
   - Click on "Amazon Simple Email Service"

2. **Choose Your Region**
   - In the top-right corner, select your preferred AWS region
   - Common choices: us-east-1 (N. Virginia), us-west-2 (Oregon), eu-west-1 (Ireland)
   - Remember this region - you'll need it for TicketFlow configuration

3. **Verify Your Sender Email Address**
   - In SES, click on "Verified identities" in the left sidebar
   - Click "Create identity"
   - Select "Email address"
   - Enter the email address you want to send emails from (e.g., noreply@yourdomain.com)
   - Click "Create identity"
   - Check your email inbox for a verification email from AWS
   - Click the verification link in the email

## Step 3: Request Production Access (Important!)

By default, AWS SES starts in "Sandbox" mode with limitations:
- Can only send to verified email addresses
- Limited to 200 emails per day
- 1 email per second rate limit

**To send emails to any address:**

1. In the SES console, look for "Account dashboard" in the left sidebar
2. You'll see a message about being in the sandbox
3. Click "Request production access"
4. Fill out the form:
   - Use case: Select "Transactional"
   - Website URL: Your TicketFlow URL
   - Describe how you'll use SES: "Sending ticket notifications and user invitations for our internal ticketing system"
   - Comply with AWS policies
5. Submit the request (approval usually takes 24 hours)

## Step 4: Configure TicketFlow

1. Log in to TicketFlow as an admin
2. Go to Admin Panel → Email Settings
3. Enter your credentials:
   - **AWS Access Key ID**: The Access Key ID you saved earlier
   - **AWS Secret Access Key**: The Secret Access Key you saved earlier
   - **AWS Region**: The region you selected (e.g., us-east-1)
   - **From Email**: The verified email address
   - **From Name**: Your company name (e.g., "TicketFlow Support")
4. Click "Save Settings"
5. Click "Send Test Email" to verify everything works

## Troubleshooting

### Test Email Not Received?
- Check if you're still in Sandbox mode (can only send to verified emails)
- Verify the recipient email address in SES if in Sandbox mode
- Check spam/junk folder
- Ensure the "From Email" is verified in SES

### Access Denied Error?
- Double-check your Access Key ID and Secret Access Key
- Ensure the IAM user has "AmazonSESFullAccess" policy attached
- Verify you're using the correct AWS region

### Email Bouncing?
- Verify your sender email address in SES
- If using a custom domain, ensure proper DNS records are set up
- Check SES dashboard for bounce notifications

## Security Best Practices

1. **Never share your Secret Access Key**
2. **Use IAM policies** to limit access to only what's needed
3. **Rotate access keys** regularly (every 90 days recommended)
4. **Monitor usage** in the SES dashboard
5. **Set up bounce and complaint handling** for production use

## Next Steps

Once configured:
- Test sending invitation emails from Admin Panel → User Management → Invite User
- Monitor email sending in the AWS SES console
- Set up email templates for consistent branding
- Configure bounce and complaint handling for production use