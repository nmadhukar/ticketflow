import { useManagerStats } from "@/hooks/useStats";
import { StatCard } from "./stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  UserCheck,
  PlusCircle,
  Clock,
  Target,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const COLORS = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

export function ManagerStats() {
  const { data, isLoading, error } = useManagerStats();
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
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

  const {
    department,
    priorityDistribution,
    categoryBreakdown,
    teamPerformance,
  } = data;

  // Format resolution time
  const formatResolutionTime = (hours: number): string => {
    if (hours < 24) {
      return `${hours.toFixed(1)} hours`;
    }
    return `${(hours / 24).toFixed(1)} days`;
  };

  // Get selected department stats
  const selectedDept =
    department.find((d) => d.departmentId === selectedDeptId) || department[0];

  // Prepare priority distribution data for chart
  const priorityData = [
    {
      name: "Urgent",
      value: priorityDistribution.urgent,
      color: COLORS.urgent,
    },
    { name: "High", value: priorityDistribution.high, color: COLORS.high },
    {
      name: "Medium",
      value: priorityDistribution.medium,
      color: COLORS.medium,
    },
    { name: "Low", value: priorityDistribution.low, color: COLORS.low },
  ].filter((item) => item.value > 0);

  // Prepare category breakdown data for chart
  const categoryData = categoryBreakdown
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((item) => ({
      name: item.category,
      count: item.count,
      percentage: item.percentage,
    }));

  return (
    <div className="space-y-10">
      {/* Department Overview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Department Overview</h3>
          {department.length > 1 && (
            <Select
              value={
                selectedDeptId?.toString() ||
                department[0]?.departmentId.toString()
              }
              onValueChange={(value) => setSelectedDeptId(parseInt(value))}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select Department" />
              </SelectTrigger>
              <SelectContent>
                {department.map((d) => (
                  <SelectItem
                    key={d.departmentId}
                    value={d.departmentId.toString()}
                  >
                    {d.departmentName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {selectedDept && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              title="Total Tickets"
              value={selectedDept.totalTickets}
              icon={<UserCheck className="h-5 w-5 text-blue-600" />}
              color="blue"
            />
            <StatCard
              title="Open Tickets"
              value={selectedDept.openTickets}
              icon={<PlusCircle className="h-5 w-5 text-green-600" />}
              color="green"
            />
            <StatCard
              title="In Progress"
              value={selectedDept.inProgress}
              icon={<Clock className="h-5 w-5 text-orange-600" />}
              color="orange"
            />
            <StatCard
              title="Resolved"
              value={selectedDept.resolved}
              icon={<Target className="h-5 w-5 text-purple-600" />}
              color="purple"
            />
            <StatCard
              title="High Priority"
              value={selectedDept.highPriority}
              icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
              color="red"
            />
            <StatCard
              title="Avg Resolution Time"
              value={formatResolutionTime(selectedDept.avgResolutionTime)}
              icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
              color="blue"
            />
          </div>
        )}
      </div>

      {/* Team Performance */}
      {teamPerformance.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Team Performance</h3>
          <Accordion type="single" collapsible className="w-full">
            {teamPerformance.map((team) => (
              <AccordionItem key={team.teamId} value={team.teamId.toString()}>
                <AccordionTrigger>
                  <div className="flex items-center justify-between w-full pr-4">
                    <span className="font-medium">{team.teamName}</span>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Total: {team.totalTickets}</span>
                      <span>
                        Resolution Rate:{" "}
                        {(team.resolutionRate * 100).toFixed(1)}%
                      </span>
                      <span>
                        Avg Time: {formatResolutionTime(team.avgResolutionTime)}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <StatCard
                        title="Total Tickets"
                        value={team.totalTickets}
                        icon={<UserCheck className="h-5 w-5 text-blue-600" />}
                        color="blue"
                      />
                      <StatCard
                        title="Resolution Rate"
                        value={`${(team.resolutionRate * 100).toFixed(1)}%`}
                        icon={<Target className="h-5 w-5 text-purple-600" />}
                        color="purple"
                      />
                      <StatCard
                        title="Avg Resolution Time"
                        value={formatResolutionTime(team.avgResolutionTime)}
                        icon={<Clock className="h-5 w-5 text-orange-600" />}
                        color="orange"
                      />
                    </div>
                    {team.members.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">
                          Team Member Statistics
                        </h4>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Assigned</TableHead>
                              <TableHead>Resolved</TableHead>
                              <TableHead>Resolution Rate</TableHead>
                              <TableHead>Avg Resolution Time</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {team.members.map((member) => (
                              <TableRow key={member.userId}>
                                <TableCell className="font-medium">
                                  {member.name}
                                </TableCell>
                                <TableCell>{member.assigned}</TableCell>
                                <TableCell>{member.resolved}</TableCell>
                                <TableCell>
                                  {(member.resolutionRate * 100).toFixed(1)}%
                                </TableCell>
                                <TableCell>
                                  {formatResolutionTime(
                                    member.avgResolutionTime
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}

      {/* Priority Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Priority Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {priorityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value, percent }) =>
                    `${name}: ${value} (${(percent * 100).toFixed(0)}%)`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No priority data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Category Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData}>
                <XAxis
                  dataKey="name"
                  angle={-45}
                  textAnchor="end"
                  height={100}
                />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No category data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
