import { useEffect } from "react";
import { Bell, BookOpen, ChevronDown, Globe2, Menu, Settings, TicketIcon, UserCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useUserPreferences, useUpdateUserPreferences } from "@/hooks/useUserPreferences";
import { apiRequest } from "@/lib/queryClient";
import { UnreadNotification, User } from "@/types/user";
import { setThemeFromPrimary } from "@/theme/color";
import { RoleBadge } from "./ui/role-badge";
import { useWorkspaceNavigation } from "./navigation-context";
import { StatsDrawer } from "./stats-drawer";
import { ActivityDrawer } from "./activity-drawer";
import SignOutButton from "./signOutButton";

const languages = [{ code: "en", name: "English" }, { code: "es", name: "Español" }, { code: "fr", name: "Français" }, { code: "de", name: "Deutsch" }, { code: "zh", name: "中文" }] as const;

export default function Header({ action }: { action?: React.ReactNode }) {
  const { user } = useAuth();
  const typedUser = user as User | undefined;
  const { i18n, t } = useTranslation();
  const [, navigate] = useLocation();
  const navigation = useWorkspaceNavigation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: companyBranding } = useQuery<{ companyName?: string; logoUrl?: string; primaryColor?: string }>({ queryKey: ["/api/company-settings/branding"] });
  const { data: preferences } = useUserPreferences();
  const updatePreferences = useUpdateUserPreferences();
  useEffect(() => {
    if (preferences?.language && preferences.language !== i18n.language) i18n.changeLanguage(preferences.language);
  }, [preferences?.language, i18n]);
  useEffect(() => {
    if (companyBranding?.primaryColor) setThemeFromPrimary(companyBranding.primaryColor);
  }, [companyBranding?.primaryColor]);
  const { data: unreadNotifications = [], isError, isLoading, refetch } = useQuery<UnreadNotification[]>({
    queryKey: ["/api/notifications", { read: false, limit: 5 }],
    queryFn: async () => (await apiRequest("GET", "/api/notifications?limit=5&read=false")).json(),
    refetchOnMount: "always",
  });
  const markRead = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/notifications") }),
    onError: () => toast({ title: "Couldn't mark notification as read", description: "Open Notifications to try again.", variant: "destructive" }),
  });
  const language = (preferences?.language || i18n.language || "en").split("-")[0];

  return <header className="sticky top-0 z-30 border-b bg-card/95 px-4 py-3 backdrop-blur-sm sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {navigation && <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label="Open navigation" onClick={navigation.open}><Menu aria-hidden="true" /></Button>}
        <Link href="/" className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {companyBranding?.logoUrl ? <img src={companyBranding.logoUrl} alt="" className="h-8 max-w-20 object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><TicketIcon aria-hidden="true" className="h-5 w-5" /></span>}
          <span className="truncate text-sm font-semibold tracking-tight sm:text-base">{companyBranding?.companyName || "TicketFlow"}</span>
        </Link>
      </div>
      {action && <div className="order-last flex w-full items-center justify-end border-t pt-3 sm:order-none sm:w-auto sm:border-0 sm:pt-0">{action}</div>}
      <div className="flex shrink-0 items-center gap-1">
        <StatsDrawer />
        <ActivityDrawer />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Change language" title="Change language"><Globe2 aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {languages.map((item) => <DropdownMenuItem key={item.code} onSelect={() => { i18n.changeLanguage(item.code); updatePreferences.mutate({ language: item.code }); }} className="min-h-10 gap-3">
              <span className="flex-1">{item.name}</span><span className="text-xs text-muted-foreground">{language === item.code ? "Selected" : item.code.toUpperCase()}</span>
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu onOpenChange={(open) => { if (open) void refetch(); }}>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="relative" aria-label="Notifications" title="Notifications"><Bell aria-hidden="true" />{unreadNotifications.length > 0 && <span aria-hidden="true" className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">{unreadNotifications.length}</span>}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
            <p className="border-b px-4 py-3 text-sm font-semibold">Notifications</p>
            <div className="max-h-80 overflow-y-auto">
              {isLoading ? <p role="status" className="p-4 text-sm text-muted-foreground">Loading notifications…</p> : isError ? <div role="alert" className="space-y-2 p-4 text-sm"><p>Couldn't load notifications.</p><Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></div> : unreadNotifications.length === 0 ? <div className="px-4 py-8 text-center"><Bell aria-hidden="true" className="mx-auto mb-2 h-5 w-5 text-muted-foreground" /><p className="text-sm font-medium">You're all caught up</p><p className="mt-1 text-xs text-muted-foreground">No unread notifications.</p></div> : unreadNotifications.map((note) => <DropdownMenuItem key={note.id} className="flex cursor-pointer flex-col items-start gap-1 px-4 py-3" onSelect={() => { markRead.mutate(note.id); navigate("/notifications"); }}><span className="text-sm font-medium">{note.title || "Notification"}</span><span className="line-clamp-2 text-xs text-muted-foreground">{note.content}</span></DropdownMenuItem>)}
            </div>
            <DropdownMenuSeparator className="m-0" />
            <DropdownMenuItem asChild><Link href="/notifications" className="flex min-h-11 items-center justify-center text-sm font-medium text-primary">View all notifications</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" className="px-2" aria-label="User menu"><UserCircle aria-hidden="true" className="!h-6 !w-6 text-muted-foreground" /><span className="hidden max-w-24 truncate text-sm xl:inline">{typedUser?.firstName || "Account"}</span><ChevronDown aria-hidden="true" className="hidden !h-3 !w-3 sm:block" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="space-y-1 px-3 py-3"><p className="truncate text-sm font-semibold">{typedUser?.firstName} {typedUser?.lastName}</p><p className="truncate text-xs text-muted-foreground">{typedUser?.email}</p>{typedUser?.role && <RoleBadge role={typedUser.role} size="sm" />}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/guides" className="flex min-h-10 items-center gap-2"><BookOpen aria-hidden="true" className="h-4 w-4" />{t("nav.userGuides", "Help & guides")}</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/settings" className="flex min-h-10 items-center gap-2"><Settings aria-hidden="true" className="h-4 w-4" />{t("nav.settings", "Settings")}</Link></DropdownMenuItem>
            <DropdownMenuSeparator /><SignOutButton />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </header>;
}
