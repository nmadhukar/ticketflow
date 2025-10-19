# AWS Bedrock Knowledge Base Integration Guide

## Overview

TicketFlow now supports AWS Bedrock Knowledge Bases for semantic search and intelligent document retrieval. This enables:

- **Semantic Vector Search**: Find relevant documents based on meaning, not just keywords
- **Automatic Embeddings**: AWS generates and manages vector embeddings automatically
- **RetrieveAndGenerate API**: AI automatically retrieves context and generates responses
- **Citation Tracking**: Know exactly which documents were used in responses
- **Real-time Sync**: Documents uploaded to S3 are automatically indexed

## Architecture

```
Document Upload Flow:
Upload to S3 (help-documents/, company-policies/, user-guides/)
    ↓
Backend triggers Knowledge Base sync
    ↓
AWS generates vector embeddings (Titan Embed)
    ↓
Stores in OpenSearch Serverless
    ↓
Ready for semantic search

Query Flow:
User asks question
    ↓
RetrieveAndGenerate API
    ↓
Semantic search finds top 5 relevant docs
    ↓
Claude 3 Sonnet generates response with context
    ↓
Returns answer + citations
```

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **IAM User** with access to:
   - Bedrock (model access + Knowledge Base)
   - OpenSearch Serverless
   - S3 (existing bucket)
   - IAM (for role creation)
3. **AWS Account ID** (12-digit number)
4. **S3 Bucket** already configured (e.g., `talbot-helpdesk-tickets`)

## Setup Instructions

### Step 1: Enable Bedrock Model Access

1. Go to AWS Console → Bedrock → Model access
2. Request access to:
   - **Claude 3 Sonnet** (for chat responses)
   - **Titan Embeddings G1 - Text** (for vector embeddings)
3. Wait for approval (usually instant for Claude, may take 1-2 days for Titan in some regions)

### Step 2: Get AWS Account ID

```bash
# Via AWS CLI
aws sts get-caller-identity --query Account --output text

# Or find in AWS Console → My Account → Account Settings
```

### Step 3: Set Replit Secrets

Add these to your Replit Secrets (before running setup script):

```
AWS_ACCOUNT_ID=123456789012
S3_BUCKET_NAME=talbot-helpdesk-tickets
AWS_ACCESS_KEY_ID=AKIAXXXXXXXX
AWS_SECRET_ACCESS_KEY=XXXXXXXX
AWS_REGION=us-east-2
```

### Step 4: Run Infrastructure Setup Script

This script creates:
- IAM role for Knowledge Base
- OpenSearch Serverless collection
- Bedrock Knowledge Base
- S3 data source

```bash
npx tsx scripts/setup-knowledge-base.ts
```

**Expected output:**
```
🚀 Starting AWS Bedrock Knowledge Base setup...

Step 1: Creating IAM role for Knowledge Base...
✅ IAM role created: arn:aws:iam::123456789012:role/TicketFlowKnowledgeBaseRole

Step 2: Creating OpenSearch Serverless collection...
✅ Encryption policy created
✅ Network policy created
✅ Access policy created
✅ Collection created: arn:aws:aoss:us-east-2:123456789012:collection/abc123

Step 3: Creating Bedrock Knowledge Base...
✅ Knowledge Base created: KB123456

Step 4: Creating S3 data source...
✅ Data source created: DS123456

✅ Setup complete! Add these to your Replit Secrets:

BEDROCK_KNOWLEDGE_BASE_ID=KB123456
BEDROCK_DATA_SOURCE_ID=DS123456
```

### Step 5: Add Knowledge Base IDs to Secrets

Copy the IDs from the script output and add to Replit Secrets:

```
BEDROCK_KNOWLEDGE_BASE_ID=KB123456
BEDROCK_DATA_SOURCE_ID=DS123456
```

### Step 6: Initial Document Sync

Once configured, sync your existing documents:

1. Go to Admin Panel → Settings
2. Navigate to "Knowledge Base" section
3. Click "Sync Knowledge Base"
4. Monitor sync job status

**Or via API:**
```bash
curl -X POST https://your-app.replit.dev/api/admin/knowledge-base/sync \
  -H "Content-Type: application/json" \
  -b "your-session-cookie"
```

## Usage

### Automatic Sync

Knowledge Base automatically syncs when you:
- Upload a new Help Document
- Create/update a Company Policy
- Publish a Knowledge Article
- Update any existing documents

### Manual Sync

**Admin Panel:**
1. Settings → Knowledge Base
2. Click "Sync Now"
3. View sync job status

