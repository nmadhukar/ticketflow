/**
 * TicketFlow Application Root Component
 *
 * This is the main application component that orchestrates the entire TicketFlow system.
 *
 * Architecture Features:
 * - Client-side routing using Wouter for SPA navigation
 * - Authentication-based route protection and redirection
 * - Role-based access control for different user types
 * - Global state management with TanStack Query
 * - Real-time WebSocket integration for live updates
 * - Floating AI chatbot accessible from all pages
 *
 * Authentication Flow:
 * - Unauthenticated users see landing page and auth forms
 * - Authenticated users access full application with role-based restrictions
 * - Automatic redirection based on authentication state
 * - Session persistence and automatic logout handling
 *
 * Route Organization:
 * - Public routes: landing, auth, API documentation
 * - Protected routes: dashboard, tickets, teams, admin
 * - Role-specific routes: admin panel (admin only), team management
 * - Dynamic routes: ticket details, team details with parameters
 *
 * Global Providers:
 * - QueryClient for server state management and caching
 * - WebSocket provider for real-time updates
 * - Toast notifications for user feedback
 * - Tooltip provider for enhanced UX
 *
 * The app automatically handles:
 * - Loading states during authentication
 * - Error boundaries and fallback handling
 * - Responsive design for all device types
 * - Accessibility compliance and keyboard navigation
 */

import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/layout";
import { AiChatBot } from "@/components/AiChatBot";
import { ProtectedRoute } from "@/components/protected-route";
import { ForcedPasswordChange } from "@/components/forced-password-change";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Tickets from "@/pages/tickets";
import Teams from "@/pages/teams";
import DepartmentDetail from "@/pages/department-detail";
import TeamDetail from "@/pages/team-detail";
import Settings from "@/pages/settings";
import Notifications from "@/pages/notifications";
import ApiDocs from "@/pages/api-docs";
import AuthPage from "@/pages/auth-page";
import UserGuides from "@/pages/user-guides";
import Departments from "@/pages/departments";
import KnowledgeBase from "@/pages/knowledge-base";
import { WebSocketProvider } from "@/hooks/useWebSocket";
import { PreferencesLoader } from "@/components/preferences-loader";
import AdminPanel from "./pages/admin";

function RedirectTickets({ ticketId }: { ticketId?: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const query = ticketId && /^\d+$/.test(ticketId) ? `?ticket=${ticketId}` : window.location.search;
    setLocation(`/tickets${query}`, { replace: true });
  }, [setLocation, ticketId]);
  return null;
}

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <div role="status" className="flex min-h-dvh items-center justify-center gap-3 text-sm text-muted-foreground"><span className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" />Loading your workspace…</div>;
  }

  // An admin reset the password: nothing else works until the user picks their own.
  if (isAuthenticated && (user as any)?.mustChangePassword) {
    return <ForcedPasswordChange />;
  }

  return (
    <>
      <Switch>
        <Route path="/login" component={AuthPage} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/404" component={NotFound} />

        {!isAuthenticated ? (
          <>
            <Route path="/" component={Landing} />
            <Route component={NotFound} />
          </>
        ) : (
          <WebSocketProvider>
            <PreferencesLoader />
            <Layout>
              <Switch>
                <Route path="/">
                  <ProtectedRoute
                    allowedRoles={["admin", "manager", "agent", "customer"]}
                  >
                    {(user as any)?.role === "admin" ? (
                      <Dashboard />
                    ) : (
                      <Tickets />
                    )}
                  </ProtectedRoute>
                </Route>
                <Route path="/tickets">
                  <ProtectedRoute
                    allowedRoles={["admin", "manager", "agent", "customer"]}
                  >
                    <Tickets />
                  </ProtectedRoute>
                </Route>
                <Route path="/my-tasks"><RedirectTickets /></Route>
                <Route path="/tickets/:id">{(params) => <RedirectTickets ticketId={params.id} />}</Route>
                <Route path="/teams">
                  <ProtectedRoute allowedRoles={["manager", "agent"]}>
                    <Teams />
                  </ProtectedRoute>
                </Route>
                <Route
                  path="/teams/:id"
                  component={() => (
                    <ProtectedRoute
                      allowedRoles={["admin", "manager", "agent"]}
                    >
                      <TeamDetail />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/departments"
                  component={() => (
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <Departments />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/departments/:id"
                  component={() => (
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <DepartmentDetail />
                    </ProtectedRoute>
                  )}
                />
                <Route path="/knowledge-base">
                  <ProtectedRoute allowedRoles={["admin"]}>
                    <KnowledgeBase />
                  </ProtectedRoute>
                </Route>
                <Route path="/404" component={NotFound} />
                <Route path="/settings" component={Settings} />
                <Route path="/notifications" component={Notifications} />
                <Route path="/guides" component={UserGuides} />
                <Route path="/admin/:tab">
                  <ProtectedRoute allowedRoles={["admin"]}>
                    <AdminPanel />
                  </ProtectedRoute>
                </Route>

                <Route component={NotFound} />
              </Switch>
            </Layout>
          </WebSocketProvider>
        )}
      </Switch>
      {/* Show AI Chat Bot for authenticated users */}
      {!isLoading && isAuthenticated && <AiChatBot />}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        storageKey="theme"
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
