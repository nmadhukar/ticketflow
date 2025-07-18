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
import LoginPage from "@/pages/login-page";
import UserGuides from "@/pages/user-guides";
import AdminGuides from "@/pages/admin-guides";
import Departments from "@/pages/departments";
import Invitations from "@/pages/invitations";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/api-docs" component={ApiDocs} />
        {isLoading || !isAuthenticated ? (
          <Route path="/" component={Landing} />
        ) : (
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
              <Route path="/settings" component={Settings} />
              <Route path="/notifications" component={Notifications} />
              <Route path="/guides" component={UserGuides} />
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
              <Route component={NotFound} />
            </Switch>
          </Layout>
        )}
        <Route component={NotFound} />
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
