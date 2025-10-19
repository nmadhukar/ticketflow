/**
 * AWS Bedrock Knowledge Base Setup Script
 * 
 * This script sets up the required AWS infrastructure for Knowledge Base:
 * 1. OpenSearch Serverless collection
 * 2. Bedrock Knowledge Base
 * 3. S3 data source configuration
 * 
 * Prerequisites:
 * - AWS CLI configured with appropriate credentials
 * - IAM permissions for Bedrock, OpenSearch Serverless, and S3
 * 
 * Usage:
 * npx tsx scripts/setup-knowledge-base.ts
 */

import {
  OpenSearchServerlessClient,
  CreateCollectionCommand,
  CreateSecurityPolicyCommand,
  CreateAccessPolicyCommand,
} from "@aws-sdk/client-opensearchserverless";
import {
  BedrockAgentClient,
  CreateKnowledgeBaseCommand,
  CreateDataSourceCommand,
} from "@aws-sdk/client-bedrock-agent";
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, PutRolePolicyCommand } from "@aws-sdk/client-iam";

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || '';
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || '';

if (!S3_BUCKET_NAME || !AWS_ACCOUNT_ID) {
  console.error('Error: S3_BUCKET_NAME and AWS_ACCOUNT_ID environment variables are required');
  console.error('Set them in Replit Secrets:');
  console.error('  S3_BUCKET_NAME - your S3 bucket name');
  console.error('  AWS_ACCOUNT_ID - your AWS account ID (12 digits)');
  process.exit(1);
}

const opensearchClient = new OpenSearchServerlessClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const bedrockClient = new BedrockAgentClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const iamClient = new IAMClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

