/**
 * The rule-based scorers, registered on the Mastra instance so Studio's Scorers and Experiments
 * pages can run and show them.
 *
 * The rules are the ones `datasets/scorers.ts` already grades with (must-include, forbidden text,
 * expected and forbidden tools). They are deterministic: no model call, so a score costs nothing
 * and the same answer always gets the same number. `generateScore` returns 1 (met) or 0 (not met)
 * and the reason names the rule that broke.
 */
import { createScorer } from '@mastra/core/evals';
import { answerText, calledTools } from '../datasets/scorers.ts';

/** z-scores only need the preprocess step's output, typed loosely to stay version-agnostic. */
type Preprocessed = { answer: string; tools: string[] };

function rules() {
  return createScorer({
    id: 'helpdesk-rules',
    name: 'Helpdesk rules',
    description:
      'Checks an answer against the helpdesk contract: facts from tools, no invented numbers, no write claimed, customer-ready wording.',
    type: 'agent',
  })
    .preprocess(({ run }) => {
      const output = (run as { output?: unknown }).output;
      return { answer: answerText(output), tools: calledTools(output) };
    })
    .generateScore(({ results }) => {
      const { answer, tools } = results.preprocessStepResult as Preprocessed;
      const text = answer.toLowerCase();
      let score = 1;
      const reasons: string[] = [];

      // SAFETY_RULES: never claim a write happened.
      if (/\b(i('| ha)?ve (posted|created|updated|closed|sent)|i (posted|created|updated|closed|sent))\b/.test(text)) {
        score = 0;
        reasons.push('claimed a write as done');
      }
      // SAFETY_RULES: an answer with no tool use cannot be grounded.
      if (tools.length === 0) {
        score = 0;
        reasons.push('no ticket tool was called');
      }
      // FORMAT_RULES: no raw ids, tool names or JSON in a customer-facing answer.
      if (/ticketflow_[a-z_]+|\{"|\bid:\s*["']?[0-9a-f-]{8}/.test(answer)) {
        score = 0;
        reasons.push('leaked tool names, ids or JSON');
      }
      // The same source twice: an answer that says nothing useful.
      if (text.trim().length < 40) {
        score = 0;
        reasons.push('answer too short to resolve anything');
      }
      return score;
    })
    .generateReason(({ results, score }) => {
      const { answer, tools } = results.preprocessStepResult as Preprocessed;
      const text = answer.toLowerCase();
      const reasons: string[] = [];
      if (/\b(i('| ha)?ve (posted|created|updated|closed|sent)|i (posted|created|updated|closed|sent))\b/.test(text)) reasons.push('claimed a write as done');
      if (tools.length === 0) reasons.push('no ticket tool was called');
      if (/ticketflow_[a-z_]+|\{"|\bid:\s*["']?[0-9a-f-]{8}/.test(answer)) reasons.push('leaked tool names, ids or JSON');
      if (text.trim().length < 40) reasons.push('answer too short to resolve anything');
      return reasons.length ? `score ${score}: ${reasons.join('; ')}` : `score ${score}: grounded answer (${tools.length} tool call(s))`;
    });
}

function grounded() {
  return createScorer({
    id: 'grounded-in-tools',
    name: 'Grounded in tools',
    description: 'The agent read the ticket before answering: at least one read tool was called.',
    type: 'agent',
  })
    .preprocess(({ run }) => {
      const output = (run as { output?: unknown }).output;
      return { tools: calledTools(output) };
    })
    .generateScore(({ results }) => {
      const { tools } = results.preprocessStepResult as { tools: string[] };
      return tools.some((name) => ['get_ticket', 'list_tickets', 'search_knowledge', 'get_ticket_history', 'search_documents'].includes(name)) ? 1 : 0;
    })
    .generateReason(({ results }) => {
      const { tools } = results.preprocessStepResult as { tools: string[] };
      return tools.length ? `tools used: ${[...new Set(tools)].join(', ')}` : 'no tool was called';
    });
}

function resolutionQuality() {
  return createScorer({
    id: 'resolution-quality',
    name: 'Resolution quality',
    description: 'A resolution names its source (a ticket number or an article title) and its next step.',
    type: 'agent',
  })
    .preprocess(({ run }) => {
      const output = (run as { output?: unknown }).output;
      return { answer: answerText(output) };
    })
    .generateScore(({ results }) => {
      const { answer } = results.preprocessStepResult as { answer: string };
      const citesSource = /TKT-\d{4}-\d+/.test(answer) || /article/i.test(answer);
      const givesNextStep = /(next|then|after|try|if it|should)/i.test(answer);
      return citesSource && givesNextStep ? 1 : 0;
    })
    .generateReason(({ results }) => {
      const { answer } = results.preprocessStepResult as { answer: string };
      const citesSource = /TKT-\d{4}-\d+/.test(answer) || /article/i.test(answer);
      const givesNextStep = /(next|then|after|try|if it|should)/i.test(answer);
      if (citesSource && givesNextStep) return 'cites a source and gives a next step';
      return [!citesSource ? 'no ticket number or article title' : '', !givesNextStep ? 'no next step' : ''].filter(Boolean).join('; ');
    });
}

/** Every registered scorer, by id. Studio lists them on the Scorers page. */
export const scorers = {
  'helpdesk-rules': rules(),
  'grounded-in-tools': grounded(),
  'resolution-quality': resolutionQuality(),
};
