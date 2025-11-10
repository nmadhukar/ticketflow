import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RoleBadgeProps {
  role: string;
  className?: string;
  variant?: "default" | "outline";
  size?: "sm" | "md" | "lg";
}

/**
 * Reusable component for displaying user role badges with consistent styling
 */
export function RoleBadge({
  role,
  className,
  variant = "outline",
  size = "sm",
}: RoleBadgeProps) {
  // Get role badge styles
  const getRoleBadgeStyles = (role: string) => {
    switch (role.toLowerCase()) {
      case "admin":
        return "bg-purple-100 text-purple-700 border-purple-200";
      case "manager":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "agent":
        return "bg-green-100 text-green-700 border-green-200";
      case "customer":
        return "bg-gray-100 text-gray-700 border-gray-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  // Get role display name
  const getRoleDisplayName = (role: string) => {
    switch (role.toLowerCase()) {
      case "admin":
        return "Admin";
      case "manager":
        return "Manager";
      case "agent":
        return "Agent";
      case "customer":
        return "Customer";
      default:
        return role.charAt(0).toUpperCase() + role.slice(1);
    }
  };

  // Get size classes
  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  if (!role) return null;

  return (
    <Badge
      variant={variant}
      className={cn(sizeClasses[size], getRoleBadgeStyles(role), className)}
    >
      {getRoleDisplayName(role)}
    </Badge>
  );
}
