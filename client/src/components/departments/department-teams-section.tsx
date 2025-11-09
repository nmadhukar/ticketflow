import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { useDepartmentTeams } from "@/hooks/useDepartments";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { TeamDetailPreview } from "./team-detail-preview";

interface DepartmentTeamsSectionProps {
  departmentId: string | number;
}

export function DepartmentTeamsSection({
  departmentId,
}: DepartmentTeamsSectionProps) {
  const [, setLocation] = useLocation();
  const { t } = useTranslation(["common", "departments"]);
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);
  const {
    data: teams,
    isLoading: teamsLoading,
    error,
  } = useDepartmentTeams(departmentId);

  const handleTeamCardClick = (teamId: number) => {
    setExpandedTeamId((prev) => (prev === teamId ? null : teamId));
  };

  const handleViewFullDetails = (teamId: number) => {
    setLocation(`/teams/${teamId}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("departments:sections.teams.title", {
            defaultValue: "Teams",
          })}{" "}
          ({teams?.length || 0})
        </CardTitle>
        <CardDescription>
          {t("departments:sections.teams.description", {
            defaultValue: "Teams in this department",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {teamsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center space-x-3 flex-1">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            <p className="mb-2">
              {t("departments:errors.loadTeamsFailed", {
                defaultValue: "Failed to load teams",
              })}
            </p>
            <p className="text-sm text-slate-500">
              {t("departments:errors.tryAgain", {
                defaultValue: "Please try again later",
              })}
            </p>
          </div>
        ) : teams && teams.length > 0 ? (
          <div className="grid gap-4">
            {teams.map((team) => {
              const isExpanded = expandedTeamId === team.id;
              return (
                <div key={team.id} className="space-y-0">
                  <div
                    className={`flex items-center justify-between p-4 border rounded-lg transition-colors cursor-pointer ${
                      isExpanded
                        ? "bg-blue-50 border-blue-200 hover:bg-blue-100"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => handleTeamCardClick(team.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleTeamCardClick(team.id);
                      }
                    }}
                  >
                    <div className="flex items-center space-x-3 flex-1">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Users className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium">{team.name}</p>
                        </div>
                        {team.description && (
                          <p className="text-sm text-slate-500">
                            {team.description}
                          </p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                          Created{" "}
                          {new Date(team.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-slate-500" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-slate-500" />
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-0 p-4 border border-t-0 rounded-b-lg bg-white animate-in fade-in slide-in-from-top-2 duration-200">
                      <TeamDetailPreview
                        teamId={team.id}
                        onViewFullDetails={() => handleViewFullDetails(team.id)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <Users className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              {t("departments:emptyStates.noTeams.title", {
                defaultValue: "No teams yet",
              })}
            </h3>
            <p className="text-slate-500">
              {t("departments:emptyStates.noTeams.description", {
                defaultValue:
                  "This department doesn't have any teams assigned yet.",
              })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
