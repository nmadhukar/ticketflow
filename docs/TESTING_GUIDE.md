# AWS Bedrock Knowledge Base - Testing Guide

## Overview

This guide helps you test the AWS Bedrock Knowledge Base integration at different stages of implementation.

---

## Test Scenarios

### **Scenario 1: Without Knowledge Base Configured (Current State)**

**Expected Behavior:** System uses manual RAG as fallback

#### Test the AI Chatbot

1. **Login to TicketFlow** as admin or regular user
2. **Click the chat icon** (bottom right corner)
3. **Send a test message:** "How do I reset my password?"

**Expected Results:**
- ✅ Chat window opens successfully
- ✅ Message is sent
- ✅ AI responds (using manual RAG with PostgreSQL search)
- ✅ Response time: 2-5 seconds
- ✅ No "KB" badge shown (indicates manual RAG)
- ❌ No citations displayed (manual RAG doesn't provide citations)

**Backend Behavior:**
```
User query → PostgreSQL keyword search → Extract top 3 docs
→ Build context manually → Call Bedrock directly → Return response
```

**Log Indicators:**
```
Knowledge Base not configured, using manual RAG
Error calling AWS Bedrock: (if no Bedrock credentials)
```

---

### **Scenario 2: With Knowledge Base Configured**

#### Prerequisites

1. **Run setup script:**
   ```bash
   npx tsx scripts/setup-knowledge-base.ts
   ```

2. **Add secrets to Replit:**
   ```
   BEDROCK_KNOWLEDGE_BASE_ID=KB123456
   BEDROCK_DATA_SOURCE_ID=DS123456
   ```

3. **Upload test documents to S3:**
   - help-documents/password-reset.pdf
   - company-policies/remote-work-policy.pdf

4. **Trigger initial sync:**
   ```bash
   curl -X POST https://your-app.replit.dev/api/admin/knowledge-base/sync \
     -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"
   ```

5. **Wait 5-30 minutes** for indexing to complete

#### Test the AI Chatbot

1. **Login and open chat**
2. **Send test message:** "What is the remote work policy?"

**Expected Results:**
- ✅ Chat window opens
- ✅ Message sent
- ✅ AI responds using semantic search
- ✅ Response includes relevant content from policy document
- ✅ **Citations displayed** showing source documents
- ✅ **"KB" badge** shown on assistant message
- ✅ **Better accuracy** than manual RAG
- ✅ Response time: 3-8 seconds (includes semantic search)

**Backend Behavior:**
```
User query → RetrieveAndGenerate API
→ Semantic vector search (OpenSearch) → Top 5 relevant docs
→ Claude generates response with context → Return with citations
```

**Log Indicators:**
```
Using AWS Bedrock Knowledge Base for query: What is the remote work policy?
✓ Response generated with 2 citations
```

---

## API Testing

### Check KB Status

```bash
curl https://your-app.replit.dev/api/admin/knowledge-base/status \
  -H "Cookie: connect.sid=YOUR_SESSION"
```

**Response (Not Configured):**
```json
{
  "configured": false,
  "knowledgeBaseId": null,
  "dataSourceId": null
}
```

**Response (Configured):**
```json
{
  "configured": true,
  "knowledgeBaseId": "KB123456",
  "dataSourceId": "DS123456"
}
```

### Trigger Manual Sync

```bash
curl -X POST https://your-app.replit.dev/api/admin/knowledge-base/sync \
  -H "Cookie: connect.sid=YOUR_SESSION"
```

**Success Response:**
```json
{
  "message": "Knowledge Base sync started successfully",
  "jobId": "JOB123456",
  "status": "STARTING"
}
```

### Check Sync Status

```bash
curl https://your-app.replit.dev/api/admin/knowledge-base/sync/JOB123456 \
  -H "Cookie: connect.sid=YOUR_SESSION"
```

**Response:**
```json
{
  "status": "IN_PROGRESS",
  "statistics": {
    "documentsScanned": 15,
    "documentsIndexed": 10,
    "documentsFailed": 0
  }
}
```

---

## Integration Tests

### Run Automated Tests

```bash
# Test Knowledge Base integration
npx tsx scripts/test-knowledge-base.ts

# Expected output (not configured):
✓ Knowledge Base Configured: false
⚠️  System will use manual RAG as fallback
✓ Basic AI responses will still work

# Expected output (configured):
✓ Knowledge Base Configured: true
✓ Semantic search working
✓ Found 3 relevant documents
✓ Response generated with citations
```

### Test Document Upload Triggers

1. **Upload a help document** via Admin Panel
2. **Check logs** for:
   ```
   Knowledge Base sync triggered after help document upload
   ```

3. **Verify sync job started:**
   ```bash
   curl https://your-app.replit.dev/api/admin/knowledge-base/status
   ```

---

## Visual Testing Checklist

### AI Chatbot UI

- [ ] Chat button visible (bottom right)
- [ ] Click opens chat window
- [ ] Chat window has minimize/maximize buttons
- [ ] Input field accepts text
- [ ] Send button enabled when text present
- [ ] Messages display correctly
- [ ] User messages on right (blue)
- [ ] AI messages on left (gray)
- [ ] Timestamp shown below each message
- [ ] Loading state shows "Searching knowledge base..."
- [ ] Auto-scrolls to latest message

### Knowledge Base Features (when configured)

- [ ] **Citations displayed** below AI responses
- [ ] Citations show source document excerpts
- [ ] **"KB" badge** on AI messages (indicates KB-powered)
- [ ] **"Cached" badge** on repeated questions
- [ ] Token usage displayed (e.g., "245 tokens")
- [ ] Welcome message mentions "AWS Bedrock Knowledge Base"

---

## Performance Benchmarks

### Response Times

| Scenario | Expected Time | Actual |
|----------|--------------|---------|
| Manual RAG (no KB) | 2-5 seconds | _____ |
| Semantic Search (with KB) | 3-8 seconds | _____ |
| Cached Response | < 1 second | _____ |

### Accuracy Comparison

Test Query: "How do I reset my password?"

**Without KB (Manual RAG):**
- Finds documents with words "reset" OR "password"
- May return irrelevant matches
- No understanding of intent

**With KB (Semantic Search):**
- Understands user intent
- Finds semantically similar content
- Better context matching
- More accurate responses

---

## Troubleshooting Tests

### Test 1: No Response from AI

**Possible Causes:**
1. Bedrock credentials not configured
2. Knowledge Base IDs incorrect
3. Network/AWS issues

**Debug:**
```bash
# Check logs
tail -f /tmp/logs/Start_application_*.log | grep -i "bedrock\|knowledge"

# Verify credentials
echo $AWS_ACCESS_KEY_ID | head -c 20
echo $BEDROCK_KNOWLEDGE_BASE_ID
```

### Test 2: Citations Not Showing

**Possible Causes:**
1. Knowledge Base not configured
2. No documents synced
3. Sync job not completed

**Debug:**
```bash
# Check KB status
curl .../api/admin/knowledge-base/status

# Check sync jobs in AWS Console
# Bedrock → Knowledge bases → Your KB → Data sources → Sync history
```

### Test 3: Slow Responses

**Possible Causes:**
1. Cold start (first query of the day)
2. Large document retrieval
3. OpenSearch performance

**Solutions:**
- Warm up with a test query
- Reduce `numberOfResults` in retrieval config
- Check OpenSearch OCU allocation

---

## Success Criteria

### Minimum (Without KB)

- [x] AI chatbot opens and closes
- [x] Messages send and receive
- [x] AI responds using manual RAG
- [x] Fallback works gracefully

### Full (With KB)

- [ ] Knowledge Base configured
- [ ] Documents synced successfully
- [ ] Semantic search returns results
- [ ] Citations displayed
- [ ] KB badge shown
- [ ] Accuracy improved vs. manual RAG
- [ ] Auto-sync on document upload

---

## Test Report Template

```
Test Date: __________
Tester: __________
Environment: Development / Production

## Configuration
- [ ] Knowledge Base Configured: Yes / No
- [ ] KB ID: __________
- [ ] Data Source ID: __________
- [ ] Documents Synced: ____ documents

## Functional Tests
- [ ] Chat UI opens/closes
- [ ] Send message works
- [ ] Receive response works
- [ ] Citations displayed (if KB configured)
- [ ] Auto-sync on upload

## Performance
- Average response time: ____ seconds
- Semantic search accuracy: ____

## Issues Found
1. ____________________
2. ____________________

## Notes
____________________
```

---

## Next Steps After Testing

### If Tests Pass ✅

1. Configure Knowledge Base for production
2. Upload all help documents
3. Perform initial sync
4. Train users on new chatbot features
5. Monitor usage and costs

### If Tests Fail ❌

1. Check logs for errors
2. Verify AWS credentials
3. Confirm KB configuration
4. Review troubleshooting section
5. Contact support if needed

---

## Continuous Testing

### Daily

- [ ] Chat responds within 5 seconds
- [ ] No errors in logs

### Weekly

- [ ] Review Bedrock costs
- [ ] Check sync job success rate
- [ ] Test query accuracy

### Monthly

- [ ] Performance benchmark
- [ ] User feedback review
- [ ] Knowledge Base cleanup

---

## Support Resources

- **Setup Guide**: `docs/AWS_KNOWLEDGE_BASE_SETUP.md`
- **Test Script**: `scripts/test-knowledge-base.ts`
- **Application Logs**: `/tmp/logs/Start_application_*.log`
- **AWS Console**: Bedrock → Knowledge bases
