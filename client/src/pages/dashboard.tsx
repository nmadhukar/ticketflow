/**
 * Dashboard Page - Main Hub for Ticket Management
 *
 * Serves as the primary interface for users to:
 * - View system statistics and key metrics
 * - Access recent tickets and activity
 * - Filter and search through assigned tickets
 * - Navigate to detailed ticket views
 * - Create new tickets with quick access
 * - Monitor real-time updates via WebSocket connection
 *
 * Features include:
 * - Interactive dashboard filtering - clicking stats cards filters the tasks table
 * - Visual indicators for active filters with badges and clear button
 * - Stats cards show active state with ring highlight when filtering is applied
 * - Role-based content display (different views for admin vs regular users)
 * - Real-time notifications and updates
 * - Responsive design for desktop and mobile devices
 *
 * Navigation Support:
 * - Direct ticket access via URL parameters
 * - Breadcrumb navigation for deep-linked tickets
 * - Back navigation from ticket detail views
 */

import MainWrapper from "@/components/main-wrapper";
import { BedrockCostMonitoring } from "@/components/bedrock-cost-monitoring";
import { S3UsageMonitoring } from "@/components/s3-usage-monitoring";
import StatsCard from "@/components/stats-card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocketContext } from "@/hooks/useWebSocket";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
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

  const hasCustomerRole = (user as any)?.role === "customer";

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

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/stats"],
    retry: false,
    enabled: isAuthenticated && hasManagerOrAdminRole,
  });

  // Admin-only system overview stats
  const { data: systemStats, isLoading: systemStatsLoading } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    retry: false,
    refetchOnMount: "always",
    enabled: isAuthenticated && (user as any)?.role === "admin",
  });

  const { data: recentTasks, isLoading: tasksLoading } = useQuery<any[]>({
    queryKey: ["/api/tasks"],
    retry: false,
    enabled: isAuthenticated && !hasCustomerRole,
  });

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {t("actions.loading")}
      </div>
    );
  }

  return (
    <MainWrapper>
      {/* WebSocket Connection Status */}
      {isConnected && (
        <div className="flex items-center gap-2 text-sm text-green-600 mb-3">
          <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
          {t("dashboard:realtimeUpdates")}
        </div>
      )}

      {/* Admin-only System Overview Cards - First Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
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
        />
        <StatsCard
          title={t("dashboard:admin.totalDepartments")}
          value={(systemStats as any)?.totalDepartments || 0}
          subtitle={t("dashboard:admin.departmentsSubtitle")}
          icon={<Building className="h-4 w-4" />}
          iconBg="bg-secondary/10"
          iconColor="text-secondary-foreground"
          loading={systemStatsLoading}
        />
        <StatsCard
          title={t("dashboard:admin.totalTeams")}
          value={(systemStats as any)?.totalTeams || 0}
          subtitle={t("dashboard:admin.acrossDepartments")}
          icon={<UserCog className="h-4 w-4" />}
          iconBg="bg-accent/10"
          iconColor="text-accent-foreground"
          loading={systemStatsLoading}
        />
        <StatsCard
          title={t("dashboard:admin.totalTickets")}
          value={(systemStats as any)?.totalTickets || 0}
          subtitle={t("dashboard:admin.allTickets")}
          icon={<Ticket className="h-4 w-4" />}
          iconBg="bg-muted/10"
          iconColor="text-muted-foreground"
          loading={systemStatsLoading}
        />
      </div>

      {/* Admin-only System Overview Cards - Second Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatsCard
          title={t("dashboard:admin.ticketStatus")}
          value={`${(systemStats as any)?.openTickets || 0} / ${
            stats?.inProgress || 0
          } / ${(stats?.resolved || 0) + (stats?.closed || 0)}`}
          subtitle={t("dashboard:admin.openInProgressCompleted")}
          icon={<BarChart3 className="h-4 w-4" />}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-500"
          loading={systemStatsLoading || statsLoading}
        />
        <StatsCard
          title={t("dashboard:admin.priorityTickets")}
          value={`${stats?.highPriority || 0} / ${
            (systemStats as any)?.urgentTickets || 0
          }`}
          subtitle={t("dashboard:admin.highUrgent")}
          icon={<AlertTriangle className="h-4 w-4" />}
          iconBg="bg-orange-500/10"
          iconColor="text-orange-500"
          loading={systemStatsLoading || statsLoading}
        />
        <StatsCard
          title={t("dashboard:admin.avgResolutionTime")}
          value={(systemStats as any)?.avgResolutionTime || "N/A"}
          subtitle={t("dashboard:admin.hours")}
          icon={<Settings className="h-4 w-4" />}
          iconBg="bg-muted/10"
          iconColor="text-muted-foreground"
          loading={systemStatsLoading}
        />
        <StatsCard
          title={t("dashboard:admin.pendingArticles")}
          value={(systemStats as any)?.pendingArticles || 0}
          subtitle={t("dashboard:admin.pendingArticlesSubtitle")}
          icon={<FileCheck className="h-4 w-4" />}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-500"
          loading={systemStatsLoading}
          onClick={() => {
            window.location.href = "/knowledge-base?status=draft";
          }}
        />
      </div>

      <div className="space-y-6">
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Bedrock Usage</h2>
          <BedrockCostMonitoring />
        </div>
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">S3 Usage</h2>
          <S3UsageMonitoring />
        </div>
      </div>
    </MainWrapper>
  );
}
