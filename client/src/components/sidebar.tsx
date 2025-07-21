import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  CheckSquare,
  Users,
  Shield,
  LogOut,
  TicketIcon,
  UserCircle,
  FolderOpen,
  Settings,
  BookOpen,
  MessageSquare,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  
  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
  });

  const navigation = user?.role === 'customer' 
    ? [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "My Tickets", href: "/my-tasks", icon: CheckSquare },
      ]
    : [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "All Tickets", href: "/tasks", icon: FolderOpen },
        { name: "My Tickets", href: "/my-tasks", icon: CheckSquare },
        { name: "Teams", href: "/teams", icon: Users },
      ];

  const adminNavigation = [
    { name: "Admin Panel", href: "/admin", icon: Shield },
    { name: "Invitations", href: "/admin/invitations", icon: Mail },
  ];

  const bottomNavigation = [
    { name: "User Guides", href: "/guides", icon: BookOpen },
    { name: "Teams Integration", href: "/teams-integration", icon: MessageSquare },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <div className={cn("flex h-full w-64 flex-col border-r bg-background", className)}>
      <div className="flex h-16 items-center px-6 border-b gradient-business-subtle">
        <Link href="/">
          <div className="flex items-center gap-2 font-semibold text-lg cursor-pointer">
            {companySettings?.logoUrl ? (
              <img 
                src={companySettings.logoUrl} 
                alt={companySettings.companyName || "Company Logo"}
                className="h-8 w-auto object-contain max-w-[120px]"
              />
            ) : (
              <TicketIcon className="h-6 w-6 text-primary" />
            )}
            <span className="text-foreground">{companySettings?.companyName || "TicketFlow"}</span>
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
          
          {user?.role === "admin" && (
            <>
              <Separator className="my-4" />
              <div className="px-3 pb-2">
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                  Administration
                </h3>
              </div>
              {adminNavigation.map((item) => {
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
            </>
          )}
        </nav>
      </div>
      
      <div className="border-t p-4">
        <div className="flex items-center gap-3 px-2 mb-4">
          {user?.profileImageUrl ? (
            <img
              src={user.profileImageUrl}
              alt={user.firstName || "User"}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <UserCircle className="h-8 w-8 text-muted-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.email}
            </p>
          </div>
        </div>
        
        <nav className="space-y-1">
          {bottomNavigation.map((item) => {
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
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => window.location.href = "/api/logout"}
              >
                <LogOut className="mr-3 h-4 w-4" />
                Sign Out
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sign out of your account</TooltipContent>
          </Tooltip>
        </nav>
      </div>
    </div>
  );
}