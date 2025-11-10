// AWS IAM Security Configuration and Best Practices

export interface IAMPolicyDocument {
  Version: string;
  Statement: IAMStatement[];
}

export interface IAMStatement {
  Effect: "Allow" | "Deny";
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, any>;
}

// Minimal IAM policy for Bedrock AI operations
export const bedrockMinimalPolicy: IAMPolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      Resource: [
        "arn:aws:bedrock:*:*:model/anthropic.claude-3-sonnet-20240229-v1:0",
        "arn:aws:bedrock:*:*:model/amazon.titan-embed-text-v1",
      ],
      Condition: {
        StringEquals: {
          "aws:RequestedRegion": ["us-east-1", "us-west-2"],
        },
      },
    },
    {
      Effect: "Allow",
      Action: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ],
      Resource: "arn:aws:logs:*:*:log-group:/aws/bedrock/*",
    },
  ],
};

// Minimal IAM policy for SES email operations
export const sesMinimalPolicy: IAMPolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
      Resource: "*",
      Condition: {
        StringEquals: {
          "ses:FromAddress": [
            "noreply@yourdomain.com",
            "support@yourdomain.com",
          ],
        },
      },
    },
    {
      Effect: "Allow",
      Action: ["ses:GetSendQuota", "ses:GetSendStatistics"],
      Resource: "*",
    },
  ],
};

// Comprehensive IAM policy for admin operations (includes both SES and Bedrock)
export const adminComprehensivePolicy: IAMPolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    // Bedrock permissions
    {
      Effect: "Allow",
      Action: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:GetFoundationModel",
        "bedrock:ListFoundationModels",
      ],
      Resource: [
        "arn:aws:bedrock:*:*:model/anthropic.claude-3-sonnet-20240229-v1:0",
        "arn:aws:bedrock:*:*:model/amazon.titan-embed-text-v1",
      ],
    },
    // SES permissions
    {
      Effect: "Allow",
      Action: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
        "ses:GetSendQuota",
        "ses:GetSendStatistics",
        "ses:GetAccountSendingEnabled",
      ],
      Resource: "*",
    },
    // CloudWatch logs for monitoring
    {
      Effect: "Allow",
      Action: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ],
      Resource: [
        "arn:aws:logs:*:*:log-group:/aws/bedrock/*",
        "arn:aws:logs:*:*:log-group:/aws/ses/*",
        "arn:aws:logs:*:*:log-group:/aws/helpdesk/*",
      ],
    },
  ],
};

// IAM role trust policy for EC2/ECS/Lambda
export const ec2TrustPolicy: IAMPolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: "sts:AssumeRole",
      Resource: "arn:aws:iam::*:role/TicketFlowHelpdeskRole",
    },
  ],
};

// Security best practices for AWS credentials
export const awsSecurityBestPractices = {
  // Environment variable validation
  validateCredentials: () => {
    const requiredVars = [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
    ];
    const missing = requiredVars.filter((varName) => !process.env[varName]);

    if (missing.length > 0) {
      // Silently return false - no console output
      return false;
    }

    // Validate key format
    const accessKey = process.env.AWS_ACCESS_KEY_ID!;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY!;

    if (!accessKey.match(/^AKIA[0-9A-Z]{16}$/)) {
      console.warn("AWS_ACCESS_KEY_ID format appears invalid");
    }

    if (secretKey.length !== 40) {
      console.warn("AWS_SECRET_ACCESS_KEY length appears invalid");
    }

    return true;
  },

  // Rotate credentials check
  checkCredentialAge: () => {
    const createdDate = process.env.AWS_CREDENTIALS_CREATED;
    if (createdDate) {
      const daysSinceCreation = Math.floor(
        (Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceCreation > 90) {
        console.warn(
          `AWS credentials are ${daysSinceCreation} days old. Consider rotating.`
        );
      }
    }
  },

  // Validate region
  validateRegion: (region?: string) => {
    const allowedRegions = [
      "us-east-1",
      "us-west-2",
      "eu-west-1",
      "ap-southeast-1",
    ];
    const currentRegion = region || process.env.AWS_REGION;

    if (!allowedRegions.includes(currentRegion!)) {
      console.warn(
        `AWS region ${currentRegion} may not support all required services`
      );
    }
  },

  // Check for credential exposure
  sanitizeLogging: (obj: any): any => {
    const sanitized = { ...obj };
    const sensitiveKeys = [
      "aws_access_key_id",
      "aws_secret_access_key",
      "accesskeyid",
      "secretaccesskey",
    ];

    for (const key in sanitized) {
      if (
        sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))
      ) {
        sanitized[key] = "***REDACTED***";
      }
    }

    return sanitized;
  },
};

// AWS client configuration with security best practices
export const getSecureAWSConfig = () => {
  awsSecurityBestPractices.validateCredentials();
  awsSecurityBestPractices.validateRegion();
  awsSecurityBestPractices.checkCredentialAge();

  return {
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    maxRetries: 3,
    retryDelayOptions: {
      customBackoff: function (retryCount: number) {
        return Math.pow(2, retryCount) * 100; // Exponential backoff
      },
    },
    httpOptions: {
      timeout: 30000, // 30 second timeout
      connectTimeout: 5000, // 5 second connection timeout
    },
  };
};

