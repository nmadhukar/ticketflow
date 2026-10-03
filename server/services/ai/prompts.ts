import { Task } from "@shared/schema";

/**
 * Standard JSON format requirement text to append to prompts
 * Ensures AI models return parseable JSON without markdown or explanatory text
 */
export const JSON_FORMAT_REQUIREMENT = `

CRITICAL FORMAT REQUIREMENTS:
- Your response must start with { or [ (no text before)
- Return ONLY valid JSON (no markdown code blocks like \`\`\`json)
- Do NOT include explanatory text like "Here is..." or "The result is..."
- Your response must be directly parseable by JSON.parse()
- End with } or ] (no text after)

Example CORRECT: {"key": "value"}
Example INCORRECT: Here is the result: \`\`\`json\n{"key": "value"}\n\`\`\`
`;

/**
 * Prompt templates for different ticket operations
 */
export const PROMPT_TEMPLATES = {
  analyzeTicket: (ticket: Task) => `
  You are an expert IT support analyst. Analyze the following ticket and provide structured information.
  
  Ticket Information:
  Title: ${ticket.title}
  Description: ${ticket.description || "No description provided"}
  Current Status: ${ticket.status}
  Priority: ${ticket.priority}
  Category: ${ticket.category}
  
  Please analyze this ticket and provide:
  1. Key issues identified (list main problems)
  2. Suggested category (bug, feature, support, enhancement, incident, or request)
  3. Recommended priority (low, medium, high, or urgent)
  4. Complexity assessment (1-100 scale where 100 is most complex)
  5. Required expertise areas (list technical skills needed)
  6. Estimated resolution time (in hours)
  
  REQUIRED RESPONSE FORMAT:
  Your response must be valid JSON starting with {. Do NOT include any explanatory text, markdown code blocks, or text after the JSON.
  
  JSON structure with exact keys:
  {
    "keyIssues": ["issue1", "issue2"],
    "suggestedCategory": "category",
    "recommendedPriority": "priority",
    "complexityScore": 50,
    "requiredExpertise": ["skill1", "skill2"],
    "estimatedHours": 4
  }
  ${JSON_FORMAT_REQUIREMENT}
  `,

  generateResponse: (ticket: Task, knowledgeBase: string) => `
You are a helpful IT support assistant. Generate a response for the following ticket based on available knowledge.

Ticket Information:
Title: ${ticket.title}
Description: ${ticket.description || "No description provided"}
Category: ${ticket.category}

Relevant Knowledge Base Articles:
${knowledgeBase || "No relevant articles found"}

Please generate a helpful response that:
1. Acknowledges the user's issue
2. Provides clear, actionable steps if possible
3. References relevant knowledge base articles if available
4. Maintains a professional and friendly tone
5. Suggests next steps or escalation if needed

REQUIRED: Respond with ONLY a JSON object. Start with {. No explanatory text, no markdown.

JSON structure:
{
  "response": "Your professional support response (keep it concise but thorough, do not exceed 500 words)",
  "confidence": confidence_score_0_to_100,
  "knowledgeBaseArticles": ["article_ids_referenced"],
  "escalationNeeded": boolean
}

Keep the tone professional yet friendly. Be specific and actionable.${JSON_FORMAT_REQUIREMENT}
  `,

  extractKnowledge: (ticket: Task, resolution: string) => `
  You are a knowledge management expert. Extract reusable knowledge from this resolved ticket.
  
  Ticket Information:
  Title: ${ticket.title}
  Description: ${ticket.description || "No description provided"}
  Category: ${ticket.category}
  
  Resolution:
  ${resolution}
  
  Please extract knowledge that can help resolve similar issues in the future:
  1. Problem summary (one sentence)
  2. Root cause (if identifiable)
  3. Solution steps (numbered list)
  4. Prevention tips (if applicable)
  5. Related keywords for search
  
  REQUIRED: Return ONLY valid JSON. Start with {. No markdown, no explanatory text.
  
  JSON structure:
  {
    "title": "Brief descriptive title",
    "summary": "One sentence problem summary",
    "content": "Detailed solution with numbered steps",
    "category": "${ticket.category}",
    "tags": ["keyword1", "keyword2"],
    "rootCause": "Root cause if known",
    "preventionTips": ["tip1", "tip2"]
  }
  ${JSON_FORMAT_REQUIREMENT}
  `,
  aiChat:
    "You are a helpful assistant for TicketFlow, a ticketing system. Answer questions based on the provided context when available. Be concise and helpful.",
};

