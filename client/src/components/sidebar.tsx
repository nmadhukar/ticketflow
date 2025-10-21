import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  CheckSquare,
  Users,
  TicketIcon,
  FolderOpen,
  Settings,
  BookOpen,
  Brain,
  Plug,
  Building,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();

  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
  });

  const navigation = (() => {
    const role = (user as any)?.role;
    if (role === "admin") {
      return [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "All Tickets", href: "/tasks", icon: FolderOpen },
        { name: "Departments", href: "/departments", icon: Building },
        { name: "Knowledge Base", href: "/knowledge-base", icon: BookOpen },
      ];
    }
    if (role === "manager") {
      return [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "All Tickets", href: "/tasks", icon: FolderOpen },
        { name: "My Tickets", href: "/my-tasks", icon: CheckSquare },
        { name: "Teams", href: "/teams", icon: Users },
        { name: "Departments", href: "/departments", icon: Building },
      ];
    }
    if (role === "agent") {
      return [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "All Tickets", href: "/tasks", icon: FolderOpen },
        { name: "My Tickets", href: "/my-tasks", icon: CheckSquare },
        { name: "Teams", href: "/teams", icon: Users },
      ];
    }
    if (role === "user") {
      return [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "All Tickets", href: "/tasks", icon: FolderOpen },
        { name: "My Tickets", href: "/my-tasks", icon: CheckSquare },
        { name: "Teams", href: "/teams", icon: Users },
      ];
    }

    return [{ name: "Dashboard", href: "/", icon: LayoutDashboard }];
  })();

  const adminGroups = [
    {
      title: "USER & TEAM MANAGEMENT",
      icon: Users,
      hrefBase: "/admin",
      section: "management",
      items: ["User Management", "Invitations", "Team Management"],
    },
    {
      title: "CONFIGURATION",
      icon: Settings,
      hrefBase: "/admin",
      section: "configuration",
      items: ["System Settings", "Company Branding", "API Keys", "AI Settings"],
    },
    {
      title: "ANALYTICS & INSIGHTS",
      icon: Brain,
      hrefBase: "/admin",
      section: "analytics",
      items: ["AI Performance Analytics"],
    },
    {
      title: "CONTENT & DOCUMENTATION",
      icon: BookOpen,
      hrefBase: "/admin",
      section: "content",
      items: ["Help Documentation", "Company Policies"],
    },
    {
      title: "INTEGRATIONS",
      icon: Plug,
      hrefBase: "/admin",
      section: "integrations",
      items: ["Microsoft 365 SSO", "AWS & Email Settings"],
    },
  ] as const;

  const itemToTab: Record<string, string> = {
    "User Management": "users",
    Invitations: "invitations",
    "Team Management": "teams",
    "System Settings": "system-settings",
    "Company Branding": "branding",
    "API Keys": "api",
    "AI Settings": "ai-settings",
    "AI Performance Analytics": "ai-analytics",
    "Help Documentation": "help",
    "Company Policies": "policies",
    "Microsoft 365 SSO": "sso",
    "AWS & Email Settings": "email",
  };

  const itemAllowed: Record<string, Array<string>> = {
    "User Management": ["admin"],
    Invitations: ["admin"],
    "Team Management": ["admin"],
    "System Settings": ["admin"],
    "Company Branding": ["admin"],
    "API Keys": ["admin"],
    "AI Settings": ["admin"],
    "AI Performance Analytics": ["admin", "manager"],
    "Help Documentation": ["admin", "manager"],
    "Company Policies": ["admin", "manager"],
    "Microsoft 365 SSO": ["admin"],
    "AWS & Email Settings": ["admin"],
  };

  return (
    <div
      className={cn(
        "flex h-full w-64 flex-col border-r bg-background",
        className
      )}
    >
      <div className="flex h-16 items-center px-6 border-b gradient-business-subtle">
        <Link href="/">
          <div className="flex items-center gap-2 font-semibold text-lg cursor-pointer">
            {(companySettings as any)?.logoUrl ? (
              <img
                src={(companySettings as any).logoUrl}
                alt={(companySettings as any).companyName || "Company Logo"}
                className="h-8 w-auto object-contain max-w-[120px]"
              />
            ) : (
              <TicketIcon className="h-6 w-6 text-primary" />
            )}
            <span className="text-foreground">
              {(companySettings as any)?.companyName || "TicketFlow"}
            </span>
          </div>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </div>
              </Link>
            );
          })}

          {(["admin"] as const).includes((user as any)?.role) && (
            <>
              <Separator className="my-4" />
              {adminGroups.map((group) => (
                <div key={group.title} className="px-3 pt-4 pb-2">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                    <group.icon className="h-4 w-4" />
                    {group.title}
                  </h3>
                  <div className="space-y-1">
                    {group.items
                      .filter((itemName) =>
                        itemAllowed[itemName]?.includes((user as any)?.role)
                      )
                      .map((itemName) => {
                        const tab = itemToTab[itemName] || "users";
                        const href = `${group.hrefBase}/${tab}?section=${group.section}`;
                        const isActive = location.startsWith(
                          href.split("?")[0]
                        );
                        return (
                          <Link
                            key={itemName}
                            href={href}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                              isActive
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-accent hover:text-accent-foreground"
                            )}
                          >
                            {itemName}
                          </Link>
                        );
                      })}
                  </div>
                </div>
              ))}
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
