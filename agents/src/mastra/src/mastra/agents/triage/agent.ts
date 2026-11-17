import { Agent } from '@mastra/core/agent';
import { lookupOwner } from './tools.js';

export const triageAgent = new Agent({
  id: 'triage-agent',
  name: 'Triage Agent',
  description: 'Classifies an incoming ticket and names the owning team.',
  model: 'openrouter/openai/gpt-4o-mini',
  tools: { lookupOwner },
  instructions: `You classify support tickets.
Return: category (billing|bug|access|hardware), a one-line reason, and the owning team from lookup-owner.
Never invent a team name. If unsure between two categories, pick the one that blocks the user.`,
});