**API Endpoints:**
```bash
# Check status
GET /api/admin/knowledge-base/status

# Start sync
POST /api/admin/knowledge-base/sync

# Check sync job
GET /api/admin/knowledge-base/sync/{jobId}

# List data sources
GET /api/admin/knowledge-base/data-sources
```

### Chat Behavior

**With Knowledge Base:**
- Uses semantic search (understands meaning)
- Provides citations to source documents
- Better accuracy for complex queries
- Maintains conversation context

**Without Knowledge Base (Fallback):**
- Uses PostgreSQL keyword search
- No citations
- Basic text matching
- Still functional, but less accurate

## Cost Estimation

### OpenSearch Serverless
- **OCU (OpenSearch Compute Units)**: ~$0.24/hour per OCU
- **Minimum**: 2 OCUs = ~$350/month for always-on
- **Alternative**: Use on-demand pricing during business hours only

### Bedrock Costs
- **Claude 3 Sonnet**: $3 per 1M input tokens, $15 per 1M output tokens
- **Titan Embeddings**: $0.10 per 1M tokens
- **Typical Usage**: 100 queries/day = ~$5-10/month

### Total Estimated Cost
- **Small Organization** (< 500 docs, 100 queries/day): ~$360/month
- **Medium Organization** (1000-5000 docs, 500 queries/day): ~$400/month
- **Large Organization** (10,000+ docs, 1000+ queries/day): ~$500+/month

## Cost Reduction Strategies

1. **FAQ Cache**: Already implemented - caches responses for 7 days
2. **Limited Hours**: Configure OpenSearch to scale down during off-hours
3. **Regional Pricing**: Some regions are cheaper (check AWS pricing)
4. **Embedding Batch**: Group documents before syncing

## Troubleshooting

### Error: "Knowledge Base not configured"

**Solution:** Ensure these secrets are set:
- `BEDROCK_KNOWLEDGE_BASE_ID`
- `BEDROCK_DATA_SOURCE_ID`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`

### Error: "ValidationException: Model access not granted"

**Solution:** Request model access in Bedrock console:
1. AWS Console → Bedrock → Model access
2. Request Claude 3 Sonnet and Titan Embeddings
3. Wait for approval

### Error: "AccessDeniedException"

**Solution:** Ensure IAM user has these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:*",
        "aoss:*",
        "s3:GetObject",
        "s3:ListBucket",
        "iam:CreateRole",
        "iam:AttachRolePolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

### Sync Job Stuck in "IN_PROGRESS"

**Solution:**
1. Check S3 bucket has documents in correct folders
2. Verify data source configuration includes:
   - `help-documents/`
   - `company-policies/`
   - `user-guides/`
3. Check CloudWatch Logs for errors

### No Results from Semantic Search

**Solution:**
1. Ensure sync job completed successfully
2. Wait 5-10 minutes after sync for indexing
3. Check documents are in S3 with correct folder structure
4. Verify OpenSearch collection is active

## Monitoring

### Check Sync Status
```bash
# Get current status
curl https://your-app.replit.dev/api/admin/knowledge-base/status

# Response:
{
  "configured": true,
  "knowledgeBaseId": "KB123456",
  "dataSourceId": "DS123456"
}
```

### View Sync Jobs
1. AWS Console → Bedrock → Knowledge bases
2. Select your Knowledge Base
3. Click "Data sources"
4. View "Sync history"

### CloudWatch Logs
- OpenSearch logs: `/aws/opensearchserverless/collections/ticketflow-kb-collection`
- Knowledge Base logs: `/aws/bedrock/knowledge-base/KB123456`

## Fallback Behavior

The system gracefully falls back to manual RAG if:
- Knowledge Base not configured
- AWS credentials missing
- API call fails
- Quota exceeded

**Fallback mode uses:**
- PostgreSQL full-text search
- Direct Bedrock API (Claude Instant)
- Manual context building
- Still provides AI responses, just without semantic search

## Production Deployment

For production deployment:

1. **Use IAM Roles** instead of access keys (if on EC2)
2. **Enable CloudWatch Alarms** for sync failures
3. **Monitor Costs** via AWS Cost Explorer
4. **Set Up Alerts** for quota limits
5. **Backup Strategy** for OpenSearch (automatic snapshots)
6. **Test Failover** to ensure fallback works

## Support

For issues with:
- **AWS Setup**: AWS Support or StackOverflow
- **TicketFlow Integration**: Check application logs
- **API Errors**: Enable debug logging in `server/awsKnowledgeBase.ts`

## References

- [AWS Bedrock Knowledge Bases Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [OpenSearch Serverless Guide](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless.html)
- [Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
