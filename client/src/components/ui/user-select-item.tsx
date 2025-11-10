import React from "react";
import { SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { User } from "@shared/schema";

interface UserSelectItemProps {
  user: User;
  value: string;
  showEmail?: boolean;
  showRoleBadge?: boolean;
  className?: string;
}

/**
 * Reusable component for displaying user information in Select dropdown items
 * Shows user name, email (optional), and role badge (optional)
 */
export function UserSelectItem({
  user,
  value,
  showEmail = true,
  showRoleBadge = true,
  className,
}: UserSelectItemProps) {
  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  const displayName = fullName || user.email || "Unknown User";

  const getRoleBadgeStyles = (role: string) => {
    switch (role) {
      case "admin":
        return "bg-purple-100 text-purple-700 border-purple-200";
      case "manager":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "agent":
        return "bg-green-100 text-green-700 border-green-200";
      case "customer":
        return "bg-gray-100 text-gray-700 border-gray-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
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

  return (
    <SelectItem value={value} className={className}>
      <div className="flex items-center justify-between w-full gap-2">
        <span className="flex-1 truncate">
          {showEmail && user.email ? <span>({user.email})</span> : displayName}
        </span>
        {showRoleBadge && user.role && (
          <Badge
            variant="outline"
            className={cn("shrink-0", getRoleBadgeStyles(user.role))}
          >
            {getRoleLabel(user.role)}
          </Badge>
        )}
      </div>
    </SelectItem>
  );
}
