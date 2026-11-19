/**
 * The CopilotKit popup, isolated so the large CopilotKit packages land in their own
 * lazily-loaded chunk (see CopilotAssistant.tsx). This module is imported only when
 * the runtime is enabled and the user is signed in.
 */
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
// CopilotKit ships its UI as already-compiled Tailwind v4 output (@layer base with no
// @tailwind directive). This project runs Tailwind v3, whose PostCSS plugin rejects that
// shape, so the stylesheet is imported raw and injected as a <style> tag - the one path
// that skips PostCSS. See the note in vite.config.ts.
import copilotStyles from "@copilotkit/react-core/v2/styles.css?raw";

const STYLE_ELEMENT_ID = "copilotkit-styles";

/** Adds CopilotKit's stylesheet once, plus the launcher rules this app always had. */
function ensureCopilotStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  // CopilotKit's own launcher is a dark circle. The product's button has always been the blue
  // "Ask AI" pill, so it is restyled here rather than left as a second, unfamiliar icon.
  style.textContent = `${copilotStyles}
[data-copilotkit] button.copilotKitButton,
.copilotKitButton {
  background-color: rgb(37 99 235) !important;
  color: #fff !important;
  border-radius: 1.5rem !important;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1) !important;
}
[data-copilotkit] button.copilotKitButton:hover,
.copilotKitButton:hover {
  background-color: rgb(29 78 216) !important;
}
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

  // A customer is greeted about their own problem and the ticket it will raise; staff are
  // greeted about working the queue. The server tells us which (GET .../config).
  // Keep both to two short lines: the welcome is the first thing anyone reads in the popup.
  const welcomeMessageText =
    role === "customer"
      ? "Need help? Describe your issue and I'll find a known fix - or raise a ticket and route it to the right team."
      : "Need help? Ask me about any ticket to find solutions or reach the right team.";

  return (
    // enableInspector={false} suppresses CopilotKit's development-only Inspector,
    // which otherwise auto-mounts a second floating launcher of its own on
    // localhost. The app should show exactly one assistant button.
    <CopilotKit runtimeUrl={runtimeUrl} agent="default" enableInspector={false}>
      <CopilotPopup
        // Its launcher shares the corner with the help chatbot's; the app stylesheet
        // lifts it clear (see .copilotKitButton in index.css).
        defaultOpen={false}
        // File attachments are off unless a config is passed (useAttachments defaults
        // `enabled` to false and then renders the Add button disabled). No `onUpload`
        // means CopilotKit reads the file as base64 into the message itself, so the
        // picker works with no upload endpoint behind it.
        attachments={{ enabled: true }}
        labels={{
          // One assistant, one name. The customer and staff both open "Ask AI"; the person inside is
          // the TicketFlow assistant, never a second product with its own title.
          modalHeaderTitle: "Ask AI",
          welcomeMessageText,
        }}
      />
    </CopilotKit>
  );
}
