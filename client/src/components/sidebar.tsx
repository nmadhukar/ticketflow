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
import { useTranslation } from "react-i18next";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation("navigation");

  const navigation = (() => {
    const role = (user as any)?.role;
    if (role === "admin") {
      return [
        { name: t("dashboard"), href: "/", icon: LayoutDashboard },
        { name: t("tickets"), href: "/tasks", icon: FolderOpen },
        { name: t("departments"), href: "/departments", icon: Building },
        { name: t("knowledge_base"), href: "/knowledge-base", icon: BookOpen },
      ];
    }
    if (role === "manager") {
      return [
        { name: t("dashboard"), href: "/", icon: LayoutDashboard },
        { name: t("tickets"), href: "/tasks", icon: FolderOpen },
        { name: t("departments"), href: "/departments", icon: Building },
        { name: t("teams"), href: "/teams", icon: Users },
      ];
    }
    if (role === "agent") {
      return [
        { name: t("dashboard"), href: "/", icon: LayoutDashboard },
        { name: t("tickets"), href: "/tasks", icon: FolderOpen },
        { name: t("teams"), href: "/teams", icon: Users },
      ];
    }

    return [{ name: t("tickets"), href: "/", icon: LayoutDashboard }];
  })();

  const adminGroups = [
    {
      titleKey: "management_title",
      icon: Users,
      hrefBase: "/admin",
      section: "management",
      items: ["users", "invitations", "teams"],
    },
    {
      titleKey: "configuration_title",
      icon: Settings,
      hrefBase: "/admin",
      section: "configuration",
      items: ["company-console", "ai-settings"],
    },
    {
      titleKey: "analytics_title",
      icon: Brain,
      hrefBase: "/admin",
      section: "analytics",
      items: ["ai-analytics", "learning-analytics"],
    },
    {
      titleKey: "content_title",
      icon: BookOpen,
      hrefBase: "/admin",
      section: "content",
      items: ["help", "policies", "guidelines"],
    },
    {
      titleKey: "integrations_title",
      icon: Plug,
      hrefBase: "/admin",
      section: "integrations",
      items: ["sso", "ms-teams-integration", "developer-resources"],
    },
  ] as const;

  // items are already tab keys; no mapping needed

  const itemAllowed: Record<string, Array<string>> = {
    users: ["admin"],
    invitations: ["admin"],
    teams: ["admin"],
    "company-console": ["admin"],
    "developer-resources": ["admin"],
    "ai-settings": ["admin"],
    "ai-analytics": ["admin", "manager"],
    "learning-analytics": ["admin", "manager"],
    help: ["admin", "manager"],
    policies: ["admin", "manager"],
    guidelines: ["admin", "manager"],
    sso: ["admin"],
    "ms-teams-integration": ["admin"],
  };

  return (
    <div
      className={cn("flex h-full w-64 flex-col border-r bg-muted", className)}
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
                <div key={group.section} className="px-3 pt-4 pb-2">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase flex items-center gap-3 line-clamp-1">
                    <group.icon className="h-4 w-4" />
                    {t(group.titleKey)}
                  </h3>
                  <div className="space-y-1">
                    {group.items
                      .filter((tabKey) =>
                        itemAllowed[tabKey]?.includes((user as any)?.role)
                      )
                      .map((tabKey) => {
                        const href = `${group.hrefBase}/${tabKey}?section=${group.section}`;
                        const isActive = location.startsWith(
                          href.split("?")[0]
                        );
                        return (
                          <Link
                            key={tabKey}
                            href={href}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-4 py-1 text-sm font-medium transition-colors cursor-pointer line-clamp-1",
                              isActive
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-accent hover:text-accent-foreground"
                            )}
                          >
                            {t(tabKey)}
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
