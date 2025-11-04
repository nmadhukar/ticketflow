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
  Settings,
  TicketIcon,
  UserCircle,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import SignOutButton from "./signOutButton";
import { setThemeFromPrimary } from "@/theme/color";
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
  const { i18n, t } = useTranslation();
  const [location] = useLocation();
  const { data: companyBranding } = useQuery({
    queryKey: ["/api/company-settings/branding"],
  });

  // Map language -> country for flag display
  const LOCALE_COUNTRY: Record<string, string> = {
    en: "US",
    es: "ES",
    fr: "FR",
    de: "DE",
    zh: "CN",
  };

  const getFlagUrl = (langCode: string) => {
    const cc = (LOCALE_COUNTRY[langCode] || "US").toLowerCase();
    // Use FlagCDN SVGs to avoid OS emoji issues
    return `https://flagcdn.com/${cc}.svg`;
  };

  // Apply branding primary color to CSS variables so UI updates globally
  useEffect(() => {
    const primary = (companyBranding as any)?.primaryColor as
      | string
      | undefined;
    if (!primary) return;
    setThemeFromPrimary(primary);
  }, [companyBranding]);

  // Unread notifications
  interface UnreadNotification {
    id: number;
    title: string;
    content: string;
    type: string;
    relatedTaskId?: number | null;
    createdAt?: string;
  }

  const { data: unreadNotifications = [], refetch: refetchUnread } = useQuery<
    UnreadNotification[]
  >({
    queryKey: ["/api/notifications", { read: false, limit: 5 }],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?limit=5&read=false`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchOnMount: "always",
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
    },
    onSuccess: () => refetchUnread(),
  });

  const userDropdownActions = useMemo(() => {
    return (user as any)?.role === "admin"
      ? [{ name: t("nav.settings"), href: "/settings", icon: Settings }]
      : [
          { name: t("nav.userGuides"), href: "/guides", icon: BookOpen },
          { name: t("nav.settings"), href: "/settings", icon: Settings },
        ];
  }, [user]);

  return (
    <header className="relative bg-card shadow-business p-5 sticky top-0 backdrop-blur-md flex items-center justify-between z-50">
      <div className="flex items-center gap-3 ml-2">
        {(companyBranding as any)?.logoUrl ? (
          <img
            src={(companyBranding as any).logoUrl}
            alt={(companyBranding as any).companyName || "Company Logo"}
            className="h-8 w-auto object-contain max-w-[120px]"
          />
        ) : (
          <TicketIcon className="h-10 w-auto text-primary" />
        )}
        <span className="text-foreground text-lg">
          {(companyBranding as any)?.companyName || "TicketFlow"}
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
              <span className="flex items-center gap-2">
                <img
                  src={getFlagUrl(i18n.language?.split?.("-")?.[0] || "en")}
                  alt="flag"
                  className="h-3.5 w-5 rounded-sm object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <span>{i18n.language?.toUpperCase?.() || "EN"}</span>
              </span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("en")}>
              <img
                src={getFlagUrl("en")}
                alt="US"
                className="h-3.5 w-5 mr-2 rounded-sm object-cover"
              />
              English
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("es")}>
              <img
                src={getFlagUrl("es")}
                alt="ES"
                className="h-3.5 w-5 mr-2 rounded-sm object-cover"
              />
              Español
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("fr")}>
              <img
                src={getFlagUrl("fr")}
                alt="FR"
                className="h-3.5 w-5 mr-2 rounded-sm object-cover"
              />
              Français
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("de")}>
              <img
                src={getFlagUrl("de")}
                alt="DE"
                className="h-3.5 w-5 mr-2 rounded-sm object-cover"
              />
              Deutsch
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("zh")}>
              <img
                src={getFlagUrl("zh")}
                alt="CN"
                className="h-3.5 w-5 mr-2 rounded-sm object-cover"
              />
              中文
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <DropdownMenu onOpenChange={() => refetchUnread()}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="relative">
              <Bell className="h-4 w-4" />
              {unreadNotifications.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {unreadNotifications.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-80 p-0">
            <div className="px-3 py-2 border-b text-sm font-medium">
              Notifications
            </div>
            <div className="max-h-80 overflow-y-auto">
              {unreadNotifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No unread notifications
                </div>
              ) : (
                unreadNotifications.map((n) => (
                  <DropdownMenuItem
                    key={n.id}
                    className="px-3 py-2 whitespace-normal cursor-pointer"
                    onClick={() => {
                      markReadMutation.mutate(n.id);
                      window.location.href = "/notifications";
                    }}
                  >
                    <div className="text-sm font-medium truncate">
                      {n.title || "Notification"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {n.content}
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </div>
            <div className="border-t px-2 py-2">
              <Link href="/notifications">
                <Button variant="ghost" size="sm" className="w-full">
                  View all
                </Button>
              </Link>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
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
      {/* Primary accent line */}
      <div
        className="absolute inset-x-0 bottom-0 h-[2px]"
        style={{ background: "var(--primary)" }}
      />
    </header>
  );
}
