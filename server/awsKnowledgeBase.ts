/**
 * AWS Bedrock Knowledge Base Integration
 * 
 * Manages document synchronization with AWS Bedrock Knowledge Bases
 * for semantic search and RAG (Retrieval Augmented Generation).
 * 
 * Features:
 * - Automatic document syncing to Knowledge Base
 * - Semantic vector search using embeddings
 * - RetrieveAndGenerate for AI responses with citations
 * - Data source ingestion job management
 */

import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListDataSourcesCommand,
} from "@aws-sdk/client-bedrock-agent";
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const KNOWLEDGE_BASE_ID = process.env.BEDROCK_KNOWLEDGE_BASE_ID || '';
const DATA_SOURCE_ID = process.env.BEDROCK_DATA_SOURCE_ID || '';

let bedrockAgentClient: BedrockAgentClient | null = null;
let bedrockAgentRuntimeClient: BedrockAgentRuntimeClient | null = null;

/**
 * Initialize Bedrock Agent clients
 */
function initializeClients() {
  if (!bedrockAgentClient) {
    bedrockAgentClient = new BedrockAgentClient({
      region: AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  if (!bedrockAgentRuntimeClient) {
    bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({
      region: AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  return { bedrockAgentClient, bedrockAgentRuntimeClient };
}

/**
 * Check if Knowledge Base is configured
 */
export function isKnowledgeBaseConfigured(): boolean {
  return !!(KNOWLEDGE_BASE_ID && DATA_SOURCE_ID && process.env.AWS_ACCESS_KEY_ID);
}

/**
 * Trigger ingestion job to sync S3 documents to Knowledge Base
 * Call this after uploading new documents to S3
 */
export async function syncKnowledgeBase(): Promise<{
  jobId: string;
  status: string;
}> {
  if (!isKnowledgeBaseConfigured()) {
    throw new Error('Knowledge Base not configured. Set BEDROCK_KNOWLEDGE_BASE_ID and BEDROCK_DATA_SOURCE_ID.');
  }

  const { bedrockAgentClient } = initializeClients();

  try {
    const command = new StartIngestionJobCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      dataSourceId: DATA_SOURCE_ID,
      description: `Sync triggered at ${new Date().toISOString()}`,
    });

    const response = await bedrockAgentClient!.send(command);

    console.log('Knowledge Base sync started:', {
      jobId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status,
    });

    return {
      jobId: response.ingestionJob?.ingestionJobId || '',
      status: response.ingestionJob?.status || 'STARTING',
    };
  } catch (error) {
    console.error('Error syncing Knowledge Base:', error);
    throw error;
  }
}

/**
 * Check status of an ingestion job
 */
export async function getIngestionJobStatus(jobId: string): Promise<{
  status: string;
  statistics?: any;
}> {
  if (!isKnowledgeBaseConfigured()) {
    throw new Error('Knowledge Base not configured');
  }

  const { bedrockAgentClient } = initializeClients();

  try {
    const command = new GetIngestionJobCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      dataSourceId: DATA_SOURCE_ID,
      ingestionJobId: jobId,
    });

    const response = await bedrockAgentClient!.send(command);

    return {
      status: response.ingestionJob?.status || 'UNKNOWN',
      statistics: response.ingestionJob?.statistics,
    };
  } catch (error) {
    console.error('Error getting ingestion job status:', error);
    throw error;
  }
}

/**
 * Retrieve relevant documents from Knowledge Base using semantic search
 */
export async function retrieveDocuments(
  query: string,
  numberOfResults: number = 5
): Promise<Array<{
  content: string;
  score: number;
  location?: any;
  metadata?: any;
}>> {
  if (!isKnowledgeBaseConfigured()) {
    throw new Error('Knowledge Base not configured');
  }

  const { bedrockAgentRuntimeClient } = initializeClients();

  try {
    const command = new RetrieveCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      retrievalQuery: {
        text: query,
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults,
        },
      },
    });

    const response = await bedrockAgentRuntimeClient!.send(command);

    return (response.retrievalResults || []).map(result => ({
      content: result.content?.text || '',
      score: result.score || 0,
      location: result.location,
      metadata: result.metadata,
    }));
  } catch (error) {
    console.error('Error retrieving documents:', error);
    throw error;
  }
}