// Separate AWS configurations for different services
export const getBedrockConfig = () => {
  return {
    ...getSecureAWSConfig(),
    // Bedrock-specific configuration
    maxRetries: 2, // Lower retries for AI operations
    httpOptions: {
      timeout: 60000, // Longer timeout for AI processing
      connectTimeout: 10000,
    },
  };
};
export const getSESConfig = () => {
  return {
    ...getSecureAWSConfig(),
    // SES-specific configuration
    maxRetries: 3,
    httpOptions: {
      timeout: 15000, // Standard timeout for email
      connectTimeout: 5000,
    },
  };
};

// CloudFormation template for IAM roles (for deployment)
export const helpdeskIAMCloudFormationTemplate = {
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "IAM roles and policies for TicketFlow Helpdesk application",

  Resources: {
    // Bedrock service role
    BedrockServiceRole: {
      Type: "AWS::IAM::Role",
      Properties: {
        RoleName: "TicketFlowBedrockRole",
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "ec2.amazonaws.com",
              },
              Action: "sts:AssumeRole",
            },
          ],
        },
        Policies: [
          {
            PolicyName: "BedrockMinimalAccess",
            PolicyDocument: bedrockMinimalPolicy,
          },
        ],
        Tags: [
          {
            Key: "Application",
            Value: "TicketFlow",
          },
          {
            Key: "Service",
            Value: "Bedrock",
          },
        ],
      },
    },

    // SES service role
    SESServiceRole: {
      Type: "AWS::IAM::Role",
      Properties: {
        RoleName: "TicketFlowSESRole",
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "ec2.amazonaws.com",
              },
              Action: "sts:AssumeRole",
            },
          ],
        },
        Policies: [
          {
            PolicyName: "SESMinimalAccess",
            PolicyDocument: sesMinimalPolicy,
          },
        ],
        Tags: [
          {
            Key: "Application",
            Value: "TicketFlow",
          },
          {
            Key: "Service",
            Value: "SES",
          },
        ],
      },
    },

    // Instance profile for EC2
    HelpdeskInstanceProfile: {
      Type: "AWS::IAM::InstanceProfile",
      Properties: {
        Roles: [{ Ref: "BedrockServiceRole" }],
      },
    },
  },

  Outputs: {
    BedrockRoleArn: {
      Description: "ARN of the Bedrock service role",
      Value: { "Fn::GetAtt": ["BedrockServiceRole", "Arn"] },
      Export: {
        Name: "TicketFlow-BedrockRoleArn",
      },
    },
    SESRoleArn: {
      Description: "ARN of the SES service role",
      Value: { "Fn::GetAtt": ["SESServiceRole", "Arn"] },
      Export: {
        Name: "TicketFlow-SESRoleArn",
      },
    },
  },
};

// Usage examples and deployment instructions
export const deploymentInstructions = `
# AWS IAM Setup Instructions for TicketFlow Helpdesk

## Option 1: Manual IAM User Creation

1. Create separate IAM users for different services:
   - ticketflow-bedrock-user (for AI operations)
   - ticketflow-ses-user (for email operations)

2. Attach minimal policies to each user:
   - For Bedrock user: Use bedrockMinimalPolicy
   - For SES user: Use sesMinimalPolicy

3. Generate access keys for each user

4. Set environment variables:
   export AWS_BEDROCK_ACCESS_KEY_ID="AKIA..."
   export AWS_BEDROCK_SECRET_ACCESS_KEY="..."
   export AWS_SES_ACCESS_KEY_ID="AKIA..."
   export AWS_SES_SECRET_ACCESS_KEY="..."
   export AWS_REGION="us-east-1"

## Option 2: CloudFormation Deployment

1. Save the CloudFormation template to a file (iam-roles.yaml)
2. Deploy using AWS CLI:
   aws cloudformation create-stack \\
     --stack-name ticketflow-iam \\
     --template-body file://iam-roles.yaml \\
     --capabilities CAPABILITY_NAMED_IAM

## Option 3: IAM Roles (Recommended for EC2/ECS)

1. Use the CloudFormation template to create roles
2. Attach roles to your EC2 instances or ECS tasks
3. No need to manage access keys

## Security Best Practices

1. **Principle of Least Privilege**: Only grant necessary permissions
2. **Separate Credentials**: Use different IAM users/roles for different services
3. **Regular Rotation**: Rotate access keys every 90 days
4. **Monitor Usage**: Enable CloudTrail for API call monitoring
5. **Environment Variables**: Never hardcode credentials in source code
6. **Encryption**: Use encrypted storage for sensitive configuration

## Monitoring and Alerts

Set up CloudWatch alarms for:
- Unusual API call patterns
- Failed authentication attempts
- High usage of AI API calls
- Email bounce rates

## Cost Management

- Set up billing alerts for AWS services
- Monitor Bedrock token usage
- Implement usage quotas in the application
`;
