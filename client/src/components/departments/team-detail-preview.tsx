import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ExternalLink, Users, Crown, ClipboardList } from "lucide-react";
import { useTeamAdmins } from "@/hooks/useTeamAdmins";
import { useTeamTasks } from "@/hooks/useTeamTasks";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { TeamMember } from "@/types/teams";

interface TeamDetailPreviewProps {
  teamId: string | number;
  onViewFullDetails: () => void;
}

export function TeamDetailPreview({
  teamId,
  onViewFullDetails,
}: TeamDetailPreviewProps) {
  const { t } = useTranslation(["common", "departments"]);

  // Fetch team members
  const { data: members, isLoading: membersLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/teams", teamId, "members"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/teams/${teamId}/members`);
      return res.json();
    },
    enabled: !!teamId,
    retry: false,
  });

  // Fetch team admins
  const { data: admins, isLoading: adminsLoading } = useTeamAdmins(teamId);

  // Fetch team tasks
  const { data: tasks, isLoading: tasksLoading } = useTeamTasks(teamId);

  const membersCount = members?.length || 0;
  const adminsCount = admins?.length || 0;
  const recentTasks = tasks?.slice(0, 5) || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-blue-100 text-blue-700";
      case "in_progress":
        return "bg-yellow-100 text-yellow-700";
      case "resolved":
        return "bg-green-100 text-green-700";
      case "closed":
        return "bg-slate-100 text-slate-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-3 bg-slate-50 rounded-lg">
          {membersLoading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-slate-500" />
                <p className="text-xs text-slate-600">
                  {t("departments:teamPreview.members", {
                    defaultValue: "Members",
                  })}
                </p>
              </div>
              <p className="text-2xl font-bold">{membersCount}</p>
            </>
          )}
        </div>

        <div className="p-3 bg-slate-50 rounded-lg">
          {adminsLoading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Crown className="h-4 w-4 text-slate-500" />
                <p className="text-xs text-slate-600">
                  {t("departments:teamPreview.admins", {
                    defaultValue: "Admins",
                  })}
                </p>
              </div>
              <p className="text-2xl font-bold">{adminsCount}</p>
            </>
          )}
        </div>

        <div className="p-3 bg-slate-50 rounded-lg">
          {tasksLoading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList className="h-4 w-4 text-slate-500" />
                <p className="text-xs text-slate-600">
                  {t("departments:teamPreview.tasks", {
                    defaultValue: "Tasks",
                  })}
                </p>
              </div>
              <p className="text-2xl font-bold">{tasks?.length || 0}</p>
            </>
          )}
        </div>
      </div>

      {/* Recent Tasks */}
      <div>
        <h4 className="text-sm font-semibold mb-2">
          {t("departments:teamPreview.recentTasks", {
            defaultValue: "Recent Tasks",
          })}
        </h4>
        {tasksLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : recentTasks.length > 0 ? (
          <div className="space-y-2">
            {recentTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-2 border rounded text-sm hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-medium truncate">{task.title}</span>
                  <Badge className={`text-xs ${getStatusColor(task.status)}`}>
                    {task.status}
                  </Badge>
                </div>
                <span className="text-xs text-slate-500 ml-2">
                  {new Date(task.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {t("departments:teamPreview.noTasks", {
              defaultValue: "No tasks assigned to this team yet.",
            })}
          </p>
        )}
      </div>

      {/* View Full Details Button */}
      <div className="pt-2 border-t">
        <Button
          variant="outline"
          size="sm"
          onClick={onViewFullDetails}
          className="w-full"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          {t("departments:teamPreview.viewFullDetails", {
            defaultValue: "View Full Details",
          })}
        </Button>
      </div>
    </div>
  );
}
