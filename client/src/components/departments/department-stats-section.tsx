import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDepartmentStats } from "@/hooks/useDepartments";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stats/stat-card";
import { useTranslation } from "react-i18next";
import {
  Users,
  FolderOpen,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

interface DepartmentStatsSectionProps {
  departmentId: string | number;
}

export function DepartmentStatsSection({
  departmentId,
}: DepartmentStatsSectionProps) {
  const { t } = useTranslation(["common", "departments"]);
  const {
    data: stats,
    isLoading: statsLoading,
    error,
  } = useDepartmentStats(departmentId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("departments:sections.statistics.title", {
            defaultValue: "Statistics",
          })}
        </CardTitle>
        <CardDescription>
          {t("departments:sections.statistics.description", {
            defaultValue: "Department performance metrics",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {statsLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            <p className="mb-2">
              {t("departments:errors.loadStatsFailed", {
                defaultValue: "Failed to load statistics",
              })}
            </p>
            <p className="text-sm text-slate-500">
              {t("departments:errors.tryAgain", {
                defaultValue: "Please try again later",
              })}
            </p>
          </div>
        ) : stats ? (
          <div className="space-y-6">
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                title={t("departments:stats.teams", { defaultValue: "Teams" })}
                value={stats.teamCount}
                icon={<Users className="h-5 w-5 text-blue-600" />}
                color="blue"
              />
              <StatCard
                title={t("departments:stats.totalTickets", {
                  defaultValue: "Total Tickets",
                })}
                value={stats.totalTickets}
                icon={<FolderOpen className="h-5 w-5 text-slate-600" />}
                color="blue"
              />
              <StatCard
                title={t("departments:stats.openTickets", {
                  defaultValue: "Open Tickets",
                })}
                value={stats.openTickets}
                icon={<Clock className="h-5 w-5 text-yellow-600" />}
                color="orange"
              />
              <StatCard
                title={t("departments:stats.inProgress", {
                  defaultValue: "In Progress",
                })}
                value={stats.inProgressTickets}
                icon={<Clock className="h-5 w-5 text-blue-600" />}
                color="blue"
              />
              <StatCard
                title={t("departments:stats.resolved", {
                  defaultValue: "Resolved",
                })}
                value={stats.resolvedTickets}
                icon={<CheckCircle className="h-5 w-5 text-green-600" />}
                color="green"
              />
              <StatCard
                title={t("departments:stats.highPriority", {
                  defaultValue: "High Priority",
                })}
                value={stats.highPriorityTickets}
                icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
                color="red"
              />
            </div>

            {/* Additional Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">
                  {t("departments:stats.closedTickets", {
                    defaultValue: "Closed Tickets",
                  })}
                </p>
                <p className="text-2xl font-bold">{stats.closedTickets}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">
                  {t("departments:stats.completionRate", {
                    defaultValue: "Completion Rate",
                  })}
                </p>
                <p className="text-2xl font-bold">
                  {stats.totalTickets > 0
                    ? (
                        ((stats.resolvedTickets + stats.closedTickets) /
                          stats.totalTickets) *
                        100
                      ).toFixed(1)
                    : 0}
                  %
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500">
            {t("departments:emptyStates.noStats", {
              defaultValue: "No statistics available",
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
