import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  const role = (user as any)?.role as string | undefined;
  if (!role) {
    setLocation("/login");
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">Unauthorized</h1>
          <p className="text-muted-foreground">
            You don’t have permission to access this page.
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => history.back()}>
              Go Back
            </Button>
            <Button onClick={() => setLocation("/")}>Go Home</Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
