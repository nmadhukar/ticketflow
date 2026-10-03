# AWS Bedrock: Create and Configure Plan

## 1) Prerequisites

- AWS account with admin access (or delegated permissions to manage IAM, Bedrock, VPC, Budgets, CloudTrail).
- Choose a supported region for Bedrock (e.g., us-east-1, us-west-2, eu-central-1). Use the SAME region in the app.
- If running on EC2: instance profile attachment rights.

## 2) Enable Bedrock and Request Model Access

1. In the AWS Console, switch to your chosen region.
2. Open “Amazon Bedrock” → Get started.
3. Left nav → “Model access” → “Manage model access”.
4. Check the models to enable (recommended):

   - anthropic.claude-3-sonnet-20240229-v1:0
   - anthropic.claude-3-haiku-20240307-v1:0
   - (optional) anthropic.claude-3-opus-20240229-v1:0

5. Submit. Wait until each shows “Access granted”.
6. Optional: Open “Playground” and verify you can prompt a model.

## 3) IAM: Least-Privilege Policies

### 3.1 Create an invoke-only policy (TicketFlowBedrockInvoke)

- IAM → Policies → Create policy → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowInvokeSelectedModels",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
      ],
      "Condition": {
        "StringEquals": { "aws:RequestedRegion": "us-east-1" }
      }
    }
  ]
}
```

- Adjust region and model IDs as needed.

### 3.2 Attach to runtime identities

- EC2: IAM → Roles → Create role (trusted entity = EC2) → attach TicketFlowBedrockInvoke → create instance profile → attach the role to your EC2 instance.
- Local/dev (temporary): Create IAM user with programmatic access, attach TicketFlowBedrockInvoke; download Access Key/Secret; prefer storing in AWS Secrets Manager.

### 3.3 Admins (temporary)

- Admin human users may use AWS-managed AmazonBedrockFullAccess only for setup/testing, then revert to narrower permissions.

## 4) Networking (VPC / Private Subnets)

- If your EC2 runs in private subnets (no direct Internet), add VPC interface endpoints:
  - com.amazonaws.<region>.bedrock-runtime
  - com.amazonaws.<region>.bedrock
- Security groups must allow the instance to reach these endpoints on HTTPS (443).
- If you use S3-based assets (KB/docs), add an S3 Gateway Endpoint for the VPC.
- If you have NAT egress, ensure HTTPS to Bedrock is allowed.

## 5) Observability and Guardrails

- CloudTrail: ensure it’s enabled to log Bedrock API calls; store logs in an S3 bucket.
- Budgets: set a monthly budget with email alerts (e.g., 50/100/150 USD thresholds).
- (Optional) CloudWatch metrics/alarms on app logs (tokens/cost tracking is app-level; Bedrock emits API events via CloudTrail).

## 6) Service Quotas

- Service Quotas → Amazon Bedrock → review default TPS/token quotas; request increases if needed based on expected traffic.

## 7) Validate Access

### 7.1 Console Playground

- Amazon Bedrock → Playground → Select Claude 3 Sonnet → Send a simple prompt; confirm response.

### 7.2 CLI quick test (from a machine with the right role/keys)

```bash
aws configure set region us-east-1
aws bedrock-runtime invoke-model \
  --model-id anthropic.claude-3-sonnet-20240229-v1:0 \
  --content-type application/json \
  --accept application/json \
  --body '{
    "anthropic_version":"bedrock-2023-05-31",
    "max_tokens":64,
    "temperature":0.3,
    "messages":[{"role":"user","content":"Say hello in one sentence."}]
  }' \
  output.json && type output.json
```

- Expect a JSON with a short reply. If AccessDenied, re-check model access, region, role/policy.

## 8) App Integration (TicketFlow)

- Prefer EC2 instance role (no static keys). If you must use keys:
  - Set in the app’s Admin panel (Email/AWS config) or environment variables used by the server:
    - AWS_ACCESS_KEY_ID
    - AWS_SECRET_ACCESS_KEY
    - AWS_REGION (must match Bedrock region)
- In the app’s AI settings page, click “Test Connection” to verify (server uses bedrock runtime client).

## 9) Security Best Practices

- Favor instance roles over long-lived keys; rotate any user keys.
- Restrict to exact Foundation Model ARNs and the specific region.
- Separate roles for staging vs production; don’t share keys/roles.
- Principle of least privilege; no wildcards unless truly required.
- For private subnets, prefer VPC endpoints over public NAT egress.

## 10) Troubleshooting Tips

- AccessDeniedException: model access not granted, wrong region, or policy doesn’t include the model ARN.
- Throttling/Throughput: hit quotas; request increases.
- Endpoint/Networking: private subnet without VPC endpoints or missing SG rules.
- SignatureDoesNotMatch/ClockSkew: system clock drift; sync NTP.
- Model ID mismatch: confirm exact model ID and ARN format in your region.