// For AI ticket analysis (aiTicketAnalysis.ts)
export function buildTicketAnalysisPrompt(ticket: {
  title: string;
  description: string;
  category?: string;
  priority?: string;
}) {
  return `
You are an expert helpdesk AI analyst. Analyze this support ticket and provide structured insights.

Ticket Details:
Title: ${ticket.title}
Description: ${ticket.description}
Current Category: ${ticket.category || "Not specified"}
Current Priority: ${ticket.priority || "Not specified"}

CRITICAL: Respond with ONLY a JSON object. No explanatory text, no markdown, no code blocks.

Required JSON structure:
{
  "complexity": "low|medium|high|critical",
  "category": "bug|feature|support|enhancement|incident|request",
  "priority": "low|medium|high|urgent",
  "estimatedResolutionTime": number_of_hours,
  "tags": ["tag1", "tag2", "tag3"],
  "confidence": confidence_score_0_to_100,
  "reasoning": "Brief explanation of your analysis"
}

Consider these factors:
- Technical complexity indicators
- User impact level
- Urgency keywords
- Similar historical patterns
- Required expertise level

Your response must start with { and end with }. Nothing else.${JSON_FORMAT_REQUIREMENT}`;
}

// For AI auto-response generation (aiTicketAnalysis.ts)
export function buildAutoResponsePrompt(params: {
  title: string;
  description: string;
  category: string;
  priority: string;
  analysis: { complexity: string; estimatedResolutionTime: number };
  knowledgeContext?: string;
}) {
  const { title, description, category, priority, analysis, knowledgeContext } =
    params;
  const kb =
    knowledgeContext && knowledgeContext.length > 0
      ? `\n\nRelevant Knowledge Base Articles:\n${knowledgeContext}`
      : "";

  return `
You are a professional helpdesk support agent. Generate a helpful, empathetic response to this support ticket.

Ticket Information:
Title: ${title}
Description: ${description}
Category: ${category}
Priority: ${priority}
AI Analysis: Complexity ${analysis.complexity}, Est. resolution ${analysis.estimatedResolutionTime}h
${kb}

Generate a response that:
1. Acknowledges the issue empathetically
2. Provides immediate helpful information or next steps
3. Sets appropriate expectations for resolution time
4. Includes relevant troubleshooting steps if applicable
5. Mentions when they can expect follow-up

REQUIRED: Respond with ONLY a JSON object. Start with {. No explanatory text, no markdown.

JSON structure:
{
  "response": "Your professional support response",
  "confidence": confidence_score_0_to_100,
  "knowledgeBaseArticles": ["article_ids_referenced"],
  "followUpActions": ["action1", "action2"],
  "escalationNeeded": boolean
}

Keep the tone professional yet friendly. Be specific and actionable.${JSON_FORMAT_REQUIREMENT}`;
}

// For batch resolved ticket pattern analysis
export function buildResolvedTicketsPatternPrompt(ticketSummaries: string) {
  return `
You are an expert knowledge management AI. Analyze these resolved support tickets to identify common patterns and create actionable knowledge.

Resolved Tickets:
${ticketSummaries}

REQUIRED: Respond with ONLY a JSON array. Start with [. No explanatory text, no markdown.

JSON array structure:
[
  {
    "problemType": "Clear description of the problem type",
    "commonSolutions": ["solution1", "solution2", "solution3"],
    "preventiveMeasures": ["prevention1", "prevention2"],
    "frequency": estimated_frequency_score_1_to_10,
    "averageResolutionTime": average_hours,
    "successRate": success_rate_0_to_100
  }
]

Focus on:
1. Recurring problem types
2. Effective solution patterns
3. Preventive measures
4. Time-saving approaches
5. Common user mistakes

Limit to the top 5 most significant patterns.${JSON_FORMAT_REQUIREMENT}`;
}

