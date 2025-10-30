import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Brain,
  Building,
  FolderOpen,
  LayoutDashboard,
  Plug,
  Settings,
  Users,
} from "lucide-react";
import { Link, useLocation } from "wouter";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();

  const navigation = (() => {
    const role = (user as any)?.role;
    if (role === "admin") {
      return [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "Tickets", href: "/tasks", icon: FolderOpen },
        { name: "Departments", href: "/departments", icon: Building },
        { name: "Knowledge Base", href: "/knowledge-base", icon: BookOpen },
      ];
    }
    if (role === "manager") {
      return [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "Tickets", href: "/tasks", icon: FolderOpen },
        { name: "Teams", href: "/teams", icon: Users },
        { name: "Departments", href: "/departments", icon: Building },
      ];
    }
    if (role === "agent") {
      return [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "Tickets", href: "/tasks", icon: FolderOpen },
        { name: "Teams", href: "/teams", icon: Users },
        { name: "Knowledge Base", href: "/knowledge-base", icon: BookOpen },
      ];
    }

    return [
      { name: "Tickets", href: "/", icon: LayoutDashboard },
      { name: "Knowledge Base", href: "/knowledge-base", icon: BookOpen },
    ];
  })();

  const adminGroups = [
    {
      title: "User & Team Management",
      icon: Users,
      hrefBase: "/admin",
      section: "management",
      items: ["User Management", "Invitations", "Team Management"],
    },
    {
      title: "Configuration",
      icon: Settings,
      hrefBase: "/admin",
      section: "configuration",
      items: ["System Settings", "Company Branding", "API Keys", "AI Settings"],
    },
    {
      title: "Analytics & Insights",
      icon: Brain,
      hrefBase: "/admin",
      section: "analytics",
      items: ["AI Performance", "Learning Queue"],
    },
    {
      title: "Docs & Guides",
      icon: BookOpen,
      hrefBase: "/admin",
      section: "content",
      items: ["Help Documentation", "Company Policies"],
    },
    {
      title: "Integrations",
      icon: Plug,
      hrefBase: "/admin",
      section: "integrations",
      items: ["Microsoft 365 SSO", "Email"],
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
    "AI Performance": "ai-analytics",
    "Learning Queue": "learning-queue",
    "Help Documentation": "help",
    "Company Policies": "policies",
    "Microsoft 365 SSO": "sso",
    Email: "email",
  };

  const itemAllowed: Record<string, Array<string>> = {
    "User Management": ["admin"],
    Invitations: ["admin"],
    "Team Management": ["admin"],
    "System Settings": ["admin"],
    "Company Branding": ["admin"],
    "API Keys": ["admin"],
    "AI Settings": ["admin"],
    "AI Performance": ["admin", "manager"],
    "Learning Queue": ["admin", "manager"],
    "Help Documentation": ["admin", "manager"],
    "Company Policies": ["admin", "manager"],
    "Microsoft 365 SSO": ["admin"],
    Email: ["admin"],
  };

  return (
    <div
      className={cn(
        "flex h-full w-64 flex-col border-r bg-background",
        className
      )}
    >
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
