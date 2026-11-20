import { checkUserMessage } from '../../../../server/assistant/contentGuard.ts';

/**
 * The content guard, as a Mastra input processor for the Studio agents.
 *
 * It applies the SAME rules the app applies at its HTTP boundary (server/copilot/guard.ts uses the
 * same server/assistant/contentGuard.ts), so a message typed into Studio's agent chat is refused for
 * exactly what the copilot chat refuses: abuse, a threat, or a pasted password / API key / card
 * number. Before this, Studio had only a TokenLimiter and answered those messages.
 *
 * The rules are imported, not copied: two lists would drift, and a message refused in one place but
 * answered in the other is worse than no guard. `mastra build` bundles this file, so the import must
 * resolve at build time; agents/tests/content-guard.test.mjs imports it the same way to prove it.
 *
 * An object is used rather than a Processor subclass so this package needs no extra dependency for a
 * type: the only shape Mastra reads is { id, processInput }.
 */
export const CONTENT_GUARD_PROCESSOR_ID = 'ticketflow-content-guard';

// The file lives outside this package's tsconfig paths (the sidecar is its own build context); the
// import resolves at runtime and at bundle time, and agents/tests/content-guard.test.mjs proves it.
// @ts-expect-error TS2307: see the note above.
export const assistantContentFilter = () => ({
  id: CONTENT_GUARD_PROCESSOR_ID,
  async processInput({ messages, abort }: { messages: unknown[]; abort: (reason?: string) => never }) {
    const verdict = checkUserMessage(lastMessageText(messages));
    if (!verdict.ok) {
      // A category only in the reason ("contains a password"); the text may be the credential.
      abort(
        'This message was blocked by the content guard. Ask the customer to rephrase politely and to share no passwords, keys or card numbers.',
      );
    }
    return messages as never;
  },
});

/** The text of the newest message, whatever shape Mastra's MessageList gives it. */
export function lastMessageText(messages: unknown[]): string {
  const latest = messages[messages.length - 1] as { content?: unknown } | undefined;
  let content = latest && typeof latest === 'object' ? latest.content : undefined;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    content = (content as { content?: unknown }).content;
  }
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => !!part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string')
    .map((part) => (part as { text: string }).text)
    .join('\n');
}