/**
 * Ask a question using Knowledge Base + Bedrock model
 * This uses RetrieveAndGenerate which automatically:
 * 1. Retrieves relevant documents
 * 2. Constructs prompt with context
 * 3. Generates response with citations
 */
export async function askKnowledgeBase(
  question: string,
  modelArn?: string
): Promise<{
  answer: string;
  citations: Array<{
    content: string;
    location?: any;
  }>;
  sessionId?: string;
}> {
  if (!isKnowledgeBaseConfigured()) {
    throw new Error('Knowledge Base not configured');
  }

  const { bedrockAgentRuntimeClient } = initializeClients();

  // Default to Claude 3 Sonnet
  const model = modelArn || `arn:aws:bedrock:${AWS_REGION}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`;

  try {
    const command = new RetrieveAndGenerateCommand({
      input: {
        text: question,
      },
      retrieveAndGenerateConfiguration: {
        type: "KNOWLEDGE_BASE",
        knowledgeBaseConfiguration: {
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          modelArn: model,
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 5,
            },
          },
        },
      },
    });

    const response = await bedrockAgentRuntimeClient!.send(command);

    const citations = (response.citations || []).map(citation => ({
      content: citation.retrievedReferences?.[0]?.content?.text || '',
      location: citation.retrievedReferences?.[0]?.location,
    }));

    return {
      answer: response.output?.text || '',
      citations,
      sessionId: response.sessionId,
    };
  } catch (error) {
    console.error('Error asking Knowledge Base:', error);
    throw error;
  }
}

/**
 * Ask follow-up question in the same session
 * Maintains conversation context
 */
export async function askFollowUp(
  question: string,
  sessionId: string,
  modelArn?: string
): Promise<{
  answer: string;
  citations: Array<{
    content: string;
    location?: any;
  }>;
  sessionId?: string;
}> {
  if (!isKnowledgeBaseConfigured()) {
    throw new Error('Knowledge Base not configured');
  }

  const { bedrockAgentRuntimeClient } = initializeClients();

  const model = modelArn || `arn:aws:bedrock:${AWS_REGION}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`;

  try {
    const command = new RetrieveAndGenerateCommand({
      input: {
        text: question,
      },
      retrieveAndGenerateConfiguration: {
        type: "KNOWLEDGE_BASE",
        knowledgeBaseConfiguration: {
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          modelArn: model,
        },
      },
      sessionId, // Continue previous conversation
    });

    const response = await bedrockAgentRuntimeClient!.send(command);

    const citations = (response.citations || []).map(citation => ({
      content: citation.retrievedReferences?.[0]?.content?.text || '',
      location: citation.retrievedReferences?.[0]?.location,
    }));

    return {
      answer: response.output?.text || '',
      citations,
      sessionId: response.sessionId,
    };
  } catch (error) {
    console.error('Error asking follow-up:', error);
    throw error;
  }
}

/**
 * List all data sources in the Knowledge Base
 */
export async function listDataSources(): Promise<Array<{
  dataSourceId: string;
  name: string;
  status: string;
}>> {
  if (!isKnowledgeBaseConfigured()) {
    throw new Error('Knowledge Base not configured');
  }

  const { bedrockAgentClient } = initializeClients();

  try {
    const command = new ListDataSourcesCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
    });

    const response = await bedrockAgentClient!.send(command);

    return (response.dataSourceSummaries || []).map(ds => ({
      dataSourceId: ds.dataSourceId || '',
      name: ds.name || '',
      status: ds.status || 'UNKNOWN',
    }));
  } catch (error) {
    console.error('Error listing data sources:', error);
    throw error;
  }
}

export const knowledgeBaseService = {
  isConfigured: isKnowledgeBaseConfigured,
  sync: syncKnowledgeBase,
  getJobStatus: getIngestionJobStatus,
  retrieve: retrieveDocuments,
  ask: askKnowledgeBase,
  askFollowUp,
  listDataSources,
};