async function setupKnowledgeBase() {
  console.log('🚀 Starting AWS Bedrock Knowledge Base setup...\n');

  try {
    // Step 1: Create IAM role for Knowledge Base
    console.log('Step 1: Creating IAM role for Knowledge Base...');
    const roleName = 'TicketFlowKnowledgeBaseRole';
    
    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: 'bedrock.amazonaws.com',
          },
          Action: 'sts:AssumeRole',
        },
      ],
    };

    let roleArn: string;
    try {
      const createRoleResponse = await iamClient.send(
        new CreateRoleCommand({
          RoleName: roleName,
          AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
          Description: 'Role for Bedrock Knowledge Base to access S3 and OpenSearch',
        })
      );
      roleArn = createRoleResponse.Role!.Arn!;
      console.log(`✅ IAM role created: ${roleArn}`);
    } catch (error: any) {
      if (error.name === 'EntityAlreadyExists') {
        roleArn = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${roleName}`;
        console.log(`⚠️  IAM role already exists: ${roleArn}`);
      } else {
        throw error;
      }
    }

    // Attach policies to role
    const s3Policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:ListBucket'],
          Resource: [
            `arn:aws:s3:::${S3_BUCKET_NAME}`,
            `arn:aws:s3:::${S3_BUCKET_NAME}/*`,
          ],
        },
      ],
    };

    await iamClient.send(
      new PutRolePolicyCommand({
        RoleName: roleName,
        PolicyName: 'S3AccessPolicy',
        PolicyDocument: JSON.stringify(s3Policy),
      })
    );
    console.log('✅ S3 access policy attached to role\n');

    // Wait for IAM role to propagate
    console.log('⏳ Waiting 10 seconds for IAM role to propagate...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Step 2: Create OpenSearch Serverless collection
    console.log('Step 2: Creating OpenSearch Serverless collection...');
    const collectionName = 'ticketflow-kb-collection';

    // Create encryption policy
    const encryptionPolicy = {
      Rules: [
        {
          ResourceType: 'collection',
          Resource: [`collection/${collectionName}`],
        },
      ],
      AWSOwnedKey: true,
    };

    try {
      await opensearchClient.send(
        new CreateSecurityPolicyCommand({
          name: `${collectionName}-encryption`,
          type: 'encryption',
          policy: JSON.stringify(encryptionPolicy),
        })
      );
      console.log('✅ Encryption policy created');
    } catch (error: any) {
      if (error.name !== 'ConflictException') throw error;
      console.log('⚠️  Encryption policy already exists');
    }

    // Create network policy (VPC access only for security)
    // Note: For production, restrict to specific VPCs
    // For testing/development, we allow public access but with strict data access policies
    const networkPolicy = [
      {
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`],
          },
          {
            ResourceType: 'dashboard',
            Resource: [`collection/${collectionName}`],
          },
        ],
        AllowFromPublic: true, // Change to false and add VPC config for production
      },
    ];

    try {
      await opensearchClient.send(
        new CreateSecurityPolicyCommand({
          name: `${collectionName}-network`,
          type: 'network',
          policy: JSON.stringify(networkPolicy),
        })
      );
      console.log('✅ Network policy created');
    } catch (error: any) {
      if (error.name !== 'ConflictException') throw error;
      console.log('⚠️  Network policy already exists');
    }

    // Create data access policy
    const dataAccessPolicy = [
      {
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`],
            Permission: [
              'aoss:CreateCollectionItems',
              'aoss:UpdateCollectionItems',
              'aoss:DescribeCollectionItems',
            ],
          },
          {
            ResourceType: 'index',
            Resource: [`index/${collectionName}/*`],
            Permission: [
              'aoss:CreateIndex',
              'aoss:UpdateIndex',
              'aoss:DescribeIndex',
              'aoss:ReadDocument',
              'aoss:WriteDocument',
            ],
          },
        ],
        Principal: [roleArn],
      },
    ];

    try {
      await opensearchClient.send(
        new CreateAccessPolicyCommand({
          name: `${collectionName}-access`,
          type: 'data',
          policy: JSON.stringify(dataAccessPolicy),
        })
      );
      console.log('✅ Access policy created');
    } catch (error: any) {
      if (error.name !== 'ConflictException') throw error;
      console.log('⚠️  Access policy already exists');
    }

    // Create collection
    let collectionArn: string;
    let collectionId: string;
    try {
      const collectionResponse = await opensearchClient.send(
        new CreateCollectionCommand({
          name: collectionName,
          type: 'VECTORSEARCH',
          description: 'Vector search collection for TicketFlow Knowledge Base',
        })
      );
      collectionArn = collectionResponse.createCollectionDetail!.arn!;
      collectionId = collectionResponse.createCollectionDetail!.id!;
      console.log(`✅ Collection created: ${collectionArn}`);
    } catch (error: any) {
      if (error.name === 'ConflictException') {
        console.log(`⚠️  Collection already exists, using existing collection`);
        // For existing collections, we need to construct the ARN
        // In production, you should query the collection to get its exact ID
        // For now, we'll use a placeholder that will need manual configuration
        console.warn('⚠️  Please manually configure BEDROCK_KNOWLEDGE_BASE_ID and BEDROCK_DATA_SOURCE_ID');
        console.warn('   from your existing AWS Bedrock Knowledge Base');
        process.exit(0);
      } else {
        throw error;
      }
    }

    console.log('⏳ Waiting 30 seconds for collection to become active...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    console.log('');

    // Step 3: Create Bedrock Knowledge Base
    console.log('Step 3: Creating Bedrock Knowledge Base...');
    const kbName = 'TicketFlowKnowledgeBase';

    const kbResponse = await bedrockClient.send(
      new CreateKnowledgeBaseCommand({
        name: kbName,
        description: 'Knowledge Base for TicketFlow help documents, policies, and guides',
        roleArn,
        knowledgeBaseConfiguration: {
          type: 'VECTOR',
          vectorKnowledgeBaseConfiguration: {
            embeddingModelArn: `arn:aws:bedrock:${AWS_REGION}::foundation-model/amazon.titan-embed-text-v1`,
          },
        },
        storageConfiguration: {
          type: 'OPENSEARCH_SERVERLESS',
          opensearchServerlessConfiguration: {
            collectionArn,
            vectorIndexName: 'ticketflow-vector-index',
            fieldMapping: {
              vectorField: 'vector',
              textField: 'text',
              metadataField: 'metadata',
            },
          },
        },
      })
    );

    const knowledgeBaseId = kbResponse.knowledgeBase!.knowledgeBaseId!;
    console.log(`✅ Knowledge Base created: ${knowledgeBaseId}\n`);

    // Step 4: Create S3 Data Source
    console.log('Step 4: Creating S3 data source...');
    const dataSourceResponse = await bedrockClient.send(
      new CreateDataSourceCommand({
        knowledgeBaseId,
        name: 'S3DocumentSource',
        description: 'S3 bucket containing help documents and policies',
        dataSourceConfiguration: {
          type: 'S3',
          s3Configuration: {
            bucketArn: `arn:aws:s3:::${S3_BUCKET_NAME}`,
            inclusionPrefixes: ['help-documents/', 'company-policies/', 'user-guides/'],
          },
        },
      })
    );

    const dataSourceId = dataSourceResponse.dataSource!.dataSourceId!;
    console.log(`✅ Data source created: ${dataSourceId}\n`);

    // Print summary
    console.log('✅ Setup complete! Add these to your Replit Secrets:\n');
    console.log(`BEDROCK_KNOWLEDGE_BASE_ID=${knowledgeBaseId}`);
    console.log(`BEDROCK_DATA_SOURCE_ID=${dataSourceId}\n`);
    console.log('📝 Next steps:');
    console.log('1. Add the above secrets to Replit');
    console.log('2. Upload documents to S3 (help-documents/, company-policies/, user-guides/)');
    console.log('3. Use the sync endpoint to index documents');
    console.log('4. Test the AI chat with semantic search!\n');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    throw error;
  }
}

// Run setup
setupKnowledgeBase().catch(console.error);
