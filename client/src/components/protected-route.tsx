import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  // If user has customer role and this route requires specific roles
  if (user?.role === 'customer' && allowedRoles && !allowedRoles.includes('customer')) {
    setLocation('/');
    return null;
  }

  // If specific roles are required and user doesn't have one of them
  if (allowedRoles && user?.role && !allowedRoles.includes(user.role)) {
    setLocation('/');
    return null;
  }

  return <>{children}</>;
}