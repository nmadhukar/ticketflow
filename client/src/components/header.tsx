import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  Bell,
  BookOpen,
  ChevronDown,
  Globe,
  MessageSquare,
  Settings,
  TicketIcon,
  UserCircle,
} from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import SignOutButton from "./signOutButton";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "./ui/menubar";

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function Header({ title, subtitle, action }: HeaderProps) {
  const { user } = useAuth();
  const [location] = useLocation();
  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
  });

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
    <header className="bg-card shadow-business p-5 sticky top-0 backdrop-blur-md flex items-center justify-between z-50">
      <div className="flex items-center gap-3 ml-2">
        {(companySettings as any)?.logoUrl ? (
          <img
            src={(companySettings as any).logoUrl}
            alt={(companySettings as any).companyName || "Company Logo"}
            className="h-8 w-auto object-contain max-w-[120px]"
          />
        ) : (
          <TicketIcon className="h-10 w-auto text-primary" />
        )}
        <span className="text-foreground text-lg">
          {(companySettings as any)?.companyName || "TicketFlow"}
        </span>
      </div>
      <div className="flex items-center space-x-4">
        {/* Action Button */}
        {action}

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
    </header>
  );
}
