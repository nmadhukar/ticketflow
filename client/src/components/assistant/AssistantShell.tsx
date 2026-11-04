import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, History, MessageSquare, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HistoryPanel } from "./HistoryPanel";

/**
 * The in-app assistant's launcher. It asks the server whether this user has an assistant (and
 * which one) and loads the CopilotKit bundle only then, so users without one never download it.
 * Sits bottom-right, in the old help chatbot's (AiChatBot) place: a user with this assistant does
 * not get that one (AppAssistant.tsx). Staff may also see their saved conversations, when those
 * are switched on.
 */
export type AssistantAgentId = "support-assistant" | "ticket-assistant";

export interface Availability {
  enabled: boolean;
  agentId: AssistantAgentId | null;
  history?: boolean;
  historyRetentionDays?: number | null;
}

const AssistantPanel = lazy(() => import("./AssistantPanel"));

/** Whether this user has the assistant, and which; one cached answer for every caller. */
export function useAssistantAvailability() {
  return useQuery<Availability>({ queryKey: ["/api/assistant/availability"], refetchOnWindowFocus: true, staleTime: 60_000 });
}

export function AssistantShell() {
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted and is only hidden when closed: closing must not lose the
  // conversation or an unconfirmed card, nor cut off an answer still being written.
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  // New chat: a new key mounts a fresh panel, so a new conversation (staff's earlier ones stay
  // under Saved conversations).
  const [chatKey, setChatKey] = useState(0);
  const { data } = useAssistantAvailability();
  // Closing hands focus back to the launcher, so it is not left inside the hidden panel.
  const launcher = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) launcher.current?.focus();
  }, [open]);
  // Escape closes the panel (it covers the whole screen on a phone), but only an Escape pressed in
  // it and not already used: by an input method finishing a word, or a menu closing itself.
  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) setOpen(false);
  };
  if (!data?.enabled || !data.agentId) return null;
  const title = data.agentId === "support-assistant" ? "Support assistant" : "Ticket assistant";
  const showHistory = data.history === true && view === "history";

  return (
    <>
      {loaded && (
        <div
          role="dialog"
          aria-label={title}
          aria-hidden={!open}
          onKeyDown={onPanelKeyDown}
          // A class, not the `hidden` attribute: Tailwind's `flex` would override the attribute.
          className={`${open ? "flex" : "hidden"} fixed inset-0 z-50 flex-col bg-background sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[600px] sm:max-h-[calc(100vh-3rem)] sm:w-[400px] sm:rounded-xl sm:border sm:shadow-xl`}
        >
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-medium">{showHistory ? "Saved conversations" : title}</span>
            <div className="flex items-center gap-1">
              {!showHistory && (
                <Button variant="ghost" size="icon" aria-label="New chat" title="New chat" onClick={() => setChatKey((k) => k + 1)}>
                  <SquarePen className="h-4 w-4" />
                </Button>
              )}
              {data.history && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={showHistory ? "Back to the chat" : "Saved conversations"}
                  onClick={() => setView(showHistory ? "chat" : "history")}
                >
                  {showHistory ? <MessageSquare className="h-4 w-4" /> : <History className="h-4 w-4" />}
                </Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Close assistant" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {/* The chat stays mounted under the history view, so switching back loses nothing. */}
          <div className={`${showHistory ? "hidden" : "block"} min-h-0 flex-1`}>
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading the assistant…</p>}>
              <AssistantPanel key={chatKey} agentId={data.agentId} />
            </Suspense>
          </div>
          {showHistory && (
            <div className="min-h-0 flex-1">
              <HistoryPanel retentionDays={data.historyRetentionDays} />
            </div>
          )}
        </div>
      )}
      {!open && (
        <Button
          // Icon only on a phone, so it covers as little of the page as possible.
          ref={launcher}
          aria-label={title}
          className="fixed bottom-4 right-4 z-40 h-12 w-12 gap-2 rounded-full p-0 shadow-lg sm:bottom-6 sm:right-6 sm:w-auto sm:px-4"
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
        >
          <Bot className="h-5 w-5" />
          <span className="hidden sm:inline">{title}</span>
        </Button>
      )}
    </>
  );
}
