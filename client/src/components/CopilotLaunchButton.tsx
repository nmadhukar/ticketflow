/**
 * The "Ask AI" launcher: the blue pill (Bot icon + the words) that opens the copilot chat.
 *
 * It is a plain button owned by CopilotPopupLazy, which keeps the open state. CopilotKit's own
 * launcher only draws an icon, and its Popup is gated by a cloud license in this version, so the
 * product's button opens a real chat panel instead (see CopilotPopupLazy.tsx).
 *
 * The pill's look is inline on purpose: CopilotKit's shipped stylesheet is unlayered and beat a
 * class rule, collapsing the button to an icon-sized sliver with the label hidden.
 */
import type { ComponentProps } from "react";
import { Bot } from "lucide-react";

export function CopilotLaunchButton({ className, ...rest }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      // A word, not an icon: the name of what the click does.
      aria-label={(rest["aria-label"] as string | undefined) ?? "Open Ask AI"}
      className={`${className ?? ""} tf-ask-ai-launcher`}
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        width: "auto",
        minWidth: 0,
        height: "3rem",
        padding: "0 1.1rem",
        borderRadius: "1.5rem",
        border: "none",
        background: "rgb(37 99 235)",
        color: "#fff",
        fontSize: "0.875rem",
        fontWeight: 500,
        boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
        cursor: "pointer",
        zIndex: 50,
      }}
    >
      <Bot aria-hidden="true" style={{ width: "1.25rem", height: "1.25rem", flexShrink: 0 }} />
      <span style={{ whiteSpace: "nowrap" }}>Ask AI</span>
    </button>
  );
}
