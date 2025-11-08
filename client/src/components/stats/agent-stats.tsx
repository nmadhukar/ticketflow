import { useAgentStats } from "@/hooks/useStats";
import { StatCard } from "./stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCheck, PlusCircle, Target, Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function AgentStats() {
  const { data, isLoading, error } = useAgentStats();
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load statistics. Please try again.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No data available
      </div>
    );
  }

  const { personal, team } = data;

  // Format resolution time
  const formatResolutionTime = (hours: number): string => {
    if (hours < 24) {
      return `${hours.toFixed(1)} hours`;
    }
    return `${(hours / 24).toFixed(1)} days`;
  };

  // Get selected team stats
  const selectedTeam =
    team?.find((t) => t.teamId === selectedTeamId) || team?.[0];

  return (
    <div className="space-y-6">
      {/* Personal Stats */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Personal Stats</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StatCard
            title="Assigned to Me"
            value={personal.assignedToMe}
            icon={<UserCheck className="h-5 w-5 text-blue-600" />}
            color="blue"
          />
          <StatCard
            title="Created by Me"
            value={personal.createdByMe}
            icon={<PlusCircle className="h-5 w-5 text-green-600" />}
            color="green"
          />
          <Card className="border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    My Resolution Rate
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold">
                      {(personal.resolutionRate * 100).toFixed(1)}%
                    </p>
                  </div>
                  <Progress
                    value={personal.resolutionRate * 100}
                    className="h-2"
                  />
                </div>
                <div className="p-2 rounded border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950">
                  <Target className="h-5 w-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <StatCard
            title="Avg Resolution Time"
            value={formatResolutionTime(personal.avgResolutionTime)}
            icon={<Clock className="h-5 w-5 text-orange-600" />}
            color="orange"
          />
        </div>
      </div>

      {/* Separator between Personal and Team Stats */}
      {team && team.length > 0 && <Separator className="my-10" />}

      {/* Team Stats - Only shows teams the agent is enrolled in */}
      {team && team.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Team Overview</h3>
            {team.length > 1 && (
              <Select
                value={selectedTeamId?.toString() || team[0].teamId.toString()}
                onValueChange={(value) => setSelectedTeamId(parseInt(value))}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Team" />
                </SelectTrigger>
                <SelectContent>
                  {/* Only show teams the agent is enrolled in (filtered by backend) */}
                  {team.map((t) => (
                    <SelectItem key={t.teamId} value={t.teamId.toString()}>
                      {t.teamName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {selectedTeam && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <UserCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="font-medium">Total Tickets</span>
                </div>
                <span className="text-2xl font-bold">
                  {selectedTeam.totalTickets}
                </span>
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                    <PlusCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="font-medium">Open Tickets</span>
                </div>
                <span className="text-2xl font-bold">
                  {selectedTeam.openTickets}
                </span>
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900 rounded-lg flex items-center justify-center">
                    <Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <span className="font-medium">In Progress</span>
                </div>
                <span className="text-2xl font-bold">
                  {selectedTeam.inProgress}
                </span>
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                    <Target className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="font-medium">Resolved</span>
                </div>
                <span className="text-2xl font-bold">
                  {selectedTeam.resolved}
                </span>
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-100 dark:bg-red-900 rounded-lg flex items-center justify-center">
                    <Target className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                  <span className="font-medium">High Priority</span>
                </div>
                <span className="text-2xl font-bold">
                  {selectedTeam.highPriority}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
