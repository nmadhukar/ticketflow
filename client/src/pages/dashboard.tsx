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
import StatsCard from "@/components/stats-card";
import { BedrockCostMonitoring } from "@/components/bedrock-cost-monitoring";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocketContext } from "@/hooks/useWebSocket";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Clock,
  MessageCircle,
  Plus,
  UserCheck,
  Users,
  UserCog,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function Dashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const { t } = useTranslation(["common", "dashboard"]);
  const { isConnected } = useWebSocketContext();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);

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
  const { data: systemStats } = useQuery<any>({
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

  const { data: teamMembers = [], isLoading: membersLoading } = useQuery<any[]>(
    {
      queryKey: ["/api/teams/my"],
      retry: false,
      enabled: isAuthenticated && !hasCustomerRole,
      initialData: [],
      refetchOnMount: "always",
    }
  );

  const { data: activity, isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ["/api/activity"],
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
    <MainWrapper
      title={t("dashboard:title")}
      subTitle={t("dashboard:subtitle")}
    >
      {/* WebSocket Connection Status */}
      {isConnected && (
        <div className="flex items-center gap-2 text-sm text-green-600 mb-3">
          <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
          {t("dashboard:realtimeUpdates")}
        </div>
      )}

      {/* Admin-only System Overview Cards */}
      {(user as any)?.role === "admin" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="hover:shadow-business transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("dashboard:admin.totalUsers")}
              </CardTitle>
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(systemStats as any)?.totalUsers || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                {(systemStats as any)?.activeUsers || 0}{" "}
                {t("dashboard:admin.activeUsers")}
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-business transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("dashboard:admin.totalTeams")}
              </CardTitle>
              <div className="h-8 w-8 rounded-lg bg-secondary/10 flex items-center justify-center">
                <UserCog className="h-4 w-4 text-secondary-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(systemStats as any)?.totalTeams || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("dashboard:admin.acrossDepartments")}
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-business transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("dashboard:admin.openTickets")}
              </CardTitle>
              <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-accent-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(systemStats as any)?.openTickets || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                {(systemStats as any)?.urgentTickets || 0}{" "}
                {t("dashboard:admin.highPriority")}
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-business transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("dashboard:admin.avgResolutionTime")}
              </CardTitle>
              <div className="h-8 w-8 rounded-lg bg-muted/10 flex items-center justify-center">
                <Settings className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(systemStats as any)?.avgResolutionTime || "N/A"}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("dashboard:admin.hours")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stats Cards */}
      {hasManagerOrAdminRole ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div
            onClick={() => {
              setStatusFilter(null);
              setPriorityFilter(null);
            }}
            className="cursor-pointer transform transition-transform hover:scale-105"
          >
            <StatsCard
              title={t("dashboard:stats.totalTickets")}
              value={stats?.total || 0}
              icon={<BarChart3 className="text-blue-600" />}
              loading={statsLoading}
              isActive={!statusFilter && !priorityFilter}
            />
          </div>
          <div
            onClick={() => {
              setStatusFilter("in_progress");
              setPriorityFilter(null);
            }}
            className="cursor-pointer transform transition-transform hover:scale-105"
          >
            <StatsCard
              title={t("dashboard:stats.inProgress")}
              value={stats?.inProgress || 0}
              icon={<Clock className="text-yellow-600" />}
              loading={statsLoading}
              isActive={statusFilter === "in_progress"}
            />
          </div>
          <div
            onClick={() => {
              setStatusFilter("completed");
              setPriorityFilter(null);
            }}
            className="cursor-pointer transform transition-transform hover:scale-105"
          >
            <StatsCard
              title={t("dashboard:stats.completed", {
                defaultValue: "Completed",
              })}
              value={(stats?.resolved || 0) + (stats?.closed || 0)}
              icon={<CheckCircle className="text-green-600" />}
              loading={statsLoading}
              isActive={statusFilter === "completed"}
            />
          </div>
          <div
            onClick={() => {
              setStatusFilter(null);
              setPriorityFilter("high");
            }}
            className="cursor-pointer transform transition-transform hover:scale-105"
          >
            <StatsCard
              title={t("dashboard:stats.highPriority", {
                defaultValue: "High Priority",
              })}
              value={stats?.highPriority || 0}
              icon={<AlertTriangle className="text-red-600" />}
              loading={statsLoading}
              isActive={priorityFilter === "high"}
            />
          </div>
        </div>
      ) : (
        <></>
      )}

      {/* Admin-only Bedrock Cost Monitoring */}
      {(user as any)?.role === "admin" && (
        <div className="mb-8">
          <BedrockCostMonitoring />
        </div>
      )}

      {/* Sidebar Content */}
      {!hasCustomerRole && (
        <div className="grid grid-cols-2 gap-6">
          {/* Team Members */}
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard:teamMembers.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {membersLoading ? (
                <div className="text-center py-4">{t("actions.loading")}</div>
              ) : teamMembers?.length ? (
                teamMembers?.slice(0, 5).map((team: any) => (
                  <div key={team.id} className="flex items-center space-x-3">
                    <Avatar>
                      <AvatarImage src="/placeholder-avatar.jpg" />
                      <AvatarFallback>
                        {team.name?.charAt(0) || "T"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium text-slate-800">{team.name}</p>
                      <p className="text-sm text-slate-600">
                        {team.description || "Team"}
                      </p>
                    </div>
                    <div className="w-3 h-3 bg-green-500 rounded-full" />
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-slate-500">
                  {t("dashboard:teamMembers.noMembers")}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard:recentActivity.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activityLoading ? (
                <div className="text-center py-4">{t("actions.loading")}</div>
              ) : activity && activity.length > 0 ? (
                activity.slice(0, 5).map((item: any) => (
                  <div
                    key={item.id}
                    className="flex space-x-3 cursor-pointer hover:bg-muted/30 p-2 rounded-md transition-colors"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      {item.action === "created" && (
                        <Plus className="h-4 w-4 text-blue-600" />
                      )}
                      {item.action === "completed" && (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      )}
                      {item.action === "commented" && (
                        <MessageCircle className="h-4 w-4 text-yellow-600" />
                      )}
                      {item.action === "updated" && (
                        <UserCheck className="h-4 w-4 text-purple-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-slate-800">
                        <span className="font-medium">
                          {item.userName || item.userId}
                        </span>{" "}
                        {item.action} a ticket
                      </p>
                      {item.taskTitle && (
                        <p className="text-xs text-muted-foreground font-medium hover:text-primary">
                          {item.taskTitle}
                        </p>
                      )}
                      <p className="text-xs text-slate-500">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-slate-500">
                  {t("dashboard:recentActivity.noActivity")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </MainWrapper>
  );
}
