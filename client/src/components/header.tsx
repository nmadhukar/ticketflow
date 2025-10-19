import { Button } from "@/components/ui/button";
import {
  Bell,
  Globe,
  ChevronDown,
  UserCircle,
  LogOut,
  User,
  MessageSquare,
  Settings,
  BookOpen,
  LogOutIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "./ui/menubar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import React, { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

const SignOutButton = React.forwardRef<HTMLButtonElement>((props, ref) => {
  const { logout, isLoggingOut } = useAuth();

  return (
    <Button
      ref={ref}
      variant="ghost"
      className="w-full justify-start"
      onClick={logout}
      disabled={isLoggingOut}
      {...props}
    >
      <LogOut className="h-4 w-4" />
      {isLoggingOut ? "Signing Out..." : "Sign Out"}
    </Button>
  );
});

export default function Header({ title, subtitle, action }: HeaderProps) {
  const { user } = useAuth();
  const [location] = useLocation();

  const userDropdownActions = useMemo(() => {
    return (user as any)?.role === "admin"
      ? [
          { name: "Admin Guides", href: "/admin-guides", icon: BookOpen },
          {
            name: "Microsoft Teams Integration",
            href: "/ms-teams-integration",
            icon: MessageSquare,
          },
          { name: "Settings", href: "/settings", icon: Settings },
        ]
      : [
          { name: "User Guides", href: "/guides", icon: BookOpen },
          { name: "Settings", href: "/settings", icon: Settings },
        ];
  }, [user]);

  return (
    <header className="bg-card shadow-business border-b border-border p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center space-x-4">
          {/* Language Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center space-x-2"
              >
                <Globe className="h-4 w-4" />
                <span>EN</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>English</DropdownMenuItem>
              <DropdownMenuItem>Español</DropdownMenuItem>
              <DropdownMenuItem>Français</DropdownMenuItem>
              <DropdownMenuItem>Deutsch</DropdownMenuItem>
              <DropdownMenuItem>中文</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notifications */}
          <Button
            variant="ghost"
            size="sm"
            className="relative"
            onClick={() => (window.location.href = "/notifications")}
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              3
            </span>
          </Button>

          {/* Action Button */}
          {action}

          <Menubar className="items-center border-none">
            <MenubarMenu>
              <MenubarTrigger
                aria-label="User menu"
                className="px-0 cursor-pointer"
              >
                <UserCircle className="h-8 w-8 text-muted-foreground" />
              </MenubarTrigger>
              <MenubarContent className="w-[18rem]">
                <div className="px-4 py-3">
                  <p className="text-sm font-medium truncate">
                    {(user as any)?.firstName} {(user as any)?.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {(user as any)?.email}
                  </p>
                </div>
                <MenubarSeparator />
                {userDropdownActions.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <MenubarItem key={item.name}>
                      <Link href={item.href}>
                        <div
                          className={cn(
                            "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-accent hover:text-accent-foreground"
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          {item.name}
                        </div>
                      </Link>
                    </MenubarItem>
                  );
                })}
                <MenubarSeparator />
                <MenubarItem>
                  <SignOutButton />
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </div>
      </div>
    </header>
  );
}
