/**
 * S3 Usage Monitoring Component
 *
 * Displays S3 storage usage statistics including total storage, file count,
 * daily/monthly trends, and recent uploads.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  HardDrive,
  FileText,
  TrendingUp,
  RefreshCw,
  Clock,
  Link as LinkIcon,
} from "lucide-react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface DailyUsage {
  date: string;
  storage: number;
  files: number;
}

interface MonthlyUsage {
  month: string;
  storage: number;
  files: number;
}

interface RecentUpload {
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  taskId: number;
}

interface S3UsageStats {
  totalStorage: number;
  totalFiles: number;
  dailyUsage: DailyUsage[];
  monthlyUsage: MonthlyUsage[];
  recentUploads: RecentUpload[];
  warning?: string;
}

// Format bytes to human-readable format
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

// Format file size for display
const formatFileSize = (bytes: number): string => {
  return formatBytes(bytes);
};

export function S3UsageMonitoring() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Fetch S3 usage statistics
  const {
    data: usageStats,
    isLoading,
    refetch,
  } = useQuery<S3UsageStats>({
    queryKey: ["/api/admin/s3-usage"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/s3-usage");
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    refetchOnMount: "always",
    refetchOnReconnect: true,
    staleTime: 0,
  });

  // Calculate storage this month
  const currentMonth = format(new Date(), "yyyy-MM");
  const thisMonthUsage = usageStats?.monthlyUsage.find(
    (m) => m.month === currentMonth
  );
  const storageThisMonth = thisMonthUsage?.storage || 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            Loading S3 Usage Statistics...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!usageStats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>S3 Usage Monitoring Unavailable</CardTitle>
          <CardDescription>
            Unable to load S3 usage statistics. Please check your connection and
            try again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => refetch()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const {
    totalStorage,
    totalFiles,
    dailyUsage,
    monthlyUsage,
    recentUploads,
    warning,
  } = usageStats;

  // Prepare chart data
  const dailyChartData = dailyUsage.map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    storage: d.storage / (1024 * 1024), // Convert to MB
    files: d.files,
  }));

  const monthlyChartData = monthlyUsage.map((m) => ({
    month: format(new Date(m.month + "-01"), "MMM yyyy"),
    storage: m.storage / (1024 * 1024 * 1024), // Convert to GB
    files: m.files,
  }));

  return (
    <div className="space-y-6">
      {/* Warning Alert */}
      {warning && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Storage</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatBytes(totalStorage)}
            </div>
            <p className="text-xs text-muted-foreground">
              {totalFiles.toLocaleString()} files
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Storage This Month
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatBytes(storageThisMonth)}
            </div>
            <p className="text-xs text-muted-foreground">
              {thisMonthUsage?.files || 0} files uploaded
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Files</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalFiles.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Average:{" "}
              {totalFiles > 0 ? formatBytes(totalStorage / totalFiles) : "0 B"}{" "}
              per file
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent Uploads */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Uploads
            </CardTitle>
            <CardDescription>
              Last 20 file uploads to S3 storage
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentUploads && recentUploads.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Task</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentUploads.map((upload, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {upload.fileName}
                        </div>
                      </TableCell>
                      <TableCell>{formatFileSize(upload.fileSize)}</TableCell>
                      <TableCell>
                        {format(
                          new Date(upload.uploadedAt),
                          "MMM d, yyyy h:mm a"
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setLocation(`/tickets/${upload.taskId}`)
                          }
                          className="flex items-center gap-1"
                        >
                          <LinkIcon className="h-3 w-3" />#{upload.taskId}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No recent uploads
              </div>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          {/* Daily Usage Chart */}
          {dailyChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Daily Storage Usage (Last 30 Days)
                </CardTitle>
                <CardDescription>
                  Storage usage and file uploads per day
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip
                      formatter={(value: any, name: string) => {
                        if (name === "storage") {
                          return [
                            `${formatBytes(value * 1024 * 1024)}`,
                            "Storage",
                          ];
                        }
                        return [value, "Files"];
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="storage"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      name="Storage (MB)"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="files"
                      stroke="#10b981"
                      strokeWidth={2}
                      name="Files"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Monthly Usage Chart */}
          {monthlyChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Monthly Storage Usage (Last 12 Months)
                </CardTitle>
                <CardDescription>
                  Storage usage and file uploads per month
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip
                      formatter={(value: any, name: string) => {
                        if (name === "storage") {
                          return [
                            `${formatBytes(value * 1024 * 1024 * 1024)}`,
                            "Storage",
                          ];
                        }
                        return [value, "Files"];
                      }}
                    />
                    <Legend />
                    <Bar
                      yAxisId="left"
                      dataKey="storage"
                      fill="#3b82f6"
                      name="Storage (GB)"
                    />
                    <Bar
                      yAxisId="right"
                      dataKey="files"
                      fill="#10b981"
                      name="Files"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
