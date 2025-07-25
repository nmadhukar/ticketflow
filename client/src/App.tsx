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
                <ProtectedRoute allowedRoles={["admin", "manager", "agent", "user"]}>
                  <Tasks />
                </ProtectedRoute>
              </Route>
              <Route path="/my-tasks" component={MyTasks} />
              <Route path="/teams">
                <ProtectedRoute allowedRoles={["admin", "manager", "agent", "user"]}>
                  <Teams />
                </ProtectedRoute>
              </Route>
              <Route path="/teams/:id" component={(params) => (
                <ProtectedRoute allowedRoles={["admin", "manager", "agent", "user"]}>
                  <TeamDetail />
                </ProtectedRoute>
              )} />
              <Route path="/admin">
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminPanel />
                </ProtectedRoute>
              </Route>
              <Route path="/ai-settings">
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AISettings />
                </ProtectedRoute>
              </Route>
              <Route path="/settings" component={Settings} />
              <Route path="/notifications" component={Notifications} />
              <Route path="/guides" component={UserGuides} />
              <Route path="/teams-integration" component={TeamsIntegration} />
              <Route path="/admin/guides" component={AdminGuides} />
              <Route path="/admin/departments">
                <ProtectedRoute allowedRoles={["admin"]}>
                  <Departments />
                </ProtectedRoute>
              </Route>
              <Route path="/admin/invitations">
                <ProtectedRoute allowedRoles={["admin"]}>
                  <Invitations />
                </ProtectedRoute>
              </Route>
              <Route path="/admin/ai-analytics">
                <ProtectedRoute allowedRoles={["admin", "manager"]}>
                  <AiAnalytics />
                </ProtectedRoute>
              </Route>
              <Route path="/knowledge-base">
                <ProtectedRoute allowedRoles={["admin", "manager", "agent", "user"]}>
                  <KnowledgeBase />
                </ProtectedRoute>
              </Route>

              <Route path="/tickets/:id" component={(params) => (
                <ProtectedRoute allowedRoles={["admin", "manager", "agent", "user", "customer"]}>
                  <Dashboard />
                </ProtectedRoute>
              )} />
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
