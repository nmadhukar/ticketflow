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

/** Adds CopilotKit's stylesheet once. */
function ensureCopilotStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = copilotStyles;
  document.head.appendChild(style);
}

ensureCopilotStyles();

export function CopilotPopupLazy({ runtimeUrl, role }: { runtimeUrl: string; role?: string }) {
  // A customer is greeted about their own problem and the ticket it will raise; staff are
  // greeted about working the queue. The server tells us which (GET .../config).
  const welcomeMessageText =
    role === "customer"
      ? "Hi! Tell me what is going wrong. I will ask a couple of questions, raise a ticket for you, and you can check its progress here any time."
      : "Ask me about a ticket, and I can look up its fix or name the team that owns it.";

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
          modalHeaderTitle: role === "customer" ? "TicketFlow Support" : "TicketFlow Copilot",
          welcomeMessageText,
        }}
      />
    </CopilotKit>
  );
}
