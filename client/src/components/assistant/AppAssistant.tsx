import { AiChatBot } from "@/components/AiChatBot";
import { AssistantShell, useAssistantAvailability } from "./AssistantShell";

/**
 * One assistant per user, bottom-right. A user the server gives the in-app assistant gets it, and
 * the old help chatbot (AiChatBot, "Ask AI") is retired for them. Everyone else keeps Ask AI:
 * while the assistant is switched off, for customers while ASSISTANT_AUDIENCE=staff, and when the
 * availability check fails. Switching the assistant off brings Ask AI back for everyone.
 *
 * Nothing shows until the server has answered, so Ask AI never flashes up and away.
 */
export function AppAssistant() {
  const { data, isPending, isError } = useAssistantAvailability();
  if (isPending) return null;
  if (!isError && data?.enabled && data.agentId) return <AssistantShell />;
  return <AiChatBot />;
}
