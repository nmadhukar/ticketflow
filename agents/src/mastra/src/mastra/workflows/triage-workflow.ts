import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { triageAgent } from '../agents/triage/agent.js';

const triage = createStep({
  id: 'triage',
  inputSchema: z.object({ subject: z.string(), body: z.string() }),
  outputSchema: z.object({ answer: z.string() }),
  execute: async ({ inputData }) => {
    const res = await triageAgent.generate(`Subject: ${inputData.subject}\n\n${inputData.body}`);
    return { answer: res.text };
  },
});

export const triageWorkflow = createWorkflow({
  id: 'triage-workflow',
  inputSchema: z.object({ subject: z.string(), body: z.string() }),
  outputSchema: z.object({ answer: z.string() }),
})
  .then(triage)
  .commit();
