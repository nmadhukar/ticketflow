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

export function CopilotPopupLazy({ runtimeUrl }: { runtimeUrl: string }) {
  return (
    <CopilotKit runtimeUrl={runtimeUrl} agent="default">
      <CopilotPopup
        // Its launcher shares the corner with the help chatbot's; the app stylesheet
        // lifts it clear (see .copilotKitButton in index.css).
        defaultOpen={false}
        labels={{
          modalHeaderTitle: "TicketFlow Copilot",
          welcomeMessageText: "Ask me about a ticket, and I can look up its fix or name the team that owns it.",
        }}
      />
    </CopilotKit>
  );
}
