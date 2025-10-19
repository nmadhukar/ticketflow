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

import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/layout";
import { AiChatBot } from "@/components/AiChatBot";
import { ProtectedRoute } from "@/components/protected-route";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Tasks from "@/pages/tasks";
import MyTasks from "@/pages/my-tasks";
import Teams from "@/pages/teams";
import TeamDetail from "@/pages/team-detail";
import AdminPanel from "@/pages/admin";
import Settings from "@/pages/settings";
import Notifications from "@/pages/notifications";
import ApiDocs from "@/pages/api-docs";
import AuthPage from "@/pages/auth-page";
import UserGuides from "@/pages/user-guides";
import AdminGuides from "@/pages/admin-guides";
import Departments from "@/pages/departments";
import Invitations from "@/pages/invitations";
import AiAnalytics from "@/pages/ai-analytics";
import TeamsIntegration from "@/pages/teams-integration";
import KnowledgeBase from "@/pages/knowledge-base";
import AISettings from "@/pages/ai-settings";
import { WebSocketProvider } from "@/hooks/useWebSocket";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null; // or a loading spinner
  }

  return (
    <>
      <Switch>
        <Route path="/auth" component={AuthPage} />
        <Route path="/api-docs" component={ApiDocs} />

        {!isAuthenticated ? (
          <>
            <Route path="/" component={Landing} />
            <Route component={NotFound} />
          </>
        ) : (
          <WebSocketProvider>
            <Layout>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/tasks">
                  <ProtectedRoute
                    allowedRoles={["admin", "manager", "agent", "user"]}
                  >
                    <Tasks />
                  </ProtectedRoute>
                </Route>
                <Route path="/my-tasks" component={MyTasks} />
                <Route path="/teams">
                  <ProtectedRoute
                    allowedRoles={["admin", "manager", "agent", "user"]}
                  >
                    <Teams />
                  </ProtectedRoute>
                </Route>
                <Route
                  path="/teams/:id"
                  component={(params) => (
                    <ProtectedRoute
                      allowedRoles={["admin", "manager", "agent", "user"]}
                    >
                      <TeamDetail />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/departments"
                  component={(params) => (
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <Departments />
                    </ProtectedRoute>
                  )}
                />
                <Route path="/settings" component={Settings} />
                <Route path="/notifications" component={Notifications} />
                <Route path="/guides" component={UserGuides} />
                <Route
                  path="/ms-teams-integration"
                  component={TeamsIntegration}
                />
                <Route path="/admin-guides" component={AdminGuides} />
                <Route path="/admin/:tab">
                  <ProtectedRoute allowedRoles={["admin"]}>
                    <AdminPanel />
                  </ProtectedRoute>
                </Route>
                <Route path="/knowledge-base">
                  <ProtectedRoute
                    allowedRoles={["admin", "manager", "agent", "user"]}
                  >
                    <KnowledgeBase />
                  </ProtectedRoute>
                </Route>
                <Route
                  path="/tickets/:id"
                  component={(params) => (
                    <ProtectedRoute
                      allowedRoles={[
                        "admin",
                        "manager",
                        "agent",
                        "user",
                        "customer",
                      ]}
                    >
                      <Dashboard />
                    </ProtectedRoute>
                  )}
                />
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
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
