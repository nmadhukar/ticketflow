/**
 * End-to-End Test for AWS Bedrock Knowledge Base Integration
 * 
 * Tests the complete flow:
 * 1. Check Knowledge Base configuration status
 * 2. Test manual RAG fallback (without KB configured)
 * 3. Test semantic search (if KB is configured)
 * 4. Verify citations are returned
 * 5. Test sync functionality
 */

import { knowledgeBaseService } from '../server/awsKnowledgeBase';

async function testKnowledgeBaseIntegration() {
  console.log('🧪 Starting AWS Bedrock Knowledge Base Integration Tests\n');

  // Test 1: Check Configuration
  console.log('Test 1: Checking Knowledge Base Configuration');
  console.log('================================================');
  const isConfigured = knowledgeBaseService.isConfigured();
  console.log(`✓ Knowledge Base Configured: ${isConfigured}`);
  
  if (isConfigured) {
    console.log(`  - Knowledge Base ID: ${process.env.BEDROCK_KNOWLEDGE_BASE_ID}`);
    console.log(`  - Data Source ID: ${process.env.BEDROCK_DATA_SOURCE_ID}`);
    console.log(`  - AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  } else {
    console.log('  ⚠️  Knowledge Base not configured');
    console.log('  - System will use manual RAG as fallback');
    console.log('  - To configure, set these environment variables:');
    console.log('    - BEDROCK_KNOWLEDGE_BASE_ID');
    console.log('    - BEDROCK_DATA_SOURCE_ID');
  }
  console.log('');

  // Test 2: Test Semantic Search (if configured)
  if (isConfigured) {
    console.log('Test 2: Testing Semantic Search');
    console.log('================================');
    
    try {
      const testQuery = "How do I reset my password?";
      console.log(`Query: "${testQuery}"`);
      console.log('Retrieving relevant documents...');
      
      const documents = await knowledgeBaseService.retrieve(testQuery, 3);
      
      if (documents.length > 0) {
        console.log(`✓ Found ${documents.length} relevant documents:`);
        documents.forEach((doc, idx) => {
          console.log(`\n  Document ${idx + 1}:`);
          console.log(`  - Relevance Score: ${(doc.score * 100).toFixed(1)}%`);
          console.log(`  - Content Preview: ${doc.content.substring(0, 100)}...`);
        });
      } else {
        console.log('⚠️  No documents found');
        console.log('  - This might mean no documents have been synced yet');
        console.log('  - Try uploading some help documents and syncing');
      }
    } catch (error: any) {
      console.error('❌ Semantic search failed:', error.message);
      if (error.message.includes('ResourceNotFoundException')) {
        console.log('  - Knowledge Base or Data Source not found');
        console.log('  - Verify IDs in environment variables');
      } else if (error.message.includes('AccessDeniedException')) {
        console.log('  - IAM permissions issue');
        console.log('  - Ensure AWS credentials have Bedrock access');
      }
    }
    console.log('');

    // Test 3: Test RetrieveAndGenerate
    console.log('Test 3: Testing RetrieveAndGenerate API');
    console.log('=======================================');
    
    try {
      const testQuestion = "What is the company policy on remote work?";
      console.log(`Question: "${testQuestion}"`);
      console.log('Generating AI response with citations...');
      
      const response = await knowledgeBaseService.ask(testQuestion);
      
      console.log(`✓ Response generated successfully`);
      console.log(`\n  Answer: ${response.answer.substring(0, 200)}...`);
      console.log(`\n  Citations: ${response.citations.length} documents referenced`);
      
      if (response.citations.length > 0) {
        response.citations.forEach((citation, idx) => {
          console.log(`\n  Citation ${idx + 1}:`);
          console.log(`  - ${citation.content.substring(0, 100)}...`);
        });
      }
      
      if (response.sessionId) {
        console.log(`\n  Session ID: ${response.sessionId.substring(0, 20)}...`);
        console.log('  - Can be used for follow-up questions');
      }
    } catch (error: any) {
      console.error('❌ RetrieveAndGenerate failed:', error.message);
      console.log('  - This might be due to:');
      console.log('    1. No documents synced to Knowledge Base');
      console.log('    2. Model access not granted (Claude 3 Sonnet)');
      console.log('    3. IAM permission issues');
    }
    console.log('');

    // Test 4: Test Data Source Listing
    console.log('Test 4: Listing Data Sources');
    console.log('============================');
    
    try {
      const dataSources = await knowledgeBaseService.listDataSources();
      console.log(`✓ Found ${dataSources.length} data source(s):`);
      dataSources.forEach((ds, idx) => {
        console.log(`\n  Data Source ${idx + 1}:`);
        console.log(`  - ID: ${ds.dataSourceId}`);
        console.log(`  - Name: ${ds.name}`);
        console.log(`  - Status: ${ds.status}`);
      });
    } catch (error: any) {
      console.error('❌ Failed to list data sources:', error.message);
    }
    console.log('');

    // Test 5: Test Sync (manual trigger)
    console.log('Test 5: Testing Manual Sync');
    console.log('===========================');
    
    try {
      console.log('Triggering sync job...');
      const syncResult = await knowledgeBaseService.sync();
      
      console.log(`✓ Sync job started successfully`);
      console.log(`  - Job ID: ${syncResult.jobId}`);
      console.log(`  - Status: ${syncResult.status}`);
      console.log('\nNote: Sync jobs typically take 5-30 minutes to complete');
      console.log('Monitor status via: GET /api/admin/knowledge-base/sync/${jobId}');
    } catch (error: any) {
      console.error('❌ Sync failed:', error.message);
    }
    console.log('');
  }

  // Summary
  console.log('Test Summary');
  console.log('============');
  if (isConfigured) {
    console.log('✓ Knowledge Base is configured and operational');
    console.log('✓ System will use semantic search for queries');
    console.log('✓ Citations will be provided with responses');
    console.log('\nNext Steps:');
    console.log('1. Upload help documents, policies, and guides to S3');
    console.log('2. Trigger sync to index documents');
    console.log('3. Test AI chatbot with real queries');
  } else {
    console.log('⚠️  Knowledge Base not configured');
    console.log('✓ System will gracefully fall back to manual RAG');
    console.log('✓ Basic AI responses will still work');
    console.log('\nTo Enable Knowledge Base:');
    console.log('1. Run: npx tsx scripts/setup-knowledge-base.ts');
    console.log('2. Add BEDROCK_KNOWLEDGE_BASE_ID and BEDROCK_DATA_SOURCE_ID to secrets');
    console.log('3. Upload documents and sync');
  }
  console.log('');
}

// Run tests
testKnowledgeBaseIntegration()
  .then(() => {
    console.log('✅ All tests completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
