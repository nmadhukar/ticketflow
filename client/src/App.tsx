import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
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

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/" component={Dashboard} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/my-tasks" component={MyTasks} />
          <Route path="/teams" component={Teams} />
          <Route path="/teams/:id" component={TeamDetail} />
          <Route path="/admin" component={AdminPanel} />
          <Route path="/settings" component={Settings} />
          <Route path="/notifications" component={Notifications} />
        </>
      )}
      <Route path="/login" component={LoginPage} />
      <Route path="/api-docs" component={ApiDocs} />
      <Route component={NotFound} />
    </Switch>
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
