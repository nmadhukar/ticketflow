// AWS Bedrock pricing per 1M tokens (as of 2024)
export const BEDROCK_PRICING = {
  // Amazon Titan Models (Globally Available)
  "amazon.titan-text-express-v1": {
    inputTokens: 0.8, // $0.80 per 1M input tokens
    outputTokens: 3.2, // $3.20 per 1M output tokens
  },
  "amazon.titan-text-lite-v1": {
    inputTokens: 0.3, // $0.30 per 1M input tokens
    outputTokens: 1.2, // $1.20 per 1M output tokens
  },
  "amazon.titan-embed-text-v1": {
    inputTokens: 0.1, // $0.10 per 1M input tokens
    outputTokens: 0.1, // $0.10 per 1M output tokens
  },
  // AI21 Jurassic Models (Globally Available)
  "ai21.j2-mid-v1": {
    inputTokens: 1.25, // $1.25 per 1M input tokens
    outputTokens: 1.25, // $1.25 per 1M output tokens
  },
  "ai21.j2-ultra-v1": {
    inputTokens: 3.75, // $3.75 per 1M input tokens
    outputTokens: 3.75, // $3.75 per 1M output tokens
  },
  // Meta Llama Models (Globally Available)
  "meta.llama2-13b-chat-v1": {
    inputTokens: 0.75, // $0.75 per 1M input tokens
    outputTokens: 0.75, // $0.75 per 1M output tokens
  },
  "meta.llama2-70b-chat-v1": {
    inputTokens: 2.65, // $2.65 per 1M input tokens
    outputTokens: 2.65, // $2.65 per 1M output tokens
  },
  "meta.llama3-8b-instruct-v1:0": {
    inputTokens: 0.6, // $0.60 per 1M input tokens
    outputTokens: 0.6, // $0.60 per 1M output tokens
  },
  "meta.llama3-70b-instruct-v1:0": {
    inputTokens: 2.65, // $2.65 per 1M input tokens
    outputTokens: 2.65, // $2.65 per 1M output tokens
  },
  // Anthropic Claude Models (Limited Regions)
  "anthropic.claude-3-haiku-20240307-v1:0": {
    inputTokens: 0.25, // $0.25 per 1M input tokens
    outputTokens: 1.25, // $1.25 per 1M output tokens
  },
  "anthropic.claude-3-sonnet-20240229-v1:0": {
    inputTokens: 3.0, // $3.00 per 1M input tokens
    outputTokens: 15.0, // $15.00 per 1M output tokens
  },
  "anthropic.claude-3-opus-20240229-v1:0": {
    inputTokens: 15.0, // $15.00 per 1M input tokens
    outputTokens: 75.0, // $75.00 per 1M output tokens
  },
};
