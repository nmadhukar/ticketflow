/**
 * The in-app copilot (CopilotKit).
 *
 * A floating assistant beside the help chatbot. It is backed by the TicketFlow
 * triage agent over the AG-UI protocol, so it can read a ticket, search the
 * knowledge base and name the owning team - the same work the Mastra service does,
 * reached from the browser instead of the command line.
 *
 * The component renders nothing until the server says the copilot is on (GET
 * /api/copilotkit/config), and CopilotKit itself is split into its own chunk and
 * loaded only then. A deployment with the copilot disabled, or a signed-out
 * visitor, downloads none of it.
 */
import { Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

const RUNTIME_URL = "/api/copilotkit";

const CopilotPopupLazy = lazy(() =>
  import("./CopilotPopupLazy").then((m) => ({ default: m.CopilotPopupLazy })),
);

interface CopilotConfig {
  enabled: boolean;
  /** The signed-in person's role, so the popup can greet a customer differently from staff. */
  role?: string;
}

export function CopilotAssistant() {
  const { isAuthenticated } = useAuth();

  const { data } = useQuery<CopilotConfig>({
    queryKey: [RUNTIME_URL, "config"],
    enabled: isAuthenticated,
  });

  if (!isAuthenticated || !data?.enabled) return null;

  return (
    <Suspense fallback={null}>
      <CopilotPopupLazy runtimeUrl={RUNTIME_URL} role={data.role} />
    </Suspense>
  );
}
