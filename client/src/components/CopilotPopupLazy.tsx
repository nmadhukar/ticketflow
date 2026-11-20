/**
 * The CopilotKit popup, isolated so the large CopilotKit packages land in their own
 * lazily-loaded chunk (see CopilotAssistant.tsx). This module is imported only when
 * the runtime is enabled and the user is signed in.
 */
import { useState } from "react";
import { Bot, X } from "lucide-react";
import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
// CopilotKit ships its UI as already-compiled Tailwind v4 output (@layer base with no
// @tailwind directive). This project runs Tailwind v3, whose PostCSS plugin rejects that
// shape, so the stylesheet is imported raw and injected as a <style> tag - the one path
// that skips PostCSS. See the note in vite.config.ts.
import copilotStyles from "@copilotkit/react-core/v2/styles.css?raw";
import { CopilotLaunchButton } from "./CopilotLaunchButton";
import { copilotToolRenderers } from "./CopilotProposalCards";

const STYLE_ELEMENT_ID = "copilotkit-styles";

/** Adds CopilotKit's stylesheet once, plus the launcher rules this app always had. */
function ensureCopilotStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  // CopilotKit's own launcher is a dark circle. The product's button has always been the blue
  // "Ask AI" pill, so it is restyled here rather than left as a second, unfamiliar icon, and the
  // word "Ask AI" is added beside the icon (CopilotLaunchButton.tsx) so the button says what it is.
  style.textContent = `${copilotStyles}
[data-copilotkit] button.copilotKitButton,
.copilotKitButton {
  background-color: rgb(37 99 235) !important;
  color: #fff !important;
  border-radius: 1.5rem !important;
  width: auto !important;
  min-width: 0 !important;
  padding: 0 1rem !important;
  height: 3rem !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 0.5rem !important;
  font-size: 0.875rem !important;
  font-weight: 500 !important;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1) !important;
}
[data-copilotkit] button.copilotKitButton:hover,
.copilotKitButton:hover {
  background-color: rgb(29 78 216) !important;
}
/* The toggle button is the Ask AI pill (styled inline by CopilotLaunchButton.tsx); the rules below
   keep its colour on hover, which CopilotKit's own stylesheet would otherwise reset. */
`;
  document.head.appendChild(style);
}

ensureCopilotStyles();

/** Marks that this page load already cleared the stored thread id. */
let threadResetDone = false;

/**
 * Drops CopilotKit's remembered thread id for THIS page load, so a refresh starts a new chat.
 *
 * CopilotKit persists its thread (`copilotkit-thread-id` and per-agent keys). Leaving it means the
 * next load reattaches to the old conversation, which is wrong for a support popup: a refresh is a
 * new session, and a new customer at the same browser must never see the previous person's chat.
 * Only keys that name a thread are touched; nothing else is removed.
 */
function resetCopilotThreadOnce(): void {
  if (threadResetDone || typeof window === "undefined") return;
  threadResetDone = true;
  try {
    for (const store of [window.sessionStorage, window.localStorage]) {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && /copilotkit.*thread|thread.*copilotkit/i.test(key)) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
    }
  } catch {
    // A blocked storage (private mode, quota) simply means there is nothing to clear.
  }
}

export function CopilotPopupLazy({ runtimeUrl, role }: { runtimeUrl: string; role?: string }) {
  // A fresh conversation for every page load (see resetCopilotThreadOnce).
  resetCopilotThreadOnce();
  const [open, setOpen] = useState(false);

  // A customer is greeted about their own problem and the ticket it will raise; staff are
  // greeted about working the queue. The server tells us which (GET .../config).
  // Keep both to two short lines: the welcome is the first thing anyone reads in the popup.
  const welcomeMessageText =
    role === "customer"
      ? "Need help? Describe your issue and I'll find a known fix - or prepare a ticket for you to confirm. When it's sorted, I'll offer to close it."
      : "Need help? Ask me about any ticket to find solutions or reach the right team.";

  return (
    // enableInspector={false} suppresses CopilotKit's development-only Inspector,
    // which otherwise auto-mounts a second floating launcher of its own on
    // localhost. The app should show exactly one assistant button.
    <CopilotKit
      runtimeUrl={runtimeUrl}
      agent="default"
      enableInspector={false}
      // Propose cards: "raise this ticket?" / "is it sorted - close it?" arrive as a one-click card,
      // not just as text (see CopilotProposalCards.tsx).
      renderToolCalls={copilotToolRenderers}
    >
      {!open && <CopilotLaunchButton onClick={() => setOpen(true)} />}
      {/*
        Why a plain panel and not CopilotPopup: CopilotKit v1.80 renders its Popup through a
        license check (isPopupLicensed). Without a CopilotKit Cloud subscription that check fails and
        the popup mounts as an empty box - the Ask AI button opened, nothing appeared, so the chat
        could not be used. CopilotChat is always available; it is what this app's own assistant
        panel already uses. So the button opens OUR panel, and the same CopilotChat renders inside it.
      */}
      {open && (
        <div
          role="dialog"
          aria-label="Ask AI"
          className="fixed inset-0 z-50 flex flex-col bg-background sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[620px] sm:max-h-[calc(100vh-3rem)] sm:w-[400px] sm:overflow-hidden sm:rounded-xl sm:border sm:shadow-xl"
          data-tf-ask-ai-panel=""
        >
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="flex items-center gap-2 font-medium">
              <Bot aria-hidden="true" className="h-4 w-4 text-blue-600" />
              Ask AI
            </span>
            <button
              type="button"
              aria-label="Close Ask AI"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <CopilotChat agentId="default" labels={{ welcomeMessageText }} />
          </div>
        </div>
      )}
    </CopilotKit>
  );
}
