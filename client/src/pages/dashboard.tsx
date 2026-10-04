import MainWrapper from "@/components/main-wrapper";
import { Button } from "@/components/ui/button";
import { BedrockCostMonitoring } from "@/components/bedrock-cost-monitoring";
import { S3UsageMonitoring } from "@/components/s3-usage-monitoring";
import StatsCard from "@/components/stats-card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocketContext } from "@/hooks/useWebSocket";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Users,
  UserCog,
  Settings,
  Building,
  Ticket,
  FileCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function Dashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const { t } = useTranslation(["common", "dashboard"]);
  const { isConnected } = useWebSocketContext();
  const [showInfrastructure, setShowInfrastructure] = useState(false);

  const hasManagerOrAdminRole = ["manager", "admin"].includes(
    (user as any)?.role
  );

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery<any>({
    queryKey: ["/api/stats"],
    retry: false,
    enabled: isAuthenticated && hasManagerOrAdminRole,
  });

  // Admin-only system overview stats
  const { data: systemStats, isLoading: systemStatsLoading, isError: systemStatsError, refetch: refetchSystemStats } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    retry: false,
    refetchOnMount: "always",
    enabled: isAuthenticated && (user as any)?.role === "admin",
  });

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {t("actions.loading")}
      </div>
    );
  }

  return (
    <MainWrapper action={<Button onClick={() => { window.location.href = "/tickets"; }}>View tickets</Button>}>
      <div className="mx-auto max-w-7xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("dashboard:title")}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{t("dashboard:subtitle")}</p>
      </header>
      {isConnected && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <div className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
          {t("dashboard:realtimeUpdates")}
        </div>
      )}
      {(statsError || systemStatsError) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm">Some dashboard metrics could not load.</p>
          <Button variant="outline" size="sm" onClick={() => { if (statsError) void refetchStats(); if (systemStatsError) void refetchSystemStats(); }}>Try again</Button>
        </div>
      )}
      <section aria-labelledby="ticket-overview" className="space-y-4">
        <div>
          <h2 id="ticket-overview" className="text-lg font-semibold">Ticket overview</h2>
          <p className="text-sm text-muted-foreground">Track work that is open, moving, or waiting for review.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title={t("dashboard:admin.openTickets")} value={stats?.open ?? 0} icon={<Ticket className="h-4 w-4" />} loading={statsLoading} error={statsError} />
          <StatsCard title={t("dashboard:stats.inProgress")} value={stats?.inProgress ?? 0} icon={<Ticket className="h-4 w-4" />} loading={statsLoading} error={statsError} />
          <StatsCard title="On hold" value={stats?.onHold ?? 0} icon={<Ticket className="h-4 w-4" />} loading={statsLoading} error={statsError} />
          <StatsCard title="Resolved or closed" value={(stats?.resolved ?? 0) + (stats?.closed ?? 0)} icon={<FileCheck className="h-4 w-4" />} loading={statsLoading} error={statsError} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title={t("dashboard:admin.highPriority")} value={stats?.highPriority ?? 0} icon={<AlertTriangle className="h-4 w-4" />} loading={statsLoading} error={statsError} />
          <StatsCard title={t("dashboard:admin.urgentPriority")} value={stats?.urgent ?? systemStats?.urgentTickets ?? 0} icon={<AlertTriangle className="h-4 w-4" />} loading={statsLoading || systemStatsLoading} error={statsError && systemStatsError} />
          <StatsCard title={t("dashboard:admin.pendingArticles")} value={systemStats?.pendingArticles ?? 0} subtitle={t("dashboard:admin.pendingArticlesSubtitle")} icon={<FileCheck className="h-4 w-4" />} loading={systemStatsLoading} error={systemStatsError} onClick={() => { window.location.href = "/knowledge-base?status=draft"; }} />
          <StatsCard title={t("dashboard:admin.avgResolutionTime")} value={typeof systemStats?.avgResolutionTime === "number" ? `${systemStats.avgResolutionTime.toFixed(1)}h` : "N/A"} subtitle={t("dashboard:admin.hours")} icon={<Settings className="h-4 w-4" />} loading={systemStatsLoading} error={systemStatsError} />
        </div>
      </section>
      <section aria-labelledby="organization-overview" className="space-y-4">
        <div>
          <h2 id="organization-overview" className="text-lg font-semibold">Organization overview</h2>
          <p className="text-sm text-muted-foreground">People and structure behind ticket work.</p>
        </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title={t("dashboard:admin.totalUsers")}
          value={(systemStats as any)?.totalUsers || 0}
          subtitle={`${(systemStats as any)?.activeUsers || 0} ${t(
            "dashboard:admin.activeUsers"
          )}`}
          icon={<Users className="h-4 w-4" />}
          iconBg="bg-primary/10"
          iconColor="text-primary"
          loading={systemStatsLoading}
          error={systemStatsError}
        />
        <StatsCard
          title={t("dashboard:admin.totalDepartments")}
          value={(systemStats as any)?.totalDepartments || 0}
          subtitle={t("dashboard:admin.departmentsSubtitle")}
          icon={<Building className="h-4 w-4" />}
          iconBg="bg-secondary/10"
          iconColor="text-secondary-foreground"
          loading={systemStatsLoading}
          error={systemStatsError}
        />
        <StatsCard
          title={t("dashboard:admin.totalTeams")}
          value={(systemStats as any)?.totalTeams || 0}
          subtitle={t("dashboard:admin.acrossDepartments")}
          icon={<UserCog className="h-4 w-4" />}
          iconBg="bg-accent/10"
          iconColor="text-accent-foreground"
          loading={systemStatsLoading}
          error={systemStatsError}
        />
        <StatsCard
          title={t("dashboard:admin.totalTickets")}
          value={(systemStats as any)?.totalTickets || 0}
          subtitle={t("dashboard:admin.allTickets")}
          icon={<Ticket className="h-4 w-4" />}
          iconBg="bg-muted/10"
          iconColor="text-muted-foreground"
          loading={systemStatsLoading}
          error={systemStatsError}
        />
      </div>
      </section>
      <details className="rounded-lg border bg-card p-5" onToggle={(event) => setShowInfrastructure(event.currentTarget.open)}>
        <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Infrastructure usage</summary>
        <p className="mt-1 text-sm text-muted-foreground">Bedrock and S3 usage for administrators.</p>
        {showInfrastructure && <div className="mt-6 space-y-6">
        <div className="space-y-4">
          <h3 className="text-base font-semibold">Bedrock usage</h3>
          <BedrockCostMonitoring />
        </div>
        <div className="space-y-4">
          <h3 className="text-base font-semibold">S3 usage</h3>
          <S3UsageMonitoring />
        </div>
        </div>}
      </details>
      </div>
    </MainWrapper>
  );
}
