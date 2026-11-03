import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssistantErrorView } from "./assistantErrors";

/** The assistant's last problem, in words (assistantErrors.ts), above the conversation. */
export function AssistantErrorBanner({ problem, onDismiss }: { problem: AssistantErrorView; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1">{problem.message}</p>
      {problem.action === "sign_in" && (
        // A full page load: the sign-in page starts a fresh session, and the assistant with it.
        <Button size="sm" variant="outline" className="h-7" onClick={() => window.location.assign("/login")}>
          Sign in
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Dismiss" onClick={onDismiss}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