// For generating a knowledge article from a pattern
export function buildKnowledgeArticlePrompt(pattern: {
  problemType: string;
  commonSolutions: string[];
  preventiveMeasures: string[];
  averageResolutionTime: number;
  successRate: number;
}) {
  return `
You are a technical writer creating a knowledge base article. Based on this resolution pattern, create a comprehensive, user-friendly article.

Resolution Pattern:
Problem Type: ${pattern.problemType}
Common Solutions: ${pattern.commonSolutions.join(", ")}
Preventive Measures: ${pattern.preventiveMeasures.join(", ")}
Average Resolution Time: ${pattern.averageResolutionTime} hours
Success Rate: ${pattern.successRate}%

REQUIRED: Return ONLY valid JSON. Start with {. No markdown code blocks, no explanatory text.

JSON structure:
{
  "title": "Clear, descriptive title",
  "content": "Comprehensive article content in markdown format",
  "category": "support|technical|howto|troubleshooting|faq",
  "tags": ["tag1", "tag2", "tag3"],
  "difficulty": "beginner|intermediate|advanced",
  "estimatedReadTime": estimated_minutes_to_read,
  "confidence": confidence_score_0_to_100
}

Article content should include:
1. Problem description
2. Step-by-step solutions
3. Prevention tips
4. Common pitfalls to avoid
5. Related information

Write for non-technical users. Use clear, actionable language. Include specific steps and examples.${JSON_FORMAT_REQUIREMENT}`;
}

// For intelligent knowledge search ranking
export function buildKnowledgeSearchRankingPrompt(
  query: string,
  articleSummaries: string,
  maxResults: number
) {
  return `
You are a search relevance AI. Rank these knowledge base articles by relevance to the user query.

User Query: "${query}"

Available Articles:
${articleSummaries}

REQUIRED: Respond with ONLY a JSON array. Start with [. No explanatory text, no markdown.

JSON array structure:
[
  {
    "articleIndex": 0,
    "relevanceScore": 95,
    "matchedContent": "Brief excerpt explaining why this is relevant"
  }
]

Only include articles with relevance score >= 30. Limit to top ${maxResults} results.${JSON_FORMAT_REQUIREMENT}`;
}

// For improving an existing article
export function buildImproveKnowledgeArticlePrompt(
  article: {
    title: string;
    content: string;
  },
  resolutionData: {
    resolution: string;
    resolutionTime: number;
    success: boolean;
  }
) {
  return `
You are improving a knowledge base article based on new resolution data. 

Current Article:
Title: ${article.title}
Content: ${article.content}

New Resolution Data:
Resolution: ${resolutionData.resolution}
Time taken: ${resolutionData.resolutionTime} hours
Success: ${resolutionData.success}

REQUIRED: Respond with ONLY valid JSON. Start with {. No markdown, no explanatory text.

JSON structure:
{
  "shouldUpdate": true/false,
  "improvedContent": "Updated article content if improvements needed",
  "improvementReason": "Brief explanation of what was improved",
  "confidence": confidence_score_0_to_100
}

Only suggest updates if the new data provides valuable insights not already covered.${JSON_FORMAT_REQUIREMENT}`;
}

export function buildCreateKnowledgeArticlePrompt(resolution: {
  problem: string;
  solution: string;
  steps: string[];
}) {
  return `Create a knowledge base article from this resolved ticket:

  Problem: ${resolution.problem}
  
  Solution: ${resolution.solution}
  
  Resolution Steps: ${resolution.steps.join("\n")}
  
  Generate a well-structured knowledge article with:
  1. A clear, searchable title
  2. A brief summary (2-3 sentences)
  3. Detailed content with step-by-step instructions
  4. Prerequisites or requirements
  5. Common variations of this issue
  
  REQUIRED: Return ONLY valid JSON. Start with {. No markdown code blocks, no explanatory text.
  
  JSON structure:
  {
    "title": "Clear title for the knowledge article",
    "summary": "Brief summary of the issue and solution",
    "content": "Detailed article content with markdown formatting",
    "prerequisites": ["list", "of", "prerequisites"],
    "variations": ["common", "variations", "of", "this", "issue"]
  }${JSON_FORMAT_REQUIREMENT}`;
}
