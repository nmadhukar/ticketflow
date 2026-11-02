import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The in-app assistant's launcher. It asks the server whether this user has an assistant (and
 * which one) and loads the CopilotKit bundle only then, so users without one never download it.
 * Sits bottom-left: the help chatbot (AiChatBot) owns bottom-right.
 */
export type AssistantAgentId = "support-assistant" | "ticket-assistant";

interface Availability {
  enabled: boolean;
  agentId: AssistantAgentId | null;
}

const AssistantPanel = lazy(() => import("./AssistantPanel"));

export function AssistantShell() {
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted and is only hidden when closed: closing must not lose the
  // conversation or an unconfirmed card, nor cut off an answer still being written.
  const [loaded, setLoaded] = useState(false);
  const { data } = useQuery<Availability>({ queryKey: ["/api/assistant/availability"], refetchOnWindowFocus: true, staleTime: 60_000 });
  if (!data?.enabled || !data.agentId) return null;
  const title = data.agentId === "support-assistant" ? "Support assistant" : "Ticket assistant";

  return (
    <>
      {loaded && (
        <div
          role="dialog"
          aria-label={title}
          aria-hidden={!open}
          // A class, not the `hidden` attribute: Tailwind's `flex` would override the attribute.
          className={`${open ? "flex" : "hidden"} fixed inset-0 z-50 flex-col bg-background sm:inset-auto sm:bottom-6 sm:left-6 sm:h-[600px] sm:max-h-[calc(100vh-3rem)] sm:w-[400px] sm:rounded-xl sm:border sm:shadow-xl`}
        >
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-medium">{title}</span>
            <Button variant="ghost" size="icon" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading the assistant…</p>}>
              <AssistantPanel agentId={data.agentId} />
            </Suspense>
          </div>
        </div>
      )}
      {!open && (
        <Button
          className="fixed bottom-4 left-4 z-40 h-12 gap-2 rounded-full px-4 shadow-lg sm:bottom-6 sm:left-6"
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
        >
          <Bot className="h-5 w-5" />
          {title}
        </Button>
      )}
    </>
  );
}
