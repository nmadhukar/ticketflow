import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const lookupOwner = createTool({
  id: 'lookup-owner',
  description: 'Maps a category (billing, bug, access, hardware) to the owning team name.',
  inputSchema: z.object({ category: z.enum(['billing', 'bug', 'access', 'hardware']) }),
  outputSchema: z.object({ team: z.string() }),
  execute: async ({ category }) => ({
    team: {
      billing: 'Finance Ops',
      bug: 'Core Platform',
      access: 'IT Support',
      hardware: 'IT Support',
    }[category],
  }),
});
